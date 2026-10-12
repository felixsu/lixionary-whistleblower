# Speak Up — company whistleblowing suite

An accountless reporting portal with anonymous submission, a private case mailbox, optional email/phone verification, assigned investigators, independent closure approval, and company administration. English and Indonesian interfaces are included.

Reporter contacts and raw assistant conversations live in a separate service, database, encryption keyring, and file vault. Analysts, managers, and system administrators have no contact-reveal endpoint. OTP proves control of a contact destination; it does not prove a person's legal identity. Reporters review their narrative and sanitized evidence before staff receive them.

`main` contains the new suite. `main-mvp` preserves the original MVP without the gap assessment. This implementation starts with **new suite databases and volumes**; it does not migrate or import MVP reports.

## Run locally

Requirements: Node 24+, pnpm 11.9, Docker Compose, and enough Docker memory for PostgreSQL, ClamAV, and document conversion (allow at least 6 GB).

```sh
pnpm install --frozen-lockfile
pnpm suite:setup
pnpm suite:dev
```

Open the portal at <http://localhost:9551> and the development mailbox at <http://localhost:6403>. The backend is available at `127.0.0.1:9550`; the case database at `127.0.0.1:9552` maps to PostgreSQL's container port 5432. These host ports bind only to localhost. The separate identity database has no published port. The first scanner startup downloads antivirus signatures and can take several minutes. On ARM hosts, the scanner uses the official AMD64 image through Docker emulation.

Create the first administrator only on an empty staff table:

```sh
docker compose --env-file .suite-dev/suite.env run --rm --no-deps case-migrate \
  node dist/cli/bootstrap.js you@example.com
```

Enter a password of at least 15 characters through stdin. Log in at `/staff/login`, enroll an authenticator, and save the single-use recovery codes. Invite two managers for the standard team and two different managers for the independent team, create those teams, and configure the company policy, categories, deadlines, and all six retention periods. Production submissions are unavailable until this setup is complete.

Development SMTP goes to Mailpit. SMS requires Twilio credentials. AI requires a MiniMax key **and** the company AI setting; it is off by default. Generated secrets are file based, ignored by Git, and never printed by setup.

Production email supports Zoho CPaaS HTTP delivery for both staff and reporters. Install the API key directly on the VPS in `.suite-config/secrets/zoho_api_key` (owner `lixsu`, mode 600), then run `pnpm email:configure:vps --check` and `pnpm email:configure:vps` here before deployment. These commands never copy or print the key. See the [Zoho setup and email checks](docs/runbook.md#zoho-transactional-email) for details. Local development continues to use Mailpit; phone verification remains unavailable until Twilio is configured.

## Workspace

| Path               | Responsibility                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| `apps/server`      | Case API, staff MFA, authorization, workflow, audit, retention, durable case jobs      |
| `apps/privacy`     | Private contacts and OTP, consented intake, sealed originals, scanning/conversion jobs |
| `apps/web`         | Next.js reporting, private mailbox, staff and administration screens                   |
| `packages/shared`  | Shared schemas, roles, states, company settings                                        |
| `packages/runtime` | Encryption, capabilities, hashing, rate limits, assistant adapter                      |
| `deploy`           | Container entrypoint, proxy policy, scanner configuration                              |
| `scripts`          | Secret setup, synthetic tests, key rotation, offsite backup and isolated restore       |

## Versioning

The root `package.json` is the release-version source of truth. All workspace packages share version `0.2.0`. The footer on reporter and staff screens shows the version; its tooltip includes the build revision. Build metadata is embedded in the frontend assets and changes only after rebuilding.

```sh
pnpm version:check          # Validate every workspace package
pnpm version:bump patch     # 0.2.0 → 0.2.1
pnpm version:bump minor     # Advance the minor version and reset patch
pnpm version:bump major     # Advance the major version and reset minor/patch
pnpm version:bump 1.2.3     # Set an explicit, newer release version
pnpm version:sync           # Repair package drift using the root version
```

Use patch versions for fixes and minor versions for features; while the project is below 1.0, advance the minor version for breaking changes. Bump the version with the intended changes, validate, then commit all updated manifests together. The commands do not create commits or Git tags. Workspace builds, type checks and CI validate version alignment.

Local builds display the version with a `Local build` tooltip. To identify a particular committed build, set `APP_REVISION` to its full 40-character Git SHA when running `pnpm build` or `pnpm suite:dev`; direct Docker builds accept `--build-arg APP_REVISION=<full-sha>`. CI supplies its revision automatically, and the VPS deployment script embeds the exact archived revision.

## Verify

```sh
node scripts/test-db.mjs
docker run -d --name whistle-suite-test-db --env-file .suite-dev/postgres.env \
  -p 127.0.0.1:6412:5432 postgres:17-alpine
pnpm typecheck
pnpm test
pnpm build
```

Integration tests recreate only `whistle_suite_test` and `whistle_privacy_test` on this test database. Run one full integration test process at a time.

For browser and real evidence-pipeline checks, start the development suite first:

```sh
node scripts/seed-browser.mjs
pnpm --filter @whistle/web exec playwright install chromium
pnpm test:browser
node scripts/evidence-smoke.mjs
```

The browser seed refuses non-test staff accounts and production configuration. These scripts create synthetic reports and Mailpit messages. Do not run them against real company data.

## Deploy from this machine

```sh
pnpm deploy:vps --check   # Inspect the existing VPS without restarting services
pnpm deploy:vps --push    # Validate committed main, push it, build and deploy
```

Commit the intended changes on `main` first. If already pushed, use `pnpm deploy:vps`. The script builds `linux/amd64` images locally, transfers them over SSH to `lixsu@lixionary.com:/app/lixionary-whistleblower`, copies and authenticates an encrypted pre-deployment snapshot here, then migrates and starts the exact image IDs. Existing secrets, port configuration and TLS certificates are preserved. Protected backup files live in `.suite-dev/deployments/` and must be kept together for recovery. See the runbook for prerequisites and failure recovery.

See [implementation and validation](docs/implementation.md), [deployment and operations](docs/runbook.md), and the [historical MVP gap assessment](docs/gaps.md).

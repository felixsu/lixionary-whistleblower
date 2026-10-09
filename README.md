# Lixionary Whistleblower ("Speak Up")

A confidential reporting channel. Reporters submit concerns **without an account**. They leave an email address or phone number so the review team can follow up. A **MiniMax M3** assistant interviews the reporter before submission to fill gaps in incomplete reports. Admins then review, message the reporter, reveal contact details when needed, and track each case to closure.

```
apps/server     Fastify 5 API · Drizzle ORM · PostgreSQL · MiniMax client
apps/web        Next.js 16 (App Router) · Tailwind v4 · TanStack Query
packages/shared zod schemas + types used by both
```

## Quick start

Requirements: Node ≥ 24, pnpm 11, Docker.

```sh
cp .env.example .env
# set CONTACT_ENC_KEY (openssl rand -base64 32) and MINIMAX_API_KEY
docker compose up -d              # postgres :6402, mailpit UI :6403 / SMTP :6404
pnpm install
pnpm db:migrate                   # also runs automatically on server start
pnpm admin:create --email you@example.com --name "Integrity Team"   # prompts for password (≥12 chars)
pnpm dev                          # API :6400, web :6401
```

Then open:
- Reporter site: http://localhost:6401
- Review console: http://localhost:6401/admin
- Dev mailbox for admin notifications: http://localhost:6403

To run the full stack in containers, use `docker compose --profile app up --build`.

## How it works

### Reporter flow
1. **Intro.** The reporter consents to AI processing, or chooses the plain form instead.
2. **Chat.** The MiniMax assistant streams its replies over SSE and asks at most two questions per turn. It covers what, who, when, where, how the reporter knows, evidence, impact, and whether the problem is ongoing.
   - Every two turns, the server asks the model for a structured draft, a 0–100 **completeness** score and a list of **open questions**. These appear live in a side panel.
   - When the assistant decides the key facts are covered, it emits `[[READY]]`. The server strips this marker and highlights "Review draft".
3. **Review.** The reporter edits the structured draft. No AI text is submitted unless the reporter has seen it.
4. **Contact and evidence.** The reporter must give an email or a phone number. Evidence uploads are optional, up to 5 files of 10 MB each.
5. **Done.** The reporter gets a **case code** (`WB-XXXX-XXXX`) and a **PIN**. The PIN is shown once and only its argon2id hash is stored. At `/status` the reporter can see progress and exchange messages with the review team.

**If MiniMax is unavailable or no key is set,** reporters go straight to the form. Submission never depends on the AI.

### Admin console
The console provides:
- A report list with filters for status, category, date and keyword, plus completeness and unread-reply badges.
- A report detail page that shows:
  - the structured report;
  - the AI's open questions;
  - the full intake transcript;
  - evidence downloads;
  - a two-way message thread;
  - internal notes;
  - status workflow: `new → under_review → need_info → valid → contacted → closed_*`;
  - an activity log.
- **Reveal contact details**, which decrypts the reporter's email and phone on demand. Every reveal, status change, message and download is written to `audit_log`.

## Privacy and security measures
- Contact details are encrypted with **AES-256-GCM** (`CONTACT_ENC_KEY`). The stored format `v1:iv:tag:ct` leaves room for key rotation.
- **No IP addresses are stored or logged.** The request log records only the method and path. Rate limits are kept in memory.
- Images are re-encoded with `sharp`, which removes **EXIF/GPS metadata**. Uploads are checked by their magic bytes, not their file extension, and stored under random keys outside any web root.
- Admin sessions use DB-backed `HttpOnly`, `SameSite=Strict` cookies that last 8 hours. Mutating requests also require an `x-csrf: 1` header. Passwords are hashed with argon2id.
- Case lookup returns the same error, with the same timing, for an unknown case and a wrong PIN.
- Admin emails contain only the case code and a link. No report content goes by email.
- Abandoned intake sessions are deleted after 24 hours, together with their uploaded files.
- The web app loads no third-party fonts or scripts. It sends `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.

## MiniMax configuration
| Variable | Default | Notes |
|---|---|---|
| `MINIMAX_API_KEY` | — | Leave empty to disable the assistant. |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/v1` | OpenAI-compatible endpoint. |
| `MINIMAX_MODEL` | `MiniMax-M3` | |
| `MINIMAX_THINKING` | `disabled` | `adaptive` lets M3 reason first, which is slower. |

Reporter messages are sent to MiniMax, a third party. The intro screen tells reporters this before they start.

## Commands
```sh
pnpm test          # server unit + integration tests (needs the compose postgres; uses a separate whistle_test DB)
pnpm typecheck
pnpm build
pnpm db:generate   # after editing apps/server/src/db/schema.ts
```

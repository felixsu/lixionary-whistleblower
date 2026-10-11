# Whistleblowing application: MVP gap assessment

> Historical MVP assessment. For the suite now implemented on `main`, see [implementation and validation](implementation.md) and the [operations runbook](runbook.md). The original source is preserved on `main-mvp`.

Assessment date: **11 October 2026**. Reviewed application revision: **`5a7cf34`**.

This document records the assessment of the current Speak Up MVP against the intended company whistleblowing suite. Observed behavior describes the reviewed code; required behavior and acceptance criteria describe proposed work. It is a source review and product gap assessment, not a production security certification or a jurisdiction-specific compliance assessment.

## Assessment summary

The MVP already supports accountless reporting and basic case handling. The largest mismatch is structural: every authenticated staff account can currently decrypt reporter contact details, while the intended application must hide those details from both analysts and administrators. Completing the suite requires privacy boundaries, staff and case authorization, private verification, a fuller investigation workflow, administration, and demonstrated production operations.

### Confirmed product requirements

- Anyone can create a report without an account. Reporter audience restrictions, if any, remain a separate policy decision.
- Reporters can submit without supplying email or phone. They may voluntarily add and verify a private contact later.
- Neither analysts nor administrators can see reporter email or phone, including masked destination hints.
- A restricted system service may use an optional contact for OTP delivery and neutral notifications.
- Analysts analyze reports and communicate with reporters through the platform.
- Analysts may request contact verification. Declining verification must not automatically invalidate an allegation or prevent anonymous reporting.
- Email or phone OTP establishes control of the contact channel; it does not prove legal identity, employment, or allegation validity.

### Existing foundation to retain

- Accountless intake through an AI-assisted conversation or plain form, with reporter-reviewed drafts.
- Case code and Argon2-hashed access secret for returning to the reporter portal.
- AES-256-GCM encryption of stored contact fields.
- Two-way text messages, internal notes, report statuses, and a filtered staff queue.
- Private uploads with content-type checks, size/count limits, and image metadata removal.
- Auditing of selected actions and retried staff email notifications.

These controls are useful foundations, but contact encryption and reveal auditing do not satisfy the requirement that staff cannot retrieve contact details.

## Priority register

- **P0:** blockers to the agreed privacy and access model.
- **P1:** requirements for an operational suite and a credible production launch.
- **P2:** oversight enhancements, expansion, or unresolved scope decisions.

Priorities are assessment judgments, not vulnerability severity scores. The delivery phases below describe implementation order; P1 security and operational controls remain launch gates.

| ID | Priority | Capability | Current state |
| --- | --- | --- | --- |
| [G01](#g01-identity-isolation) | P0 | Identity isolation | Conflicts with requirement |
| [G02](#g02-anonymous-submission) | P0 | Anonymous submission | Conflicts with requirement |
| [G03](#g03-private-otp-verification) | P0 | Private OTP verification | Missing |
| [G04](#g04-staff-roles-and-case-access) | P0 | Staff roles and case access | Missing |
| [G05](#g05-identity-clues-in-content) | P0 | Identity clues in content | Partial |
| [G06](#g06-platform-communication) | P1 | Platform communication | Partial |
| [G07](#g07-investigation-lifecycle) | P1 | Investigation lifecycle | Partial |
| [G08](#g08-staff-and-company-management) | P1 | Staff and company management | Missing |
| [G09](#g09-deadlines-and-escalations) | P1 | Deadlines and escalations | Missing |
| [G10](#g10-evidence-safety-and-custody) | P1 | Evidence safety and custody | Partial |
| [G11](#g11-audit-and-oversight) | P1 | Audit and oversight | Partial |
| [G12](#g12-privacy-lifecycle-and-ai) | P1 | Privacy lifecycle and AI | Partial |
| [G13](#g13-staff-authentication-and-recovery) | P1 | Staff authentication and recovery | Partial |
| [G14](#g14-production-operations) | P1 | Production operations | Not demonstrated |
| [G15](#g15-oversight-analytics) | P2 | Oversight analytics | Missing |
| [G16](#g16-scope-access-and-language) | P2 | Scope, access and language | Decision needed |

## Detailed gaps

### G01: Identity isolation

**Priority:** P0. **Current state:** Conflicts with requirement.

**Observed implementation**

Every authenticated staff account can call reveal-contact. The API decrypts email and phone using the same process and key as the case application; the UI exposes mailto and tel links. Encryption and a reveal audit do not prevent disclosure.

**Required behavior**

Remove contact reveal from every staff API and UI. Store contacts in an isolated vault; a restricted verification/notification service alone can decrypt them. Use separate service credentials and key permissions so the case application cannot retrieve contact plaintext. Admins manage the system without contact access. Review exports, delivery errors, logs, backups and provider dashboards for equivalent disclosure paths.

**Acceptance criteria**

Analyst and admin responses, downloads, logs and notification diagnostics contain neither full nor masked contact destinations. Direct calls to a removed reveal route cannot return contact data. The case application has no vault decryption permission. Operator access is explicitly governed; an application role alone cannot guarantee anonymity from infrastructure operators.

**Repository evidence**

- [apps/server/src/routes/admin/reports.ts, line 169](<../apps/server/src/routes/admin/reports.ts#L169>)
- [apps/web/src/app/admin/(console)/reports/[id]/page.tsx, line 201](<../apps/web/src/app/admin/(console)/reports/[id]/page.tsx#L201>)
- [apps/server/src/main.ts, line 18](<../apps/server/src/main.ts#L18>)

### G02: Anonymous submission

**Priority:** P0. **Current state:** Conflicts with requirement.

**Observed implementation**

The shared contact schema and submission tests require an email or phone. The site is accountless, but reporters must disclose a contact to the system. No route lets a reporter add a contact after submission.

**Required behavior**

Accept reports with no contact. Keep case code and secret access. Let an authenticated reporter voluntarily add or change a private contact later, with purpose-specific consent. Analysts can request verification but submission and investigation must not depend on providing a contact.

**Acceptance criteria**

Submit without email/phone, reopen the case portal, exchange messages and supply further evidence. Declining a verification request does not invalidate an allegation. A contact added later never appears to staff.

**Repository evidence**

- [packages/shared/src/report.ts, line 86](<../packages/shared/src/report.ts#L86>)
- [apps/server/test/flow.test.ts, line 133](<../apps/server/test/flow.test.ts#L133>)
- [apps/web/src/components/report/contact-step.tsx, line 136](<../apps/web/src/components/report/contact-step.tsx#L136>)

### G03: Private OTP verification

**Priority:** P0. **Current state:** Missing.

**Observed implementation**

Contact values receive format validation and encryption only. No OTP challenge table, send/confirm endpoints, verification timestamp, phone delivery adapter or analyst verification request exists.

**Required behavior**

Analyst posts a verification request inside a permitted case. Reporter chooses a channel privately in the portal. The vault service sends and validates a code and emits an opaque case-bound result. Staff see pending/verified/declined/expired and a verification time. Use cryptographic code generation, keyed storage of short-code verifiers, short expiry, single use, attempt limits, resend cooldowns, and limits across case/channel/destination. Invalidate obsolete challenges when contact changes.

**Acceptance criteria**

Expired, reused, incorrect, excessive-attempt and cross-case codes fail; concurrent confirmations succeed once. Analyst cannot choose a different destination or view a code. No codes or destinations enter audit, outbox diagnostics or case APIs. Provider failures expose only a safe category. A code confirms control of a contact channel, not legal identity, employment or allegation validity.

**Repository evidence**

- [apps/server/src/db/schema.ts, line 82](<../apps/server/src/db/schema.ts#L82>)
- [apps/server/src/routes/reports.ts, line 71](<../apps/server/src/routes/reports.ts#L71>)
- [apps/server/src/notify/mailer.ts, line 14](<../apps/server/src/notify/mailer.ts#L14>)
- [apps/server/src/app.ts, line 75](<../apps/server/src/app.ts#L75>)

### G04: Staff roles and case access

**Priority:** P0. **Current state:** Missing.

**Observed implementation**

The admins table has no role or disabled state. requireAdmin authenticates but does not authorize by capability or case membership. All accounts can list/read/message/change/download every case. Unread state is shared across all staff.

**Required behavior**

Separate analyst, case manager and system admin capabilities. Analysts access assigned cases; case managers triage and assign within an approved scope. System admins manage staff and configuration without automatic case-content access. Apply case access checks to every endpoint and file download. Keep per-user reads and subscriptions. Any administrative self-grant is an explicit audited security event.

**Acceptance criteria**

An unassigned analyst cannot read a case or its attachment by guessing IDs. A management-only admin cannot retrieve report contents. Revocation takes immediate effect. One analyst reading a case does not clear another analyst's unread count. Permission-denied paths are tested through the API.

**Repository evidence**

- [apps/server/src/db/schema.ts, line 27](<../apps/server/src/db/schema.ts#L27>)
- [apps/server/src/auth/session.ts, line 53](<../apps/server/src/auth/session.ts#L53>)
- [apps/server/src/routes/admin/reports.ts, line 45](<../apps/server/src/routes/admin/reports.ts#L45>)
- [apps/server/src/routes/admin/reports.ts, line 213](<../apps/server/src/routes/admin/reports.ts#L213>)

### G05: Identity clues in content

**Priority:** P0. **Current state:** Partial.

**Observed implementation**

The prompt asks reporters not to identify themselves, but staff receive raw transcripts, submitted descriptions, messages and original filenames. Image EXIF is removed; PDF and Office properties and visible document content are not anonymized. Context can identify a person even without a name.

**Required behavior**

Offer a reporter-visible privacy review before sharing content. Separate originals from sanitized staff views. Use neutral filenames, document-property scrubbing and redaction previews; restrict originals under a documented evidence policy. Warn about identifying text and images without claiming perfect automatic anonymization. Apply the same controls to follow-up messages and evidence.

**Acceptance criteria**

A test transcript containing the reporter's email/name and a document with author metadata is not exposed by the sanitized analyst API. The reporter can review what is shared. Preserve evidence integrity and the derivation history. Explain that unique circumstances can still reveal identity.

**Repository evidence**

- [apps/server/src/routes/admin/reports.ts, line 104](<../apps/server/src/routes/admin/reports.ts#L104>)
- [apps/server/src/lib/attachments.ts, line 43](<../apps/server/src/lib/attachments.ts#L43>)
- [apps/server/src/ai/prompts.ts, line 45](<../apps/server/src/ai/prompts.ts#L45>)
- [apps/web/src/app/(public)/page.tsx, line 73](<../apps/web/src/app/(public)/page.tsx#L73>)

### G06: Platform communication

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

Two-way text messaging exists. Staff messages do not queue reporter notifications. New-report and reporter-reply emails go to every admin. The reporter portal has no automatic refresh, message attachments or reporter read tracking. Staff can still use external contact links.

**Required behavior**

Keep all substantive communication in the portal. Add optional neutral reporter alerts via the vault service and alerts only to authorized staff. Support new evidence during follow-up, refresh/polling with a safe session, unread state and a delivery retry console that hides destinations. Notification emails/SMS should not contain case content or case credentials.

**Acceptance criteria**

An analyst message is visible in the portal and, when opted in, generates a neutral alert. Anonymous reporters can use the portal without notifications. Unassigned staff receive no case-specific notifications. Failed delivery can be retried without revealing a destination.

**Repository evidence**

- [apps/server/src/routes/admin/reports.ts, line 193](<../apps/server/src/routes/admin/reports.ts#L193>)
- [apps/server/src/notify/outbox.ts, line 17](<../apps/server/src/notify/outbox.ts#L17>)
- [apps/server/src/notify/outbox.ts, line 46](<../apps/server/src/notify/outbox.ts#L46>)
- [apps/web/src/app/(public)/status/page.tsx, line 32](<../apps/web/src/app/(public)/status/page.tsx#L32>)

### G07: Investigation lifecycle

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

The system has statuses, notes and messages. A status PATCH accepts any enum value without transition rules or closure reasons. Reporters cannot message a closed case, while staff still can. Completeness reflects intake fields, not substantiation.

**Required behavior**

Add triage, ownership, severity, conflicts of interest/recusal, restricted escalation, tasks, evidence review, findings, outcome, corrective actions, closure reasons and controlled reopening. Separate contact verification, report completeness and allegation substantiation. Provide a reporter-safe outcome distinct from internal findings.

**Acceptance criteria**

Invalid transitions fail. Closure requires outcome and reason; approval is required where policy calls for it. A conflicted analyst loses access. Corrective actions have owners and completion evidence. Reporters can request reopening under policy without learning internal identities or sensitive findings.

**Repository evidence**

- [packages/shared/src/status.ts, line 3](<../packages/shared/src/status.ts#L3>)
- [apps/server/src/routes/admin/reports.ts, line 181](<../apps/server/src/routes/admin/reports.ts#L181>)
- [apps/server/src/routes/status.ts, line 58](<../apps/server/src/routes/status.ts#L58>)
- [apps/server/src/routes/reports.ts, line 21](<../apps/server/src/routes/reports.ts#L21>)

### G08: Staff and company management

**Priority:** P1. **Current state:** Missing.

**Observed implementation**

Staff accounts are created or updated through a CLI. No invitations, disable/reactivate, role editor, teams, password reset flow or company settings UI exists. Categories and workflows are fixed shared constants.

**Required behavior**

Provide audited staff invitations, activation/deactivation, roles, case teams and access reviews. Add company branding, reporting policy, business units, configurable categories, routing rules, notification templates and service targets. Disable accounts and revoke sessions together. Audit sensitive settings and access grants.

**Acceptance criteria**

Admin can onboard and offboard staff without shell access. A disabled user with an existing cookie is rejected. A system admin can manage configuration without case or contact content. Company settings changes are versioned and attributable.

**Repository evidence**

- [apps/server/src/cli/createAdmin.ts, line 33](<../apps/server/src/cli/createAdmin.ts#L33>)
- [apps/server/src/routes/admin/auth.ts, line 19](<../apps/server/src/routes/admin/auth.ts#L19>)
- [apps/server/src/db/schema.ts, line 27](<../apps/server/src/db/schema.ts#L27>)
- [packages/shared/src/report.ts, line 4](<../packages/shared/src/report.ts#L4>)

### G09: Deadlines and escalations

**Priority:** P1. **Current state:** Missing.

**Observed implementation**

There are created/updated timestamps but no acknowledgment deadline, response target, task due date, escalation policy or workload ownership.

**Required behavior**

Add configurable acknowledgment and follow-up targets, business calendars if needed, overdue queues and escalation recipients who already have case access. Route leadership-related reports to an independent restricted team. Track retaliation concerns and ongoing safety risks.

**Acceptance criteria**

An overdue case generates an authorized alert and appears in a work queue. Reassignment preserves deadline history. Escalating a leadership allegation does not grant the implicated manager access. Targets are company policy values, not asserted legal deadlines.

**Repository evidence**

- [apps/server/src/db/schema.ts, line 82](<../apps/server/src/db/schema.ts#L82>)
- [apps/server/src/notify/outbox.ts, line 19](<../apps/server/src/notify/outbox.ts#L19>)

### G10: Evidence safety and custody

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

Uploads use type detection, size/count limits, private disk storage, image re-encoding and a SHA-256 hash of the processed bytes. No malware quarantine, safe preview, original-versus-derived evidence record or follow-up upload route exists. Any staff can download any report attachment.

**Required behavior**

Scan and quarantine uploads before staff access; sandbox previews where appropriate. Preserve an approved original/derived evidence policy, hashes and transformation history; link uploads to case messages and capture uploader role/time. Use encrypted durable storage with per-case access checks and consistent deletion. A sanitized preview must not silently replace authoritative evidence.

**Acceptance criteria**

Quarantined/malicious files cannot be downloaded. Authorized staff can inspect a sanitized preview and verify its relationship to retained evidence. New evidence can be added after submission. File and DB retention remain consistent after failures and restores.

**Repository evidence**

- [apps/server/src/lib/attachments.ts, line 55](<../apps/server/src/lib/attachments.ts#L55>)
- [apps/server/src/lib/storage.ts, line 14](<../apps/server/src/lib/storage.ts#L14>)
- [apps/server/src/routes/intake.ts, line 190](<../apps/server/src/routes/intake.ts#L190>)
- [apps/server/src/db/schema.ts, line 142](<../apps/server/src/db/schema.ts#L142>)

### G11: Audit and oversight

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

Contact reveals, status changes, staff messages and attachment downloads are recorded. Report reads, note creation, login events, staff management and access grants lack equivalent audit events. Audit is a regular table linked to reports with cascading deletion; the UI returns only the newest 100 events.

**Required behavior**

Build a privacy-safe, append-only audit stream with controlled retention, external integrity protection and query/export for an authorized auditor. Record reads, authentication, permissions, assignments, verification outcomes and policy changes. Avoid storing contact values, codes or report bodies in audit metadata. Coordinate audit retention with case deletion policy.

**Acceptance criteria**

Every sensitive action is attributable without identity disclosure. Attempts to alter history are denied or detectable. Case deletion does not silently erase required oversight evidence. Full authorized history is available beyond 100 events.

**Repository evidence**

- [apps/server/src/routes/admin/reports.ts, line 41](<../apps/server/src/routes/admin/reports.ts#L41>)
- [apps/server/src/routes/admin/reports.ts, line 100](<../apps/server/src/routes/admin/reports.ts#L100>)
- [apps/server/src/routes/admin/reports.ts, line 205](<../apps/server/src/routes/admin/reports.ts#L205>)
- [apps/server/src/db/schema.ts, line 162](<../apps/server/src/db/schema.ts#L162>)

### G12: Privacy lifecycle and AI

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

AI consent is checked in the browser, but intake sessions do not store mode, consent version or timestamp, and AI endpoints do not enforce a recorded consent state. Raw conversations are sent to MiniMax. Cleanup removes abandoned intake sessions after expiry but retains submitted cases/transcripts indefinitely. Only contact fields have application encryption.

**Required behavior**

Persist purpose-specific consent and enforce it on the server before external processing. Support a company AI-disable policy and assess provider processing/retention/location terms. Define retention separately for contacts, transcripts, reports, files, outbox, audit and backups, with legal holds and verified deletion. Verify encryption for databases/files/backups and keys; do not equate contact encryption with whole-case protection.

**Acceptance criteria**

A direct AI request without recorded consent fails while the plain form remains available. Retention jobs delete eligible records and files, respect holds and produce safe audit evidence. Rotation and restoration preserve readable authorized data. Privacy copy reflects server storage and approved policy.

**Repository evidence**

- [apps/web/src/components/report/intro-step.tsx, line 31](<../apps/web/src/components/report/intro-step.tsx#L31>)
- [apps/server/src/routes/intake.ts, line 92](<../apps/server/src/routes/intake.ts#L92>)
- [apps/server/src/ai/minimax.ts, line 55](<../apps/server/src/ai/minimax.ts#L55>)
- [apps/server/src/notify/outbox.ts, line 66](<../apps/server/src/notify/outbox.ts#L66>)
- [apps/server/src/crypto/contact.ts, line 18](<../apps/server/src/crypto/contact.ts#L18>)

### G13: Staff authentication and recovery

**Priority:** P1. **Current state:** Partial.

**Observed implementation**

Staff use local passwords and eight-hour DB-backed sessions. No MFA/SSO, inactivity expiry, session management, disable state or self-service recovery exists. CLI password updates do not revoke existing sessions. Reporter secrets have no recovery/rotation path; the submission receipt is retained in tab sessionStorage.

**Required behavior**

Use staff MFA or corporate SSO with appropriate assurance, session revocation and idle limits. Add password recovery and access reviews. Define reporter access recovery without enabling staff lookup: optional verified-contact recovery or separate recovery secret; fully anonymous reporters may remain unrecoverable. Allow secret rotation and an explicit finish/quick-clear action with honest browser-history limits.

**Acceptance criteria**

Offboarding and credential reset invalidate active staff access. Reporter recovery cannot use an arbitrary new contact to take over a case. Anonymous reporters are told clearly when recovery is impossible. No case secrets appear in URLs, staff screens or notifications.

**Repository evidence**

- [apps/server/src/routes/admin/auth.ts, line 19](<../apps/server/src/routes/admin/auth.ts#L19>)
- [apps/server/src/auth/session.ts, line 10](<../apps/server/src/auth/session.ts#L10>)
- [apps/server/src/cli/createAdmin.ts, line 45](<../apps/server/src/cli/createAdmin.ts#L45>)
- [apps/web/src/lib/intake.ts, line 33](<../apps/web/src/lib/intake.ts#L33>)

### G14: Production operations

**Priority:** P1. **Current state:** Not demonstrated.

**Observed implementation**

The repository includes development Compose with PostgreSQL and Mailpit, local uploads and in-process background jobs. No production release pipeline, backup/restore procedure, monitoring or incident runbook was found. Rate limits are in memory and COOKIE_SECURE defaults false. Actual infrastructure logging, TLS, disk encryption and provider controls were not inspected.

**Required behavior**

Establish repeatable CI/releases, production SMTP/phone delivery, HTTPS and secure-cookie enforcement, readiness checks, encrypted backups and tested restoration, secret/key rotation, monitoring and a confidentiality incident response process. Validate privacy at proxy/CDN/database/provider layers. Use shared abuse limits when scaling and carefully configure trusted proxies so limits distinguish users without retaining raw IPs.

**Acceptance criteria**

Restore DB/files/required keys into a clean environment and verify access. A delivery outage is visible and retryable. Multi-instance workers/limits behave correctly. Confirm proxy identity behavior rather than assuming it: Next proxies API calls and trustProxy defaults false. Production anonymity claims require infrastructure evidence.

**Repository evidence**

- [docker-compose.yml, line 1](<../docker-compose.yml#L1>)
- [apps/server/src/config.ts, line 20](<../apps/server/src/config.ts#L20>)
- [apps/server/src/app.ts, line 51](<../apps/server/src/app.ts#L51>)
- [apps/server/src/notify/outbox.ts, line 87](<../apps/server/src/notify/outbox.ts#L87>)
- [apps/web/next.config.ts, line 12](<../apps/web/next.config.ts#L12>)

### G15: Oversight analytics

**Priority:** P2. **Current state:** Missing.

**Observed implementation**

A filtered report list exists; no management metrics, de-identified exports, workload dashboard, recurring-risk tracking or remediation reporting exists.

**Required behavior**

Add role-scoped metrics for case age, time to acknowledgment/closure, backlog, outcomes and corrective-action completion. Use aggregate views with small-group suppression where needed to reduce re-identification. Exports need explicit permissions and audit; exclude contacts and unnecessary narrative content.

**Acceptance criteria**

Management can review backlog and remediation without reporter details. Metrics use defined status timestamps rather than updatedAt as a proxy. Small populations and exports follow an approved privacy policy.

**Repository evidence**

- [apps/server/src/routes/admin/reports.ts, line 51](<../apps/server/src/routes/admin/reports.ts#L51>)
- [apps/server/src/db/schema.ts, line 82](<../apps/server/src/db/schema.ts#L82>)

### G16: Scope, access and language

**Priority:** P2. **Current state:** Decision needed.

**Observed implementation**

The application is a single global case pool with fixed English UI. The assistant can reply in the reporter's language. No company/tenant boundary, multilingual UI policy or documented accessibility/browser acceptance suite exists.

**Required behavior**

For the requested single-company suite, configure one company and optional business-unit routing. Do not add multi-tenancy unless multiple unrelated companies must share a deployment; if they do, isolate cases, vaults, files, search, alerts and exports. Define allowed reporter audiences (employees/contractors/vendors/public), supported languages and mobile/keyboard/screen-reader acceptance scenarios.

**Acceptance criteria**

A reporter can complete the plain and assisted flows on supported mobile and accessible browsers. Business-unit restrictions are enforced server-side. If multi-company scope is added, explicit cross-tenant negative tests cover every data path.

**Repository evidence**

- [apps/server/src/db/schema.ts, line 82](<../apps/server/src/db/schema.ts#L82>)
- [apps/server/src/ai/prompts.ts, line 21](<../apps/server/src/ai/prompts.ts#L21>)
- [apps/web/src/app/(public)/page.tsx, line 22](<../apps/web/src/app/(public)/page.tsx#L22>)

## Proposed role and data-access model

The case-manager capability is a recommendation to support assignment and independent escalation; it need not be a separate account type if the permission model can express it safely.

| Actor | Allowed behavior | Information available |
| --- | --- | --- |
| Reporter | Submit without account or contact; return with case credentials; exchange messages and evidence; voluntarily verify a private contact. | Own report, portal messages, public progress/outcome, and private verification controls. |
| Analyst | Analyze assigned/permitted cases, ask questions, request verification, record findings and corrective actions. | Sanitized case content and verification state/time; no contact destination, OTP, contact hint, or provider details. |
| Case manager | Triage, assign, handle recusals, authorize restricted escalation, and approve closure where policy requires it. | Cases within approved scope; no reporter contact details. |
| System admin | Manage staff, permissions, company policies, templates, retention, and safe operational diagnostics. | Management data; no reporter contacts or automatic case-content access. |
| Restricted contact service | Send/verify codes and deliver opted-in neutral alerts under narrowly scoped service authorization. | Private contacts and delivery data; emits opaque case-bound results. |

Separating the contact service protects stored destinations from application staff. Report text, recognizable documents, and unique circumstances can still identify a person. Infrastructure operators and delivery providers also require explicit access and confidentiality policies; application roles alone do not establish anonymity from them.

### Private verification sequence

1. An analyst creates a verification request inside an authorized case, with a reason.
2. The reporter opens the case portal using existing case credentials and chooses whether to comply. Contact entry and channel selection occur privately.
3. The restricted contact service sends an expiring code. Staff cannot choose a destination, receive the code, or inspect contact hints.
4. The reporter submits the code in the portal. The service validates and consumes the challenge atomically, binding the result to the case and purpose.
5. Staff see a verification result and time, or a safe pending/declined/expired state. Investigation and communication continue inside the portal.

Verification results must remain separate from report completeness and allegation substantiation. Reporter notifications are optional alerts to return to the platform; they must not become an external conversation channel or contain case credentials or substantive case content.

### Suggested data-model additions

- Staff roles, account status, case memberships, per-user reads, and subscriptions.
- Isolated contact records, OTP challenges, and case verification requests/results.
- Assignments, tasks, findings, corrective actions, outcomes, and status history.
- Policy/consent versions, retention rules, legal holds, and expanded audit events.

Prefer case-scoped private contact references over a global reporter profile that unnecessarily correlates separate reports. Contact-service separation must include key and service permissions, not just a new table in the same universally accessible process.

## Recommended delivery order

### 1. Establish the privacy foundation

**Coverage:** G01–G05.

Anonymous submission, isolated contact vault, private OTP verification, analyst/admin authorization and safe staff views.

**Completion gate:** No staff path can retrieve stored contact values. Contact is optional. Cross-case/role denial and OTP abuse tests pass. Content/privacy limitations are explained honestly.

### 2. Complete the operational suite

**Coverage:** G06–G10, staff portion of G13.

Platform alerts and follow-up evidence, assignments/recusal, investigation tasks/findings, closure/reopening, staff management and configurable deadlines.

**Completion gate:** Run a complete anonymous case from submission through assigned investigation and reporter-safe closure, including requested optional verification and restricted escalation.

### 3. Prove production readiness

**Coverage:** G11–G14.

Complete audit, retention and holds, server-enforced AI consent, storage/key controls, secure staff sessions, reliable delivery, release/monitoring/restore procedures.

**Completion gate:** Security/privacy acceptance scenarios, delivery outage recovery and DB/file/key restoration pass; production infrastructure settings and logs are reviewed. These are launch gates, not optional polish.

### 4. Add oversight and broader scope

**Coverage:** G15–G16.

De-identified management analytics, approved exports, language/accessibility coverage and multi-company isolation only if required.

**Completion gate:** Reporting definitions and privacy rules are agreed. Audience/language/jurisdiction requirements are resolved. No invented compliance deadlines or readiness score.

## Decisions still needed for detailed requirements

- Operating country/jurisdiction and company reporting policy.
- Eligible reporter audiences: employees, contractors, vendors, or the public.
- Staff visibility, assignment, and case-management permission model.
- An independent route for allegations against company leadership or the reporting team.
- Retention periods, legal-hold rules, and treatment of evidence originals versus sanitized views.
- Whether employee-status or legal-identity proof is actually needed beyond contact ownership; this would require a separate privacy-preserving design.
- Supported languages and mobile, keyboard, and screen-reader acceptance criteria.
- Single-company deployment versus future use by multiple unrelated companies.

Anonymous submission and hiding contact details from all staff are already agreed requirements. No legal deadlines or compliance obligations are assumed here; applicable policy and jurisdiction must determine them.

## Review and verification boundary

The original assessment reviewed the README, schema, shared validation/types, backend routes, authentication, frontend flows, notification/background jobs, deployment configuration, and test sources at revision `5a7cf34`.

- Monorepo typechecks passed during the assessment.
- All **12 unit tests** passed during the assessment.
- Database integration tests were not rerun because the local Compose database was not running.
- Browser behavior, production infrastructure, live delivery, and the current external AI integration were not validated.
- No application implementation was changed by the assessment. This document records the findings; it does not imply that the gaps have been implemented.

Repository links point to source files with line anchors from the reviewed snapshot. Line numbers may move as implementation proceeds. Revalidate a gap against current code before treating it as still open or complete.

## External technical baselines

- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): least privilege and permission checks for every request and resource.
- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): safe processing, quarantine/scanning, and protected storage.
- [NIST authentication guidance](https://pages.nist.gov/800-63-4/sp800-63b.html): distinguishes email-address confirmation from authentication and describes replay prevention.

These references inform technical recommendations. They do not certify the application or establish its jurisdiction-specific compliance.

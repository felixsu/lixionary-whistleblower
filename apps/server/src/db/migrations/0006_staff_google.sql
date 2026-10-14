ALTER TABLE staff ADD COLUMN password_initialized boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE staff s SET password_initialized=true WHERE EXISTS (
  SELECT 1 FROM audit_events a WHERE
    (a.actor_id=s.id::text AND a.action IN ('invitation_accepted','password_reset','staff_password_authenticated','staff_mfa_authenticated','staff_mfa_recovery'))
    OR (a.action='staff_bootstrapped' AND a.meta->>'staffId'=s.id::text)
);
--> statement-breakpoint
ALTER TABLE staff ADD COLUMN google_sub text UNIQUE;
--> statement-breakpoint
ALTER TABLE staff_sessions ADD COLUMN google_sub_pending text;
--> statement-breakpoint
CREATE TABLE staff_google_transactions (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  nonce text NOT NULL,
  verifier_enc text NOT NULL,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX staff_google_transactions_expiry ON staff_google_transactions(expires_at);

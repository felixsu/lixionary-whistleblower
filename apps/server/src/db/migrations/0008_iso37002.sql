ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS detriment_risk text NOT NULL DEFAULT 'unassessed',
  ADD COLUMN IF NOT EXISTS protection_plan_enc text,
  ADD COLUMN IF NOT EXISTS detriment_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback jsonb;
--> statement-breakpoint
ALTER TABLE case_records DROP CONSTRAINT IF EXISTS case_records_kind_check;
--> statement-breakpoint
ALTER TABLE case_records ADD CONSTRAINT case_records_kind_check CHECK (kind IN ('note','finding','task','reopen','detriment'));

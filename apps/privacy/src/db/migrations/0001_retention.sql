ALTER TABLE files ADD COLUMN original_size integer NOT NULL DEFAULT 0,ADD COLUMN scan_version text,ADD COLUMN scanned_at timestamptz;
ALTER TABLE contacts ADD COLUMN locale text NOT NULL DEFAULT 'en';
CREATE TABLE verification_revisions(case_id uuid PRIMARY KEY,version integer NOT NULL DEFAULT 0);

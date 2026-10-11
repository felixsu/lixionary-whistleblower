ALTER TABLE cases ADD COLUMN privacy_lease uuid,ADD COLUMN privacy_lease_until timestamptz;
ALTER TABLE evidence ADD COLUMN purged_at timestamptz;
ALTER TABLE cases ADD COLUMN closure_enc text,ADD COLUMN verification_version integer NOT NULL DEFAULT 0;

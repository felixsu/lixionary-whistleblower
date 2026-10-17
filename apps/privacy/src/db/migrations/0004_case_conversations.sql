ALTER TABLE intakes ADD COLUMN state_enc text;
CREATE TABLE conversation_operations(id uuid PRIMARY KEY,intake_id uuid NOT NULL REFERENCES intakes ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('start','messages','draft')),input_enc text NOT NULL,result_enc text,status text NOT NULL CHECK(status IN ('running','failed','done')),lease_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX conversation_operations_intake ON conversation_operations(intake_id,created_at);
CREATE UNIQUE INDEX conversation_one_running ON conversation_operations(intake_id) WHERE status='running';
CREATE TABLE conversation_usage(case_id uuid NOT NULL,day date NOT NULL,messages integer NOT NULL DEFAULT 0,drafts integer NOT NULL DEFAULT 0,PRIMARY KEY(case_id,day));

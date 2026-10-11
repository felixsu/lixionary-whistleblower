CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','analyst')),password_hash text NOT NULL,active boolean NOT NULL DEFAULT true,mfa_enc text,mfa_pending_enc text,mfa_last_step bigint,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE staff_recovery(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES staff ON DELETE CASCADE,secret_hash text NOT NULL,used_at timestamptz);
CREATE TABLE staff_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,staff_id uuid NOT NULL REFERENCES staff ON DELETE CASCADE,mfa boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL);
CREATE TABLE staff_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES staff ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,purpose text NOT NULL CHECK(purpose IN ('invitation','password_reset')),expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE TABLE teams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,restricted boolean NOT NULL DEFAULT false);
CREATE TABLE team_members(team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,staff_id uuid NOT NULL REFERENCES staff ON DELETE CASCADE,PRIMARY KEY(team_id,staff_id));
CREATE TABLE settings(id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL DEFAULT 1,body jsonb NOT NULL,configured boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_code text UNIQUE NOT NULL,pin_hash text NOT NULL,recovery_hash text NOT NULL,secret_version integer NOT NULL DEFAULT 1,content_enc text NOT NULL,category text NOT NULL,state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','triage','investigating','waiting_reporter','closure_review','closed')),sensitive boolean NOT NULL DEFAULT false,team_id uuid REFERENCES teams,owner_id uuid REFERENCES staff,severity text NOT NULL DEFAULT 'normal',closure jsonb,hold boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),acknowledged_at timestamptz,last_response_at timestamptz,closed_at timestamptz,verified_at timestamptz,verification_state text NOT NULL DEFAULT 'none');
CREATE INDEX cases_team_idx ON cases(team_id,state);
CREATE TABLE case_members(case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,staff_id uuid NOT NULL REFERENCES staff ON DELETE CASCADE,recused boolean NOT NULL DEFAULT false,read_at timestamptz,subscribed boolean NOT NULL DEFAULT true,PRIMARY KEY(case_id,staff_id));
CREATE TABLE reporter_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,secret_version integer NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,read_at timestamptz);
CREATE TABLE case_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,author text NOT NULL,staff_id uuid REFERENCES staff,body_enc text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE case_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,staff_id uuid REFERENCES staff,kind text NOT NULL CHECK(kind IN ('note','finding','task','reopen')),body_enc text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),due_at timestamptz,completed_at timestamptz,owner_id uuid REFERENCES staff);
CREATE TABLE evidence(id uuid PRIMARY KEY,case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,label text NOT NULL,mime text NOT NULL,size integer NOT NULL,sha256 text NOT NULL,original_sha256 text NOT NULL,transformation text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE verification_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES cases ON DELETE CASCADE,staff_id uuid NOT NULL REFERENCES staff,reason_enc text NOT NULL,state text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,case_id uuid,staff_id uuid,body jsonb NOT NULL DEFAULT '{}',attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_at timestamptz,sent_at timestamptz,error_code text,created_at timestamptz NOT NULL DEFAULT now(),dedupe text UNIQUE);
CREATE INDEX jobs_due_idx ON jobs(next_at) WHERE sent_at IS NULL;
CREATE TABLE event_receipts(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE deletion_manifest(case_id uuid PRIMARY KEY,deleted_at timestamptz NOT NULL DEFAULT now(),privacy_complete boolean NOT NULL DEFAULT false);
CREATE TABLE audit_anchors(seq bigint PRIMARY KEY,hash text NOT NULL,checkpoint_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events(seq bigserial PRIMARY KEY,id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),actor_id text NOT NULL,case_id uuid,action text NOT NULL,meta jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),previous_hash text NOT NULL DEFAULT '',hash text NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE FUNCTION append_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(734592);
 NEW.seq := nextval('audit_events_seq_seq');
 SELECT hash INTO NEW.previous_hash FROM audit_events ORDER BY seq DESC LIMIT 1;
 NEW.previous_hash := coalesce(NEW.previous_hash,(SELECT hash FROM audit_anchors ORDER BY seq DESC LIMIT 1),'');
 NEW.hash := encode(digest(NEW.previous_hash || NEW.id::text || NEW.actor_id || coalesce(NEW.case_id::text,'') || NEW.action || NEW.meta::text || NEW.created_at::text,'sha256'),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION append_audit();
CREATE FUNCTION immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' AND session_user='postgres' AND current_setting('suite.audit_prune',true)='on' THEN RETURN OLD; END IF; RAISE EXCEPTION 'audit history is immutable'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_audit();

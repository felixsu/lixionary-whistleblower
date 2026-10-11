CREATE TABLE IF NOT EXISTS audit_anchors(seq bigint PRIMARY KEY,hash text NOT NULL,checkpoint_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE case_members ADD COLUMN IF NOT EXISTS subscribed boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION append_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(734592);
 NEW.seq := nextval('audit_events_seq_seq');
 SELECT hash INTO NEW.previous_hash FROM audit_events ORDER BY seq DESC LIMIT 1;
 NEW.previous_hash := coalesce(NEW.previous_hash,(SELECT hash FROM audit_anchors ORDER BY seq DESC LIMIT 1),'');
 NEW.hash := encode(digest(NEW.previous_hash || NEW.id::text || NEW.actor_id || coalesce(NEW.case_id::text,'') || NEW.action || NEW.meta::text || NEW.created_at::text,'sha256'),'hex');
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND session_user='postgres' AND current_setting('suite.audit_prune',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'audit history is immutable';
END $$;

CREATE TABLE settings_history(version integer PRIMARY KEY,body jsonb NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION immutable_settings_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'policy history is immutable'; END $$;
CREATE TRIGGER settings_history_immutable BEFORE UPDATE OR DELETE ON settings_history FOR EACH ROW EXECUTE FUNCTION immutable_settings_history();

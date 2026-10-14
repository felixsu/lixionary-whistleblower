CREATE TABLE rate_limits (key text PRIMARY KEY, hits bigint NOT NULL CHECK (hits > 0), expires_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);

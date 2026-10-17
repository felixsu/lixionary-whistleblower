ALTER TABLE case_messages ADD COLUMN client_message_id uuid;
CREATE UNIQUE INDEX case_message_retry ON case_messages(case_id,client_message_id) WHERE client_message_id IS NOT NULL;

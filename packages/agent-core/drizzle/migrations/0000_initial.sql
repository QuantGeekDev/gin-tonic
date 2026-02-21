CREATE TABLE IF NOT EXISTS session_messages (
  session_key text NOT NULL,
  message_index integer NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_messages_pk PRIMARY KEY (session_key, message_index)
);

CREATE TABLE IF NOT EXISTS memories (
  id text PRIMARY KEY,
  namespace text NOT NULL,
  text text NOT NULL,
  tags jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id text PRIMARY KEY,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gateway_idempotency (
  session_key text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at_ms bigint NOT NULL,
  CONSTRAINT gateway_idempotency_pk PRIMARY KEY (session_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS gateway_session_locks (
  session_key text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

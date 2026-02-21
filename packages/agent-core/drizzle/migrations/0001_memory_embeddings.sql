ALTER TABLE memories
ADD COLUMN IF NOT EXISTS embedding jsonb;

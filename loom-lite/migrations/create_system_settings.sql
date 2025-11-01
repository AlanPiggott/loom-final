-- Migration: create_system_settings.sql
-- Purpose: store global configuration (e.g., worker concurrency)

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES auth.users (id)
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_settings_service_role_full_access
ON system_settings
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

INSERT INTO system_settings (key, value)
VALUES ('max_concurrent_jobs', jsonb_build_object('limit', 3))
ON CONFLICT (key) DO NOTHING;

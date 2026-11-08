CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, auth_version TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admin_audit_date ON admin_audit(created_at);
CREATE TABLE IF NOT EXISTS system_settings (id TEXT PRIMARY KEY CHECK(id='general'), value_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS resource_publication (source_id TEXT PRIMARY KEY REFERENCES retrieval_sources(id), status TEXT NOT NULL CHECK(status IN ('draft','published','archived')), reviewed_at TEXT, reviewed_by TEXT, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, revision_id TEXT);
UPDATE memory_settings SET enabled=1;

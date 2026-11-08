CREATE TABLE IF NOT EXISTS memory_settings (account_id TEXT PRIMARY KEY REFERENCES accounts(id), enabled INTEGER NOT NULL DEFAULT 1, backfilled INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS retrieval_sources (id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('personal','shared')), account_id TEXT, title TEXT NOT NULL, url TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS retrieval_sources_owner ON retrieval_sources(account_id,scope,created_at);
CREATE TABLE IF NOT EXISTS retrieval_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES retrieval_sources(id), scope TEXT NOT NULL, account_id TEXT, body TEXT NOT NULL, indexed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS retrieval_jobs ON retrieval_chunks(next_attempt_at,lease_until,indexed_at);
CREATE TABLE IF NOT EXISTS resource_admins (account_id TEXT PRIMARY KEY REFERENCES accounts(id));

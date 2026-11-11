CREATE TABLE IF NOT EXISTS care_invites (code_hash TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS care_invites_owner ON care_invites(owner_account_id);
CREATE TABLE IF NOT EXISTS care_access (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, caregiver_account_id TEXT NOT NULL, role TEXT NOT NULL, caregiver_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_account_id, caregiver_account_id));
CREATE INDEX IF NOT EXISTS care_access_caregiver ON care_access(caregiver_account_id);

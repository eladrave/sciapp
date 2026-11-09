CREATE TABLE IF NOT EXISTS push_setup_diagnostics (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 browser_id TEXT NOT NULL,
 phase TEXT NOT NULL,
 details TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,browser_id,phase)
);
CREATE INDEX IF NOT EXISTS push_diagnostics_account ON push_setup_diagnostics(account_id,updated_at DESC);

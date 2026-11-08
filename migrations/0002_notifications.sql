CREATE TABLE IF NOT EXISTS push_subscriptions (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 endpoint TEXT NOT NULL UNIQUE,
 subscription TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_accepted_at INTEGER,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS push_account ON push_subscriptions(account_id);
CREATE TABLE IF NOT EXISTS notification_deliveries (
 subscription_id TEXT NOT NULL,
 occurrence_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 lease_until INTEGER NOT NULL,
 accepted_at INTEGER,
 last_error TEXT,
 PRIMARY KEY(subscription_id,occurrence_id)
);
CREATE INDEX IF NOT EXISTS notification_expiry ON notification_deliveries(lease_until);

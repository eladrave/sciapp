/* Server-managed identity mapping; clients never submit mapping or email claims.
Keep account IDs stable so photos, events and device subscriptions remain owned. */
CREATE TABLE IF NOT EXISTS account_identities (
 subject TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 created_at TEXT NOT NULL,
 UNIQUE(account_id)
);

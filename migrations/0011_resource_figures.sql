/* Page images of figures found in an uploaded document. Shown in chat only while a resource using the upload is published. */
CREATE TABLE IF NOT EXISTS resource_figures (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL REFERENCES resource_uploads(id), page INTEGER NOT NULL, label TEXT NOT NULL, caption TEXT NOT NULL, r2_key TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(upload_id,label));
CREATE INDEX IF NOT EXISTS resource_figures_upload ON resource_figures(upload_id,page);

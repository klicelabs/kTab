CREATE TABLE IF NOT EXISTS pexels_cache (
	query TEXT NOT NULL,
	page INTEGER NOT NULL CHECK (page BETWEEN 1 AND 5),
	cached_at INTEGER NOT NULL,
	photos_json TEXT NOT NULL,
	rate_limit_json TEXT,
	PRIMARY KEY (query, page)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS pexels_cache_cached_at_idx
	ON pexels_cache (cached_at DESC);

CREATE TABLE IF NOT EXISTS pexels_usage (
	kind TEXT NOT NULL CHECK (kind IN ('day', 'hour', 'custom_hour')),
	bucket INTEGER NOT NULL,
	count INTEGER NOT NULL CHECK (count >= 0),
	PRIMARY KEY (kind, bucket)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS pexels_provider_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	blocked_until INTEGER NOT NULL DEFAULT 0,
	rate_limit_json TEXT
);

-- Automated editorial state (docs/AUTOMATION.md). The hourly job writes here; the page reads it at runtime.
-- Only meaningful when AUTOMATION_ENABLED=true; otherwise the build-time snapshot in git is what visitors see.
CREATE TABLE status_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),             -- single row
  status TEXT NOT NULL CHECK (status IN ('yes', 'no', 'unverified')),
  checked_at TEXT,                                    -- UTC ISO; null when unverified
  verified_by TEXT NOT NULL,                          -- 'auto-gemini' or an editor handle
  mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual')), -- manual = a human owns it; the job never touches it
  reason TEXT,                                        -- internal reason code, never shown publicly
  evidence TEXT NOT NULL DEFAULT '[]',                -- JSON array of {publisher,title,url}; required for 'yes'
  updated_at TEXT NOT NULL
);

CREATE TABLE news_items (
  id TEXT PRIMARY KEY,
  headline TEXT NOT NULL,
  published_at TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL
);
CREATE INDEX news_items_published_idx ON news_items(published_at DESC);

-- One row per job run: counts and reason codes only, nothing identifying.
CREATE TABLE editorial_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL
);

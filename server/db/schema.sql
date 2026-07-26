-- PostgreSQL Compatible SQLite Schema
-- 本地開發用，與 PostgreSQL 完全兼容

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  is_active INTEGER DEFAULT 1,
  public_display_name TEXT NOT NULL,
  deleted_at TEXT,
  disabled_reason TEXT
);

-- User Settings table
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  save_notes_to_cloud INTEGER DEFAULT 1,
  save_divination_to_cloud INTEGER DEFAULT 0,
  allow_public_notes INTEGER DEFAULT 0,
  note_visibility_threshold_percent REAL DEFAULT 60.0,
  language TEXT DEFAULT 'zh-TW',
  timezone TEXT DEFAULT 'Asia/Taipei',
  notify_on_reply INTEGER DEFAULT 1,
  terms_accepted INTEGER DEFAULT 0,
  accepted_terms_version TEXT,
  terms_accepted_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Divination Records table
CREATE TABLE IF NOT EXISTS divination_records (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id TEXT NOT NULL,
  gua_id INTEGER NOT NULL,
  question_text TEXT,
  result_payload TEXT NOT NULL,
  source TEXT DEFAULT 'cloud' CHECK(source IN ('local', 'cloud', 'imported')),
  local_uuid TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_divination_user ON divination_records(user_id);
CREATE INDEX IF NOT EXISTS idx_divination_local_uuid ON divination_records(local_uuid);
CREATE INDEX IF NOT EXISTS idx_divination_created ON divination_records(created_at);

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  author_id TEXT NOT NULL,
  article_type TEXT NOT NULL CHECK(article_type IN ('iching', 'ichuan', 'md', 'other')),
  article_id TEXT NOT NULL,
  paragraph_anchor TEXT NOT NULL,
  anchor_offset_start INTEGER NOT NULL,
  anchor_offset_end INTEGER NOT NULL,
  cluster_key INTEGER NOT NULL,
  local_uuid TEXT,
  content TEXT NOT NULL,
  visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private', 'public')),
  public_alias TEXT,
  upvote_count INTEGER DEFAULT 0,
  downvote_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'deleted')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id);
CREATE INDEX IF NOT EXISTS idx_notes_article ON notes(article_id, paragraph_anchor);
CREATE INDEX IF NOT EXISTS idx_notes_cluster ON notes(article_id, paragraph_anchor, cluster_key);
CREATE INDEX IF NOT EXISTS idx_notes_visibility ON notes(visibility, article_id, paragraph_anchor);
CREATE INDEX IF NOT EXISTS idx_notes_score ON notes(article_id, paragraph_anchor, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_local_uuid ON notes(local_uuid);

-- Note Votes table
CREATE TABLE IF NOT EXISTS note_votes (
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id, user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Note Favorites table
CREATE TABLE IF NOT EXISTS note_favorites (
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id, user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Note Replies table
CREATE TABLE IF NOT EXISTS note_replies (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  note_id TEXT NOT NULL,
  parent_reply_id TEXT,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  upvote_count INTEGER DEFAULT 0,
  downvote_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'deleted')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_reply_id) REFERENCES note_replies(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_replies_note ON note_replies(note_id);
CREATE INDEX IF NOT EXISTS idx_note_replies_parent ON note_replies(parent_reply_id);
CREATE INDEX IF NOT EXISTS idx_note_replies_author ON note_replies(author_id);

-- Legal Consents table
CREATE TABLE IF NOT EXISTS legal_consents (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('terms', 'privacy', 'community')),
  doc_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, doc_type, doc_version)
);

CREATE INDEX IF NOT EXISTS idx_legal_consents_user ON legal_consents(user_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('reply', 'system')),
  actor_user_id TEXT,
  target_type TEXT NOT NULL CHECK(target_type IN ('note', 'reply', 'system')),
  target_id TEXT,
  note_id TEXT,
  reply_id TEXT,
  article_id TEXT,
  paragraph_anchor TEXT,
  deep_link TEXT,
  target_deleted INTEGER DEFAULT 0,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL,
  FOREIGN KEY (reply_id) REFERENCES note_replies(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- User Stats table
CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY,
  total_replies_received INTEGER DEFAULT 0,
  unread_notifications_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Deletion Audit Logs table
CREATE TABLE IF NOT EXISTS deletion_audit_logs (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('delete_data', 'delete_account')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed', 'cancelled')),
  failure_code TEXT,
  failure_reason TEXT,
  request_ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deletion_logs_user ON deletion_audit_logs(user_id);

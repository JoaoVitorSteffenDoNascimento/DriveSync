CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    local_path TEXT NOT NULL,
    remote_folder_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS synced_files (
    folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    remote_file_id TEXT NOT NULL DEFAULT '',
    remote_md5 TEXT NOT NULL DEFAULT '',
    remote_mod_time TEXT NOT NULL DEFAULT '',
    local_size INTEGER NOT NULL DEFAULT 0,
    local_mtime_ns INTEGER NOT NULL DEFAULT 0,
    local_md5 TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'remote',
    deleted_on_remote INTEGER NOT NULL DEFAULT 0,
    kept_local_hash TEXT NOT NULL DEFAULT '',
    kept_local_mtime_ns INTEGER NOT NULL DEFAULT 0,
    ignored_local_delete INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (folder_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_synced_files_remote_id ON synced_files(folder_id, remote_file_id);

CREATE TABLE IF NOT EXISTS known_senders (
    folder_id TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (folder_id, email)
);

CREATE TABLE IF NOT EXISTS blocked_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    local_path TEXT NOT NULL DEFAULT '',
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    author_email TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    detail TEXT NOT NULL,
    detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_files_folder ON blocked_files(folder_id, reason);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    relative_path TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT '',
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    folder_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (folder_id, device_id)
);

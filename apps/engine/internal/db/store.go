package db

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

type SyncedFileRecord struct {
	FolderID           string
	RelativePath       string
	RemoteFileID       string
	RemoteMD5          string
	RemoteModTime      string
	LocalSize          int64
	LocalMtimeNs       int64
	LocalMD5           string
	AuthorEmail        string
	AuthorName         string
	Origin             string // "local" | "remote"
	DeletedOnRemote    bool
	KeptLocalHash      string
	KeptLocalMtimeNs   int64
	IgnoredLocalDelete bool
	UpdatedAt          string
}

type OAuthClientConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type Store struct {
	sqlDB *sql.DB
}

func Open(dbPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA synchronous=NORMAL;",
		"PRAGMA busy_timeout=5000;",
		"PRAGMA foreign_keys=ON;",
	}
	for _, p := range pragmas {
		if _, err := conn.Exec(p); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("pragma %q: %w", p, err)
		}
	}

	if _, err := conn.Exec(schemaSQL); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	return &Store{sqlDB: conn}, nil
}

func (s *Store) Close() error {
	if s == nil || s.sqlDB == nil {
		return nil
	}
	return s.sqlDB.Close()
}

func nowISO() string {
	return time.Now().Format(time.RFC3339)
}

func (s *Store) GetKV(key string) ([]byte, bool, error) {
	var raw []byte
	err := s.sqlDB.QueryRow(`SELECT value FROM kv_store WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return raw, true, nil
}

func (s *Store) SetKV(key string, val []byte) error {
	_, err := s.sqlDB.Exec(`
		INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
	`, key, val, nowISO())
	return err
}

func (s *Store) DeleteKV(key string) error {
	_, err := s.sqlDB.Exec(`DELETE FROM kv_store WHERE key = ?`, key)
	return err
}

func (s *Store) GetSettings() (config.AppSettings, error) {
	raw, ok, err := s.GetKV("app_settings")
	if err != nil {
		return config.AppSettings{}, err
	}
	if !ok {
		def := config.DefaultSettings()
		if saveErr := s.SaveSettings(def); saveErr != nil {
			return def, saveErr
		}
		return def, nil
	}
	var st config.AppSettings
	if err := json.Unmarshal(raw, &st); err != nil {
		return config.DefaultSettings(), err
	}
	if st.DeviceID == "" {
		st.DeviceID = config.NewID()
	}
	if st.DeviceName == "" {
		st.DeviceName = config.DefaultDeviceName()
	}
	if st.MaxUploadBytes <= 0 || st.MaxUploadBytes > config.MaxUploadBytes {
		st.MaxUploadBytes = config.MaxUploadBytes
	}
	if st.PollIntervalSeconds < 10 {
		st.PollIntervalSeconds = 45
	}
	if st.DefaultOnRemoteDelete == "" {
		st.DefaultOnRemoteDelete = config.RemoteDeleteKeepLocal
	}
	return st, nil
}

func (s *Store) SaveSettings(st config.AppSettings) error {
	// Nunca permite ultrapassar o teto rígido de 4 GiB.
	if st.MaxUploadBytes <= 0 || st.MaxUploadBytes > config.MaxUploadBytes {
		st.MaxUploadBytes = config.MaxUploadBytes
	}
	if st.PollIntervalSeconds < 10 {
		st.PollIntervalSeconds = 10
	}
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return s.SetKV("app_settings", raw)
}

func (s *Store) GetAccount() (config.AccountInfo, error) {
	raw, ok, err := s.GetKV("account_info")
	if err != nil {
		return config.AccountInfo{}, err
	}
	_, hasClient, _ := s.GetKV("oauth_client")
	if !ok {
		return config.AccountInfo{
			Connected:            false,
			AuthSource:           "none",
			HasCustomOAuthClient: hasClient,
		}, nil
	}
	var acc config.AccountInfo
	if err := json.Unmarshal(raw, &acc); err != nil {
		return config.AccountInfo{AuthSource: "none", HasCustomOAuthClient: hasClient}, err
	}
	acc.HasCustomOAuthClient = hasClient
	return acc, nil
}

func (s *Store) SaveAccount(acc config.AccountInfo) error {
	raw, err := json.Marshal(acc)
	if err != nil {
		return err
	}
	return s.SetKV("account_info", raw)
}

func (s *Store) SaveOAuthClient(cfg OAuthClientConfig) error {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return s.SetKV("oauth_client", raw)
}

func (s *Store) GetOAuthClient() (OAuthClientConfig, bool, error) {
	raw, ok, err := s.GetKV("oauth_client")
	if err != nil || !ok {
		return OAuthClientConfig{}, ok, err
	}
	var cfg OAuthClientConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return OAuthClientConfig{}, false, err
	}
	return cfg, true, nil
}

func (s *Store) ListFolders() ([]config.SyncFolderConfig, error) {
	rows, err := s.sqlDB.Query(`SELECT config_json FROM sync_folders ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []config.SyncFolderConfig
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var cfg config.SyncFolderConfig
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			return nil, err
		}
		result = append(result, cfg)
	}
	return result, rows.Err()
}

func (s *Store) GetFolder(id string) (config.SyncFolderConfig, error) {
	var raw string
	err := s.sqlDB.QueryRow(`SELECT config_json FROM sync_folders WHERE id = ?`, id).Scan(&raw)
	if err != nil {
		return config.SyncFolderConfig{}, err
	}
	var cfg config.SyncFolderConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return config.SyncFolderConfig{}, err
	}
	return cfg, nil
}

func (s *Store) UpsertFolder(cfg config.SyncFolderConfig) error {
	if cfg.CreatedAt == "" {
		cfg.CreatedAt = nowISO()
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	pausedInt := 0
	if cfg.Paused {
		pausedInt = 1
	}
	_, err = s.sqlDB.Exec(`
		INSERT INTO sync_folders (id, name, local_path, remote_folder_id, kind, paused, config_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name,
			local_path=excluded.local_path,
			remote_folder_id=excluded.remote_folder_id,
			kind=excluded.kind,
			paused=excluded.paused,
			config_json=excluded.config_json
	`, cfg.ID, cfg.Name, cfg.LocalPath, cfg.RemoteFolderID, string(cfg.Kind), pausedInt, string(raw), cfg.CreatedAt)
	return err
}

func (s *Store) DeleteFolder(id string) error {
	tx, err := s.sqlDB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM synced_files WHERE folder_id = ?`,
		`DELETE FROM known_senders WHERE folder_id = ?`,
		`DELETE FROM blocked_files WHERE folder_id = ?`,
		`DELETE FROM devices WHERE folder_id = ?`,
		`DELETE FROM sync_folders WHERE id = ?`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetSyncedFiles(folderID string) (map[string]SyncedFileRecord, error) {
	rows, err := s.sqlDB.Query(`
		SELECT folder_id, relative_path, remote_file_id, remote_md5, remote_mod_time,
		       local_size, local_mtime_ns, local_md5, author_email, author_name, origin,
		       deleted_on_remote, kept_local_hash, kept_local_mtime_ns, ignored_local_delete, updated_at
		FROM synced_files WHERE folder_id = ?
	`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]SyncedFileRecord)
	for rows.Next() {
		var r SyncedFileRecord
		var delRemote, ignLocal int
		if err := rows.Scan(
			&r.FolderID, &r.RelativePath, &r.RemoteFileID, &r.RemoteMD5, &r.RemoteModTime,
			&r.LocalSize, &r.LocalMtimeNs, &r.LocalMD5, &r.AuthorEmail, &r.AuthorName, &r.Origin,
			&delRemote, &r.KeptLocalHash, &r.KeptLocalMtimeNs, &ignLocal, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		r.DeletedOnRemote = delRemote == 1
		r.IgnoredLocalDelete = ignLocal == 1
		out[r.RelativePath] = r
	}
	return out, rows.Err()
}

func (s *Store) UpsertSyncedFile(r SyncedFileRecord) error {
	if r.UpdatedAt == "" {
		r.UpdatedAt = nowISO()
	}
	delRemote := 0
	if r.DeletedOnRemote {
		delRemote = 1
	}
	ignLocal := 0
	if r.IgnoredLocalDelete {
		ignLocal = 1
	}
	_, err := s.sqlDB.Exec(`
		INSERT INTO synced_files (
			folder_id, relative_path, remote_file_id, remote_md5, remote_mod_time,
			local_size, local_mtime_ns, local_md5, author_email, author_name, origin,
			deleted_on_remote, kept_local_hash, kept_local_mtime_ns, ignored_local_delete, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(folder_id, relative_path) DO UPDATE SET
			remote_file_id=excluded.remote_file_id,
			remote_md5=excluded.remote_md5,
			remote_mod_time=excluded.remote_mod_time,
			local_size=excluded.local_size,
			local_mtime_ns=excluded.local_mtime_ns,
			local_md5=excluded.local_md5,
			author_email=excluded.author_email,
			author_name=excluded.author_name,
			origin=excluded.origin,
			deleted_on_remote=excluded.deleted_on_remote,
			kept_local_hash=excluded.kept_local_hash,
			kept_local_mtime_ns=excluded.kept_local_mtime_ns,
			ignored_local_delete=excluded.ignored_local_delete,
			updated_at=excluded.updated_at
	`,
		r.FolderID, r.RelativePath, r.RemoteFileID, r.RemoteMD5, r.RemoteModTime,
		r.LocalSize, r.LocalMtimeNs, r.LocalMD5, r.AuthorEmail, r.AuthorName, r.Origin,
		delRemote, r.KeptLocalHash, r.KeptLocalMtimeNs, ignLocal, r.UpdatedAt,
	)
	return err
}

func (s *Store) DeleteSyncedFile(folderID, relativePath string) error {
	_, err := s.sqlDB.Exec(`DELETE FROM synced_files WHERE folder_id = ? AND relative_path = ?`, folderID, relativePath)
	return err
}

func (s *Store) CountSyncedStats(folderID string) (syncedCount int, keptLocalCount int, err error) {
	err = s.sqlDB.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN deleted_on_remote = 0 AND ignored_local_delete = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN deleted_on_remote = 1 THEN 1 ELSE 0 END), 0)
		FROM synced_files WHERE folder_id = ?
	`, folderID).Scan(&syncedCount, &keptLocalCount)
	return
}

func (s *Store) UpsertKnownSender(folderID, email, displayName string) error {
	norm := config.NormalizeEmail(email)
	if norm == "" {
		return nil
	}
	_, err := s.sqlDB.Exec(`
		INSERT INTO known_senders (folder_id, email, display_name, last_seen_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(folder_id, email) DO UPDATE SET
			display_name=CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE known_senders.display_name END,
			last_seen_at=excluded.last_seen_at
	`, folderID, norm, displayName, nowISO())
	return err
}

func (s *Store) ListKnownSenders(folderID string) ([]config.KnownSender, error) {
	query := `SELECT folder_id, email, display_name, last_seen_at FROM known_senders`
	var args []any
	if folderID != "" {
		query += ` WHERE folder_id = ?`
		args = append(args, folderID)
	}
	query += ` ORDER BY last_seen_at DESC`
	rows, err := s.sqlDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []config.KnownSender
	for rows.Next() {
		var ks config.KnownSender
		if err := rows.Scan(&ks.FolderID, &ks.Email, &ks.DisplayName, &ks.LastSeenAt); err != nil {
			return nil, err
		}
		out = append(out, ks)
	}
	return out, rows.Err()
}

func (s *Store) ClearBlockedFilesForFolder(folderID string) error {
	_, err := s.sqlDB.Exec(`DELETE FROM blocked_files WHERE folder_id = ?`, folderID)
	return err
}

func (s *Store) AddBlockedFile(entry config.BlockedFileEntry) error {
	if entry.DetectedAt == "" {
		entry.DetectedAt = nowISO()
	}
	_, err := s.sqlDB.Exec(`
		INSERT INTO blocked_files (folder_id, folder_name, relative_path, local_path, file_size_bytes, author_email, author_name, reason, detail, detected_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, entry.FolderID, entry.FolderName, entry.RelativePath, entry.LocalPath, entry.FileSizeBytes, entry.AuthorEmail, entry.AuthorName, entry.Reason, entry.Detail, entry.DetectedAt)
	return err
}

func (s *Store) ListBlockedFiles() ([]config.BlockedFileEntry, error) {
	rows, err := s.sqlDB.Query(`
		SELECT id, folder_id, folder_name, relative_path, local_path, file_size_bytes, author_email, author_name, reason, detail, detected_at
		FROM blocked_files ORDER BY id DESC LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []config.BlockedFileEntry
	for rows.Next() {
		var e config.BlockedFileEntry
		if err := rows.Scan(&e.ID, &e.FolderID, &e.FolderName, &e.RelativePath, &e.LocalPath, &e.FileSizeBytes, &e.AuthorEmail, &e.AuthorName, &e.Reason, &e.Detail, &e.DetectedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) AddActivity(ev config.ActivityEvent) error {
	if ev.CreatedAt == "" {
		ev.CreatedAt = nowISO()
	}
	_, err := s.sqlDB.Exec(`
		INSERT INTO activity_log (folder_id, folder_name, kind, level, message, relative_path, author_email, file_size_bytes, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, ev.FolderID, ev.FolderName, ev.Kind, ev.Level, ev.Message, ev.RelativePath, ev.AuthorEmail, ev.FileSizeBytes, ev.CreatedAt)
	if err != nil {
		return err
	}
	// Mantém histórico recente enxuto (últimos 1000 registros)
	_, _ = s.sqlDB.Exec(`DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 1000)`)
	return nil
}

func (s *Store) ListRecentActivity(limit int) ([]config.ActivityEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.sqlDB.Query(`
		SELECT id, folder_id, folder_name, kind, level, message, relative_path, author_email, file_size_bytes, created_at
		FROM activity_log ORDER BY id DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []config.ActivityEvent
	for rows.Next() {
		var ev config.ActivityEvent
		if err := rows.Scan(&ev.ID, &ev.FolderID, &ev.FolderName, &ev.Kind, &ev.Level, &ev.Message, &ev.RelativePath, &ev.AuthorEmail, &ev.FileSizeBytes, &ev.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (s *Store) UpsertDevice(dev config.DeviceRegistration) error {
	raw, err := json.Marshal(dev)
	if err != nil {
		return err
	}
	_, err = s.sqlDB.Exec(`
		INSERT INTO devices (folder_id, device_id, payload_json, last_seen_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(folder_id, device_id) DO UPDATE SET
			payload_json=excluded.payload_json,
			last_seen_at=excluded.last_seen_at
	`, dev.FolderID, dev.DeviceID, string(raw), dev.LastSeenAt)
	return err
}

func (s *Store) ListDevices() ([]config.DeviceRegistration, error) {
	rows, err := s.sqlDB.Query(`SELECT payload_json FROM devices ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []config.DeviceRegistration
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var dev config.DeviceRegistration
		if err := json.Unmarshal([]byte(raw), &dev); err != nil {
			continue
		}
		out = append(out, dev)
	}
	return out, rows.Err()
}

func (s *Store) DeleteDevice(folderID, deviceID string) error {
	_, err := s.sqlDB.Exec(`DELETE FROM devices WHERE folder_id = ? AND device_id = ?`, folderID, deviceID)
	return err
}

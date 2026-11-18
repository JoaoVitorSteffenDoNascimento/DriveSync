package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
	"github.com/brendha/drivesync/engine/internal/syncer"
	"github.com/brendha/drivesync/engine/internal/watcher"
	"github.com/gorilla/websocket"
)

type Server struct {
	token        string
	store        *db.Store
	auth         *drive.AuthManager
	syncer       *syncer.Syncer
	watcher      *watcher.FolderWatcher
	refresh      func()
	driveFactory func(context.Context) (drive.API, error)

	wsMu    sync.Mutex
	wsConns map[*websocket.Conn]struct{}
}

func NewServer(
	token string,
	store *db.Store,
	auth *drive.AuthManager,
	sy *syncer.Syncer,
	fw *watcher.FolderWatcher,
	onDriveReconnect func(),
) *Server {
	return &Server{
		token:   token,
		store:   store,
		auth:    auth,
		syncer:  sy,
		watcher: fw,
		refresh: onDriveReconnect,
		wsConns: make(map[*websocket.Conn]struct{}),
	}
}

func (s *Server) Broadcast(eventType string, payload any) {
	msg, err := json.Marshal(map[string]any{
		"type":    eventType,
		"payload": payload,
	})
	if err != nil {
		return
	}
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	for conn := range s.wsConns {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			_ = conn.Close()
			delete(s.wsConns, conn)
		}
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/ws", s.withAuth(s.handleWS))
	mux.HandleFunc("/api/snapshot", s.withAuth(s.handleSnapshot))
	mux.HandleFunc("/api/auth/oauth/client", s.withAuth(s.handleOAuthClient))
	mux.HandleFunc("/api/auth/oauth/google-json", s.withAuth(s.handleOAuthGoogleJSON))
	mux.HandleFunc("/api/auth/oauth/start", s.withAuth(s.handleOAuthStart))
	mux.HandleFunc("/api/auth/oauth/cancel", s.withAuth(s.handleOAuthCancel))
	mux.HandleFunc("/api/auth/import-rclone", s.withAuth(s.handleImportRclone))
	mux.HandleFunc("/api/auth/disconnect", s.withAuth(s.handleDisconnect))
	mux.HandleFunc("/api/account/folders", s.withAuth(s.handleAccountDiscoveredFolders))
	mux.HandleFunc("/api/account/sync-discovered", s.withAuth(s.handleSyncDiscoveredFolders))
	mux.HandleFunc("/api/drive/folders", s.withAuth(s.handleDriveFolders))
	mux.HandleFunc("/api/drive/resolve-code", s.withAuth(s.handleResolveCode))
	mux.HandleFunc("/api/folders", s.withAuth(s.handleFolders))
	mux.HandleFunc("/api/folders/", s.withAuth(s.handleFolderByID))
	mux.HandleFunc("/api/settings", s.withAuth(s.handleSettings))
	mux.HandleFunc("/api/devices/", s.withAuth(s.handleDevices))
	return mux
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if s.token != "" {
			got := r.Header.Get("X-DriveSync-Token")
			if got == "" {
				got = r.URL.Query().Get("token")
			}
			if got != s.token {
				writeErr(w, http.StatusUnauthorized, "token inválido")
				return
			}
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": config.AppVersion})
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.wsMu.Lock()
	s.wsConns[conn] = struct{}{}
	s.wsMu.Unlock()

	defer func() {
		s.wsMu.Lock()
		delete(s.wsConns, conn)
		s.wsMu.Unlock()
		_ = conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *Server) buildSnapshot() (config.DaemonSnapshot, error) {
	account, _ := s.store.GetAccount()
	settings, _ := s.store.GetSettings()
	folders, err := s.store.ListFolders()
	if err != nil {
		return config.DaemonSnapshot{}, err
	}
	if folders == nil {
		folders = []config.SyncFolderConfig{}
	}
	runtimeMap := s.syncer.GetAllRuntime()
	for _, f := range folders {
		if _, ok := runtimeMap[f.ID]; !ok {
			syncedCnt, keptCnt, _ := s.store.CountSyncedStats(f.ID)
			st := "idle"
			msg := "Aguardando primeira sincronização"
			if f.Paused {
				st = "paused"
				msg = "Sincronização pausada"
			}
			runtimeMap[f.ID] = config.FolderRuntimeState{
				FolderID:         f.ID,
				Status:           st,
				Message:          msg,
				SyncedFilesCount: syncedCnt,
				KeptLocalCount:   keptCnt,
			}
		}
	}
	devices, _ := s.store.ListDevices()
	if devices == nil {
		devices = []config.DeviceRegistration{}
	}
	for i := range devices {
		devices[i].IsCurrentDevice = devices[i].DeviceID == settings.DeviceID
	}
	senders, _ := s.store.ListKnownSenders("")
	if senders == nil {
		senders = []config.KnownSender{}
	}
	blocked, _ := s.store.ListBlockedFiles()
	if blocked == nil {
		blocked = []config.BlockedFileEntry{}
	}
	activity, _ := s.store.ListRecentActivity(150)
	if activity == nil {
		activity = []config.ActivityEvent{}
	}
	return config.DaemonSnapshot{
		Account:        account,
		Settings:       settings,
		Folders:        folders,
		Runtime:        runtimeMap,
		Devices:        devices,
		KnownSenders:   senders,
		BlockedFiles:   blocked,
		RecentActivity: activity,
	}, nil
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	snap, err := s.buildSnapshot()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleOAuthClient(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	var body db.OAuthClientConfig
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	if strings.TrimSpace(body.ClientID) == "" {
		writeErr(w, http.StatusBadRequest, "Client ID é obrigatório")
		return
	}
	if err := s.store.SaveOAuthClient(body); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	acc, _ := s.store.GetAccount()
	writeJSON(w, http.StatusOK, acc)
}

func (s *Server) handleOAuthGoogleJSON(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 256*1024))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "falha ao ler JSON")
		return
	}
	cfg, err := drive.ParseGoogleCredentialsJSON(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SaveOAuthClient(cfg); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	acc, _ := s.store.GetAccount()
	writeJSON(w, http.StatusOK, acc)
}

func (s *Server) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	flow, err := s.auth.StartPKCE(context.Background())
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, drive.ErrOAuthClientMissing) {
			code = http.StatusPreconditionRequired
		}
		writeErr(w, code, err.Error())
		return
	}

	go func() {
		res := <-flow.ResultCh
		if res.Err != nil {
			s.Broadcast("auth_result", map[string]any{"ok": false, "error": res.Err.Error()})
			return
		}
		if s.refresh != nil {
			s.refresh()
		}
		s.Broadcast("auth_result", map[string]any{"ok": true, "account": res.Account})
	}()

	writeJSON(w, http.StatusOK, map[string]string{
		"authUrl":     flow.AuthURL,
		"redirectUri": flow.RedirectURI,
	})
}

func (s *Server) handleOAuthCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	s.auth.CancelActiveAuth()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleImportRclone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	var body struct {
		RemoteName string `json:"remoteName"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	acc, err := s.auth.ImportFromRcloneConf(r.Context(), body.RemoteName)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.refresh != nil {
		s.refresh()
	}
	s.Broadcast("auth_result", map[string]any{"ok": true, "account": acc})
	writeJSON(w, http.StatusOK, acc)
}

func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	if err := s.auth.Disconnect(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.refresh != nil {
		s.refresh()
	}
	s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) currentDriveClient(ctx context.Context) (drive.API, error) {
	if s.driveFactory != nil {
		return s.driveFactory(ctx)
	}
	ts, _, err := s.auth.TokenSource(ctx)
	if err != nil {
		return nil, err
	}
	return drive.NewGoogleDriveClient(ts), nil
}

func (s *Server) handleDriveFolders(w http.ResponseWriter, r *http.Request) {
	cli, err := s.currentDriveClient(r.Context())
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	switch r.Method {
	case http.MethodGet:
		parentID := r.URL.Query().Get("parentId")
		shared := r.URL.Query().Get("shared") == "true"
		list, err := cli.ListFolders(r.Context(), parentID, shared)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		if list == nil {
			list = []config.RemoteFolderItem{}
		}
		writeJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var body struct {
			Name     string `json:"name"`
			ParentID string `json:"parentId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
			writeErr(w, http.StatusBadRequest, "nome da pasta é obrigatório")
			return
		}
		created, err := cli.CreateFolder(r.Context(), strings.TrimSpace(body.Name), body.ParentID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
	}
}

var (
	fullCodeRegex  = regexp.MustCompile(`(?i)^DS1\.([A-Za-z0-9_-]{8,})\.(DS-[A-Z0-9]{4}-[A-Z0-9]{4})$`)
	driveLinkRegex = regexp.MustCompile(`(?i)drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|open\?id=|folderview\?id=)([A-Za-z0-9_-]{8,})`)
	shortCodeRegex = regexp.MustCompile(`(?i)^(DS-[A-Z0-9]{4}-[A-Z0-9]{4})$`)
)

func generateShortCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	out := make([]byte, 8)
	for i, b := range buf {
		out[i] = alphabet[int(b)%len(alphabet)]
	}
	return fmt.Sprintf("DS-%s-%s", string(out[:4]), string(out[4:8]))
}

func (s *Server) handleResolveCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	cli, err := s.currentDriveClient(r.Context())
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	var body struct {
		CodeOrLink string `json:"codeOrLink"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	input := strings.TrimSpace(body.CodeOrLink)
	if input == "" {
		writeErr(w, http.StatusBadRequest, "cole um código ou link do Google Drive")
		return
	}

	if m := fullCodeRegex.FindStringSubmatch(input); len(m) == 3 {
		folderID, shortCode := m[1], strings.ToUpper(m[2])
		meta, err := cli.GetFolderMeta(r.Context(), folderID)
		if err != nil {
			if errors.Is(err, drive.ErrNotFound) {
				writeErr(w, http.StatusNotFound, fmt.Sprintf("Esta pasta ainda não aparece para a sua conta Google. Peça ao dono para compartilhar com o seu e-mail no Google Drive ou abra este link uma vez no navegador logado na sua conta: https://drive.google.com/drive/folders/%s", folderID))
				return
			}
			writeErr(w, http.StatusNotFound, "Não foi possível abrir essa pasta no seu Google Drive: "+err.Error())
			return
		}
		if meta.JoinCode != "" && !strings.EqualFold(meta.JoinCode, shortCode) {
			writeErr(w, http.StatusBadRequest, "O código não confere com a pasta informada.")
			return
		}
		writeJSON(w, http.StatusOK, config.ResolvedFolderCode{
			RemoteFolderID:   meta.ID,
			RemoteFolderName: meta.Name,
			ShortCode:        shortCode,
			Kind:             meta.Kind,
			OwnerEmail:       meta.OwnerEmail,
			OwnerName:        meta.OwnerName,
			CanWrite:         meta.CanWrite,
			MatchedBy:        "full_code",
		})
		return
	}

	if m := driveLinkRegex.FindStringSubmatch(input); len(m) == 2 {
		folderID := m[1]
		meta, err := cli.GetFolderMeta(r.Context(), folderID)
		if err != nil {
			if errors.Is(err, drive.ErrNotFound) {
				writeErr(w, http.StatusNotFound, fmt.Sprintf("Sua conta Google atual ainda não tem acesso a essa pasta. Peça ao dono para compartilhar diretamente com seu e-mail ou abra o link uma vez logado nesta conta: https://drive.google.com/drive/folders/%s", folderID))
				return
			}
			writeErr(w, http.StatusNotFound, "Não foi possível acessar o link dessa pasta no Drive: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, config.ResolvedFolderCode{
			RemoteFolderID:   meta.ID,
			RemoteFolderName: meta.Name,
			ShortCode:        meta.JoinCode,
			Kind:             meta.Kind,
			OwnerEmail:       meta.OwnerEmail,
			OwnerName:        meta.OwnerName,
			CanWrite:         meta.CanWrite,
			MatchedBy:        "drive_link",
		})
		return
	}

	if m := shortCodeRegex.FindStringSubmatch(input); len(m) == 2 {
		shortCode := strings.ToUpper(m[1])
		meta, found, err := cli.FindFolderByJoinCode(r.Context(), shortCode)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		if !found {
			writeErr(w, http.StatusNotFound, "Pasta não encontrada apenas pelo código curto. Peça ao dono o Código Completo (DS1...) ou compartilhe a pasta com o seu e-mail no Drive.")
			return
		}
		writeJSON(w, http.StatusOK, config.ResolvedFolderCode{
			RemoteFolderID:   meta.ID,
			RemoteFolderName: meta.Name,
			ShortCode:        shortCode,
			Kind:             meta.Kind,
			OwnerEmail:       meta.OwnerEmail,
			OwnerName:        meta.OwnerName,
			CanWrite:         meta.CanWrite,
			MatchedBy:        "short_code",
		})
		return
	}

	writeErr(w, http.StatusBadRequest, "Formato inválido. Cole um código (ex.: DS-4829-KP7M ou DS1...) ou o link da pasta do Google Drive.")
}

func (s *Server) handleFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		folders, err := s.store.ListFolders()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, folders)

	case http.MethodPost:
		var in config.CreateFolderInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.LocalPath) == "" || strings.TrimSpace(in.RemoteFolderID) == "" {
			writeErr(w, http.StatusBadRequest, "preencha nome, pasta no PC e pasta no Drive")
			return
		}
		if err := os.MkdirAll(in.LocalPath, 0o755); err != nil {
			writeErr(w, http.StatusBadRequest, "não foi possível acessar/criar a pasta local: "+err.Error())
			return
		}
		if in.SenderPolicy.Mode == "" {
			in.SenderPolicy.Mode = config.SenderModeAll
		}
		if in.SenderPolicy.UnknownSenderAction == "" {
			if in.Kind == config.FolderKindMaster {
				in.SenderPolicy.UnknownSenderAction = "allow"
			} else {
				in.SenderPolicy.UnknownSenderAction = "allow"
			}
		}
		if in.OnRemoteDelete == "" {
			in.OnRemoteDelete = config.RemoteDeleteKeepLocal
		}
		if in.OnLocalDelete == "" {
			in.OnLocalDelete = config.LocalDeleteIgnore
		}

		cfg := config.SyncFolderConfig{
			ID:               config.NewID(),
			Name:             strings.TrimSpace(in.Name),
			LocalPath:        in.LocalPath,
			RemoteFolderID:   in.RemoteFolderID,
			RemoteFolderName: in.RemoteFolderName,
			Kind:             in.Kind,
			Direction:        in.Direction,
			OnRemoteDelete:   in.OnRemoteDelete,
			OnLocalDelete:    in.OnLocalDelete,
			SenderPolicy:     in.SenderPolicy,
			Paused:           false,
		}
		if err := s.store.UpsertFolder(cfg); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.reloadWatcher()
		go func(f config.SyncFolderConfig) {
			if cli, cliErr := s.currentDriveClient(context.Background()); cliErr == nil {
				_ = cli.EnsureFolderKindMetadata(context.Background(), f.RemoteFolderID, f.Kind, f.Name)
			}
			_ = s.syncer.SyncFolder(context.Background(), f.ID)
			s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}(cfg)
		writeJSON(w, http.StatusCreated, cfg)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
	}
}

func (s *Server) handleFolderByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/folders/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeErr(w, http.StatusNotFound, "pasta não encontrada")
		return
	}
	folderID := parts[0]

	if len(parts) == 2 && parts[1] == "sync" && r.Method == http.MethodPost {
		go func() {
			_ = s.syncer.SyncFolder(context.Background(), folderID)
			s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}()
		writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
		return
	}

	if len(parts) == 2 && parts[1] == "resend" && r.Method == http.MethodPost {
		var body struct {
			RelativePath string `json:"relativePath"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RelativePath == "" {
			writeErr(w, http.StatusBadRequest, "relativePath é obrigatório")
			return
		}
		go func() {
			_ = s.syncer.ResendKeptFile(context.Background(), folderID, body.RelativePath)
			s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}()
		writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
		return
	}

	if len(parts) == 2 && parts[1] == "invite" && r.Method == http.MethodPost {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		cli, err := s.currentDriveClient(r.Context())
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		code := strings.TrimSpace(folder.ShareCode)
		if code == "" {
			code = generateShortCode()
			folder.ShareCode = code
			if err := s.store.UpsertFolder(folder); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if err := cli.SetFolderInviteMetadata(r.Context(), folder.RemoteFolderID, code, folder.Kind, folder.Name); err != nil {
			writeErr(w, http.StatusBadGateway, "não foi possível gravar o código na pasta do Drive: "+err.Error())
			return
		}
		invite := config.FolderInviteInfo{
			FolderID:   folder.ID,
			FolderName: folder.Name,
			ShortCode:  code,
			FullCode:   fmt.Sprintf("DS1.%s.%s", folder.RemoteFolderID, code),
			DriveURL:   fmt.Sprintf("https://drive.google.com/drive/folders/%s", folder.RemoteFolderID),
			Kind:       folder.Kind,
		}
		s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		writeJSON(w, http.StatusOK, invite)
		return
	}

	if len(parts) == 2 && parts[1] == "share" && r.Method == http.MethodPost {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		cli, err := s.currentDriveClient(r.Context())
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		var in config.SharePermissionInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		if err := cli.ShareFolder(r.Context(), folder.RemoteFolderID, in); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"shared": true})
		return
	}

	if len(parts) == 2 && parts[1] == "files" && r.Method == http.MethodGet {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		subpath := strings.TrimSpace(r.URL.Query().Get("subpath"))
		targetDir, cleanSub, err := resolveSubpathInside(folder.LocalPath, subpath)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		entries, err := os.ReadDir(targetDir)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "não foi possível ler a pasta local: "+err.Error())
			return
		}
		settings, _ := s.store.GetSettings()
		maxBytes := settings.MaxUploadBytes
		if maxBytes <= 0 || maxBytes > config.MaxUploadBytes {
			maxBytes = config.MaxUploadBytes
		}

		items := make([]config.FolderContentItem, 0, len(entries))
		for _, ent := range entries {
			name := ent.Name()
			if name == config.ControlDirName || name == config.QuarantineDirName || strings.HasSuffix(name, ".drivesync.part") {
				continue
			}
			rel := name
			if cleanSub != "" {
				rel = cleanSub + "/" + name
			}
			info, infoErr := ent.Info()
			if infoErr != nil {
				continue
			}
			isDir := ent.IsDir()
			sz := int64(0)
			if !isDir {
				sz = info.Size()
			}
			items = append(items, config.FolderContentItem{
				Name:         name,
				RelativePath: rel,
				IsDir:        isDir,
				SizeBytes:    sz,
				ModifiedAt:   info.ModTime().Format(time.RFC3339),
				Exceeds4GB:   !isDir && sz > maxBytes,
			})
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].IsDir != items[j].IsDir {
				return items[i].IsDir
			}
			return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		})
		writeJSON(w, http.StatusOK, config.FolderContentsResponse{
			FolderID:   folder.ID,
			FolderName: folder.Name,
			LocalPath:  folder.LocalPath,
			Subpath:    cleanSub,
			Items:      items,
		})
		return
	}

	if len(parts) == 2 && parts[1] == "mkdir" && r.Method == http.MethodPost {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		var body struct {
			Subpath string `json:"subpath"`
			Name    string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
			writeErr(w, http.StatusBadRequest, "nome de subpasta inválido")
			return
		}
		parentDir, _, err := resolveSubpathInside(folder.LocalPath, body.Subpath)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := os.MkdirAll(filepath.Join(parentDir, name), 0o755); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]bool{"created": true})
		return
	}

	if len(parts) == 2 && parts[1] == "import-paths" && r.Method == http.MethodPost {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		var body struct {
			Subpath string   `json:"subpath"`
			Paths   []string `json:"paths"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		destDir, _, err := resolveSubpathInside(folder.LocalPath, body.Subpath)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		settings, _ := s.store.GetSettings()
		maxBytes := settings.MaxUploadBytes
		if maxBytes <= 0 || maxBytes > config.MaxUploadBytes {
			maxBytes = config.MaxUploadBytes
		}

		res := config.ImportPathsResult{
			SkippedOver4GB: []string{},
			Errors:         []string{},
		}
		for _, srcPath := range body.Paths {
			srcClean := filepath.Clean(strings.TrimSpace(srcPath))
			if srcClean == "" || srcClean == "." {
				continue
			}
			info, statErr := os.Stat(srcClean)
			if statErr != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", filepath.Base(srcClean), statErr))
				continue
			}
			if !info.IsDir() {
				if info.Size() > maxBytes {
					res.SkippedOver4GB = append(res.SkippedOver4GB, filepath.Base(srcClean))
					continue
				}
				dst := filepath.Join(destDir, filepath.Base(srcClean))
				if err := copyFileAtomic(srcClean, dst); err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", filepath.Base(srcClean), err))
					continue
				}
				res.AddedCount++
				continue
			}

			// Copia pasta recursivamente garantindo que o destino não esteja dentro da própria origem
			absSrc, _ := filepath.Abs(srcClean)
			absDstRoot, _ := filepath.Abs(filepath.Join(destDir, filepath.Base(srcClean)))
			if isSameOrSubpath(absSrc, absDstRoot) {
				res.Errors = append(res.Errors, fmt.Sprintf("%s: não é possível copiar uma pasta para dentro dela mesma", filepath.Base(srcClean)))
				continue
			}
			_ = filepath.WalkDir(srcClean, func(p string, d fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return nil
				}
				rel, relErr := filepath.Rel(srcClean, p)
				if relErr != nil {
					return nil
				}
				target := filepath.Join(absDstRoot, rel)
				if d.IsDir() {
					if rel != "." && config.ShouldIgnore(filepath.ToSlash(rel)) {
						return filepath.SkipDir
					}
					return os.MkdirAll(target, 0o755)
				}
				if d.Type()&os.ModeSymlink != 0 || config.ShouldIgnore(filepath.ToSlash(rel)) {
					return nil
				}
				fInfo, fErr := d.Info()
				if fErr != nil || !fInfo.Mode().IsRegular() {
					return nil
				}
				if fInfo.Size() > maxBytes {
					res.SkippedOver4GB = append(res.SkippedOver4GB, filepath.ToSlash(filepath.Join(filepath.Base(srcClean), rel)))
					return nil
				}
				if err := copyFileAtomic(p, target); err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", d.Name(), err))
					return nil
				}
				res.AddedCount++
				return nil
			})
		}

		if res.AddedCount > 0 && !folder.Paused {
			go func() {
				_ = s.syncer.SyncFolder(context.Background(), folderID)
				s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
			}()
		}
		writeJSON(w, http.StatusOK, res)
		return
	}

	switch r.Method {
	case http.MethodPut:
		existing, err := s.store.GetFolder(folderID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "pasta não encontrada")
			return
		}
		var updated config.SyncFolderConfig
		if err := json.NewDecoder(r.Body).Decode(&updated); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		updated.ID = existing.ID
		updated.CreatedAt = existing.CreatedAt
		if updated.ShareCode == "" {
			updated.ShareCode = existing.ShareCode
		}
		if err := s.store.UpsertFolder(updated); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.reloadWatcher()
		if !updated.Paused {
			go func() {
				_ = s.syncer.SyncFolder(context.Background(), folderID)
				s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
			}()
		} else {
			s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}
		writeJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if err := s.store.DeleteFolder(folderID); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.reloadWatcher()
		s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
	}
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		st, err := s.store.GetSettings()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, st)

	case http.MethodPut:
		var in config.AppSettings
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		curr, _ := s.store.GetSettings()
		if in.DeviceID == "" {
			in.DeviceID = curr.DeviceID
		}
		if strings.TrimSpace(in.DeviceName) == "" {
			in.DeviceName = curr.DeviceName
		}
		if err := s.store.SaveSettings(in); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		saved, _ := s.store.GetSettings()
		s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		writeJSON(w, http.StatusOK, saved)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
	}
}

func (s *Server) handleAccountDiscoveredFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	cli, err := s.currentDriveClient(r.Context())
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	all, err := cli.DiscoverDriveSyncFolders(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, "erro ao buscar pastas da conta no Drive: "+err.Error())
		return
	}
	localFolders, _ := s.store.ListFolders()
	connectedRemote := make(map[string]struct{}, len(localFolders))
	for _, lf := range localFolders {
		connectedRemote[lf.RemoteFolderID] = struct{}{}
	}
	settings, _ := s.store.GetSettings()
	filtered := make([]config.DiscoveredRemoteFolder, 0)
	for _, item := range all {
		for _, dev := range item.Devices {
			devCopy := dev
			devCopy.FolderID = item.RemoteFolderID
			devCopy.IsCurrentDevice = dev.DeviceID == settings.DeviceID
			_ = s.store.UpsertDevice(devCopy)
		}
		if _, exists := connectedRemote[item.RemoteFolderID]; !exists {
			filtered = append(filtered, item)
		}
	}
	s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
	writeJSON(w, http.StatusOK, filtered)
}

func (s *Server) handleSyncDiscoveredFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	var body struct {
		BasePath string                          `json:"basePath"`
		Folders  []config.DiscoveredRemoteFolder `json:"folders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	settings, _ := s.store.GetSettings()
	basePath := strings.TrimSpace(body.BasePath)
	if basePath == "" {
		basePath = strings.TrimSpace(settings.SyncRootPath)
	}
	if basePath == "" {
		writeErr(w, http.StatusBadRequest, "escolha a pasta base onde os arquivos serão salvos neste PC")
		return
	}
	if body.BasePath != "" && body.BasePath != settings.SyncRootPath {
		settings.SyncRootPath = basePath
		_ = s.store.SaveSettings(settings)
	}

	existingFolders, _ := s.store.ListFolders()
	connectedRemote := make(map[string]struct{}, len(existingFolders))
	for _, f := range existingFolders {
		connectedRemote[f.RemoteFolderID] = struct{}{}
	}

	createdList := make([]config.SyncFolderConfig, 0, len(body.Folders))
	for _, item := range body.Folders {
		if item.RemoteFolderID == "" {
			continue
		}
		if _, exists := connectedRemote[item.RemoteFolderID]; exists {
			continue
		}
		cleanName := strings.NewReplacer("/", "-", "\\", "-", "..", "").Replace(strings.TrimSpace(item.RemoteFolderName))
		if cleanName == "" {
			cleanName = "DriveSync-" + item.RemoteFolderID[:min(6, len(item.RemoteFolderID))]
		}
		targetLocal := filepath.Join(basePath, cleanName)
		if err := os.MkdirAll(targetLocal, 0o755); err != nil {
			writeErr(w, http.StatusBadRequest, "não foi possível criar pasta local: "+err.Error())
			return
		}
		kind := item.Kind
		if kind == "" {
			kind = config.FolderKindMaster
		}
		dir := item.Direction
		if dir == "" {
			dir = config.DirectionBidirectional
		}
		onRem := item.OnRemoteDelete
		if onRem == "" {
			onRem = settings.DefaultOnRemoteDelete
		}
		onLoc := item.OnLocalDelete
		if onLoc == "" {
			onLoc = config.LocalDeleteIgnore
		}
		policy := config.SenderPolicy{
			Mode:                config.SenderModeAll,
			UnknownSenderAction: "allow",
			Rules:               []config.SenderRule{},
		}
		if item.SenderPolicy != nil {
			policy = *item.SenderPolicy
		} else if kind == config.FolderKindMaster {
			policy.Mode = config.SenderModeBlocklist
		}
		cfg := config.SyncFolderConfig{
			ID:               config.NewID(),
			Name:             cleanName,
			LocalPath:        targetLocal,
			RemoteFolderID:   item.RemoteFolderID,
			RemoteFolderName: item.RemoteFolderName,
			Kind:             kind,
			Direction:        dir,
			OnRemoteDelete:   onRem,
			OnLocalDelete:    onLoc,
			SenderPolicy:     policy,
			ShareCode:        item.ShortCode,
		}
		if err := s.store.UpsertFolder(cfg); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		createdList = append(createdList, cfg)
		connectedRemote[item.RemoteFolderID] = struct{}{}
	}
	s.reloadWatcher()
	for _, cfg := range createdList {
		go func(id string) {
			_ = s.syncer.SyncFolder(context.Background(), id)
			s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}(cfg.ID)
	}
	s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
	writeJSON(w, http.StatusCreated, createdList)
}

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeErr(w, http.StatusMethodNotAllowed, "método não permitido")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/devices/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) != 2 {
		writeErr(w, http.StatusBadRequest, "use /api/devices/{folderId}/{deviceId}")
		return
	}
	if err := s.store.DeleteDevice(parts[0], parts[1]); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) reloadWatcher() {
	if s.watcher == nil {
		return
	}
	folders, err := s.store.ListFolders()
	if err != nil {
		return
	}
	_ = s.watcher.SetFolders(folders)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func resolveSubpathInside(rootDir string, subpath string) (string, string, error) {
	rootAbs, err := filepath.Abs(rootDir)
	if err != nil {
		return "", "", err
	}
	cleanSlash := strings.Trim(filepath.ToSlash(filepath.Clean("/"+subpath)), "/")
	if cleanSlash == "." {
		cleanSlash = ""
	}
	target := rootAbs
	if cleanSlash != "" {
		target = filepath.Join(rootAbs, filepath.FromSlash(cleanSlash))
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return "", "", err
	}
	if !isSameOrSubpath(rootAbs, targetAbs) {
		return "", "", errors.New("caminho fora da pasta selecionada não é permitido")
	}
	return targetAbs, cleanSlash, nil
}

func isSameOrSubpath(baseAbs, candidateAbs string) bool {
	rel, err := filepath.Rel(baseAbs, candidateAbs)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func copyFileAtomic(src, dst string) error {
	srcAbs, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	dstAbs, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	if srcAbs == dstAbs {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dstAbs), 0o755); err != nil {
		return err
	}
	in, err := os.Open(srcAbs)
	if err != nil {
		return err
	}
	defer in.Close()

	part := dstAbs + ".drivesync.part"
	out, err := os.OpenFile(part, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		_ = out.Close()
		if cleanup {
			_ = os.Remove(part)
		}
	}()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	if err := os.Rename(part, dstAbs); err != nil {
		return err
	}
	cleanup = false
	return nil
}

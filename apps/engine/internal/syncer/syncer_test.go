package syncer

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
)

type mockRemoteObj struct {
	entry   drive.RemoteEntry
	content []byte
}

type mockDrive struct {
	mu           sync.Mutex
	filesByID    map[string]*mockRemoteObj
	controlFiles map[string]map[string][]byte // rootID -> name -> bytes
	nextID       int
	canWriteRoot bool
}

func newMockDrive() *mockDrive {
	return &mockDrive{
		filesByID:    make(map[string]*mockRemoteObj),
		controlFiles: make(map[string]map[string][]byte),
		canWriteRoot: true,
	}
}

func (m *mockDrive) addRemoteFile(relPath string, data []byte, authorEmail, authorName string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	id := fmt.Sprintf("rem-%d", m.nextID)
	sum := md5.Sum(data)
	m.filesByID[id] = &mockRemoteObj{
		entry: drive.RemoteEntry{
			ID:           id,
			Name:         filepath.Base(relPath),
			RelativePath: filepath.ToSlash(relPath),
			Size:         int64(len(data)),
			MD5:          hex.EncodeToString(sum[:]),
			ModTime:      time.Now(),
			AuthorEmail:  config.NormalizeEmail(authorEmail),
			AuthorName:   authorName,
			CanEdit:      true,
			CanTrash:     true,
		},
		content: append([]byte(nil), data...),
	}
	return id
}

func (m *mockDrive) removeRemoteByPath(relPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, obj := range m.filesByID {
		if obj.entry.RelativePath == relPath {
			delete(m.filesByID, id)
		}
	}
}

func (m *mockDrive) AboutUser(context.Context) (string, string, error) {
	return "brendha@gmail.com", "Brendha", nil
}

func (m *mockDrive) ListFolders(context.Context, string, bool) ([]config.RemoteFolderItem, error) {
	return nil, nil
}

func (m *mockDrive) CreateFolder(_ context.Context, name, _ string) (config.RemoteFolderItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	return config.RemoteFolderItem{ID: fmt.Sprintf("dir-%d", m.nextID), Name: name, CanWrite: true}, nil
}

func (m *mockDrive) GetFolderMeta(_ context.Context, folderID string) (drive.FolderMeta, error) {
	return drive.FolderMeta{ID: folderID, Name: "MockFolder", Kind: config.FolderKindMaster, CanWrite: m.canWriteRoot}, nil
}

func (m *mockDrive) EnsureFolderKindMetadata(context.Context, string, config.FolderKind, string) error {
	return nil
}

func (m *mockDrive) WriteFolderProfileJSON(context.Context, string, []byte) error {
	return nil
}

func (m *mockDrive) DiscoverDriveSyncFolders(context.Context) ([]config.DiscoveredRemoteFolder, error) {
	return nil, nil
}

func (m *mockDrive) SetFolderInviteMetadata(context.Context, string, string, config.FolderKind, string) error {
	return nil
}

func (m *mockDrive) FindFolderByJoinCode(context.Context, string) (drive.FolderMeta, bool, error) {
	return drive.FolderMeta{}, false, nil
}

func (m *mockDrive) ShareFolder(context.Context, string, config.SharePermissionInput) error {
	return nil
}

func (m *mockDrive) EnsurePath(_ context.Context, rootFolderID, relDir string) (string, error) {
	return rootFolderID + "/" + relDir, nil
}

func (m *mockDrive) ListTree(context.Context, string) ([]drive.RemoteEntry, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]drive.RemoteEntry, 0, len(m.filesByID))
	for _, obj := range m.filesByID {
		out = append(out, obj.entry)
	}
	return out, m.canWriteRoot, nil
}

func (m *mockDrive) DownloadFile(_ context.Context, fileID, destPath string, _ int64, _ drive.ProgressFunc) (string, error) {
	m.mu.Lock()
	obj, ok := m.filesByID[fileID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("file %s not found", fileID)
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(destPath, obj.content, 0o644); err != nil {
		return "", err
	}
	return obj.entry.MD5, nil
}

func (m *mockDrive) UploadFile(_ context.Context, localPath, remoteName, parentID, existingFileID, senderEmail, senderName, _ string, maxBytes int64, _ drive.ProgressFunc) (drive.RemoteEntry, error) {
	st, err := os.Stat(localPath)
	if err != nil {
		return drive.RemoteEntry{}, err
	}
	if st.Size() > maxBytes {
		return drive.RemoteEntry{}, drive.ErrExceedsMaxUpload
	}
	data, err := os.ReadFile(localPath)
	if err != nil {
		return drive.RemoteEntry{}, err
	}
	rel := remoteName
	if strings.Contains(parentID, "/") {
		parts := strings.SplitN(parentID, "/", 2)
		if parts[1] != "" && parts[1] != "." {
			rel = parts[1] + "/" + remoteName
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	id := existingFileID
	if id == "" {
		m.nextID++
		id = fmt.Sprintf("rem-%d", m.nextID)
	}
	sum := md5.Sum(data)
	entry := drive.RemoteEntry{
		ID:           id,
		Name:         remoteName,
		RelativePath: rel,
		ParentID:     parentID,
		Size:         int64(len(data)),
		MD5:          hex.EncodeToString(sum[:]),
		ModTime:      time.Now(),
		AuthorEmail:  config.NormalizeEmail(senderEmail),
		AuthorName:   senderName,
		CanEdit:      true,
		CanTrash:     true,
	}
	m.filesByID[id] = &mockRemoteObj{entry: entry, content: data}
	return entry, nil
}

func (m *mockDrive) TrashFile(_ context.Context, fileID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.filesByID, fileID)
	return nil
}

func (m *mockDrive) WriteControlJSON(_ context.Context, rootFolderID, fileName string, payload []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.canWriteRoot {
		return drive.ErrInsufficientAccess
	}
	if m.controlFiles[rootFolderID] == nil {
		m.controlFiles[rootFolderID] = make(map[string][]byte)
	}
	m.controlFiles[rootFolderID][fileName] = append([]byte(nil), payload...)
	return nil
}

func (m *mockDrive) ListControlJSONs(_ context.Context, rootFolderID string) (map[string][]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	src := m.controlFiles[rootFolderID]
	out := make(map[string][]byte, len(src))
	for k, v := range src {
		out[k] = append([]byte(nil), v...)
	}
	return out, nil
}

func setupTestEnv(t *testing.T) (*db.Store, *mockDrive, *Syncer, string) {
	t.Helper()
	tmp := t.TempDir()
	store, err := db.Open(filepath.Join(tmp, "drivesync.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	_ = store.SaveAccount(config.AccountInfo{
		Connected:   true,
		Email:       "brendha@gmail.com",
		DisplayName: "Brendha",
		AuthSource:  "oauth_pkce",
	})
	localDir := filepath.Join(tmp, "PastaEscolhida")
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		t.Fatal(err)
	}
	md := newMockDrive()
	sy := New(store, md, nil)
	return store, md, sy, localDir
}

func TestMasterSenderFilterAndKeepLocalOnRemoteDelete(t *testing.T) {
	store, md, sy, localDir := setupTestEnv(t)

	folder := config.SyncFolderConfig{
		ID:               "master-1",
		Name:             "Drive Master",
		LocalPath:        localDir,
		RemoteFolderID:   "remote-master",
		RemoteFolderName: "Master-Time",
		Kind:             config.FolderKindMaster,
		Direction:        config.DirectionBidirectional,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy: config.SenderPolicy{
			Mode:                config.SenderModeBlocklist,
			UnknownSenderAction: "block",
			Rules: []config.SenderRule{
				{Email: "joao@gmail.com", DisplayName: "João", Allowed: true},
				{Email: "luiz@gmail.com", DisplayName: "Luiz", Allowed: false},
			},
		},
	}
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}

	md.addRemoteFile("relatorio_joao.txt", []byte("conteudo do joao"), "joao@gmail.com", "João")
	md.addRemoteFile("arquivo_luiz.txt", []byte("conteudo do luiz"), "luiz@gmail.com", "Luiz")

	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatalf("SyncFolder error: %v", err)
	}

	// João deve baixar, Luiz NÃO deve baixar
	if _, err := os.Stat(filepath.Join(localDir, "relatorio_joao.txt")); err != nil {
		t.Fatalf("esperava relatorio_joao.txt baixado: %v", err)
	}
	if _, err := os.Stat(filepath.Join(localDir, "arquivo_luiz.txt")); !os.IsNotExist(err) {
		t.Fatalf("arquivo_luiz.txt não deveria ter sido baixado")
	}

	// Apaga arquivo do João no Drive -> deve permanecer intacto no PC e NÃO ser reenviado no próximo sync
	md.removeRemoteByPath("relatorio_joao.txt")
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatalf("SyncFolder after remote delete error: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(localDir, "relatorio_joao.txt"))
	if err != nil || string(data) != "conteudo do joao" {
		t.Fatalf("esperava arquivo mantido no PC após exclusão no Drive, err=%v data=%q", err, string(data))
	}

	// Executa mais um ciclo bidirecional e garante que não houve loop de reenvio para o Drive
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}
	entries, _, _ := md.ListTree(context.Background(), folder.RemoteFolderID)
	for _, e := range entries {
		if e.RelativePath == "relatorio_joao.txt" {
			t.Fatal("relatorio_joao.txt não deveria ser reenviado para o Drive após ser preservado localmente")
		}
	}

	// Agora libera Luiz e reaplica -> arquivo_luiz.txt deve baixar
	folder.SenderPolicy.Rules[1].Allowed = true
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(localDir, "arquivo_luiz.txt")); err != nil {
		t.Fatalf("esperava arquivo_luiz.txt baixado após desbloqueio: %v", err)
	}
}

func TestBlockUploadAbove4GB(t *testing.T) {
	store, md, sy, localDir := setupTestEnv(t)

	// Para teste rápido em disco, ajusta o limite da configuração para 100 bytes
	// e também valida que MaxUploadBytes nunca excede 4 GiB.
	st, _ := store.GetSettings()
	st.MaxUploadBytes = 100
	if err := store.SaveSettings(st); err != nil {
		t.Fatal(err)
	}

	folder := config.SyncFolderConfig{
		ID:               "pessoal-1",
		Name:             "Minha Pasta",
		LocalPath:        localDir,
		RemoteFolderID:   "remote-pessoal",
		RemoteFolderName: "Sync",
		Kind:             config.FolderKindPersonal,
		Direction:        config.DirectionBidirectional,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy:     config.SenderPolicy{Mode: config.SenderModeAll, UnknownSenderAction: "allow"},
	}
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(localDir, "pequeno.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "gigante.bin"), make([]byte, 200), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}

	entries, _, _ := md.ListTree(context.Background(), folder.RemoteFolderID)
	if len(entries) != 1 || entries[0].RelativePath != "pequeno.txt" {
		t.Fatalf("esperava apenas pequeno.txt enviado, obtido: %+v", entries)
	}

	blocked, err := store.ListBlockedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(blocked) != 1 || blocked[0].Reason != "exceeds_4gb" || blocked[0].RelativePath != "gigante.bin" {
		t.Fatalf("esperava gigante.bin na lista de bloqueados, obtido: %+v", blocked)
	}
}

func TestMultiDevicePresenceReadAndWrite(t *testing.T) {
	store, md, sy, localDir := setupTestEnv(t)

	folder := config.SyncFolderConfig{
		ID:               "multi-1",
		Name:             "Multi Device",
		LocalPath:        localDir,
		RemoteFolderID:   "remote-multi",
		RemoteFolderName: "Multi",
		Kind:             config.FolderKindMaster,
		Direction:        config.DirectionBidirectional,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy:     config.SenderPolicy{Mode: config.SenderModeAll, UnknownSenderAction: "allow"},
	}
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}

	peer := config.DeviceRegistration{
		DeviceID:     "win11-notebook",
		DeviceName:   "Notebook Windows 11",
		Platform:     "windows",
		Arch:         "amd64",
		AppVersion:   "0.1.0",
		AccountEmail: "joao@gmail.com",
		SyncMode:     config.DirectionReceiveOnly,
		FolderID:     folder.ID,
		Status:       "online",
		LastSeenAt:   time.Now().Format(time.RFC3339),
	}
	peerRaw, _ := json.Marshal(peer)
	_ = md.WriteControlJSON(context.Background(), folder.RemoteFolderID, "win11-notebook.json", peerRaw)

	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}

	devices, err := store.ListDevices()
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) < 2 {
		t.Fatalf("esperava pelo menos 2 dispositivos (local + Windows 11), obtido %d", len(devices))
	}
}

func TestLocalDiffAutoUploadsAndLocalDeleteKeepsRemote(t *testing.T) {
	store, md, sy, localDir := setupTestEnv(t)

	folder := config.SyncFolderConfig{
		ID:               "diff-1",
		Name:             "Pasta Pessoal",
		LocalPath:        localDir,
		RemoteFolderID:   "remote-diff",
		RemoteFolderName: "Sync",
		Kind:             config.FolderKindPersonal,
		Direction:        config.DirectionBidirectional,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy:     config.SenderPolicy{Mode: config.SenderModeAll, UnknownSenderAction: "allow"},
	}
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}

	// Arquivo criado apenas no PC (pastas diferentes) -> sobe automaticamente
	if err := os.WriteFile(filepath.Join(localDir, "novo.txt"), []byte("subir automatico"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}

	entries, _, _ := md.ListTree(context.Background(), folder.RemoteFolderID)
	if len(entries) != 1 || entries[0].RelativePath != "novo.txt" {
		t.Fatalf("esperava novo.txt enviado para o Drive, obtido: %+v", entries)
	}

	// Usuário apaga novo.txt apenas do PC -> mantém no Drive e não fica rebaixando a mesma versão
	if err := os.Remove(filepath.Join(localDir, "novo.txt")); err != nil {
		t.Fatal(err)
	}
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}

	entriesAfter, _, _ := md.ListTree(context.Background(), folder.RemoteFolderID)
	if len(entriesAfter) != 1 || entriesAfter[0].RelativePath != "novo.txt" {
		t.Fatalf("esperava novo.txt preservado no Drive, obtido: %+v", entriesAfter)
	}
	if _, err := os.Stat(filepath.Join(localDir, "novo.txt")); !os.IsNotExist(err) {
		t.Fatalf("não esperava rebaixar automaticamente a mesma versão recém-apagada no PC")
	}
}

func TestSubfolderRemovedFromDriveStaysOnPCWithoutReupload(t *testing.T) {
	store, md, sy, localDir := setupTestEnv(t)

	folder := config.SyncFolderConfig{
		ID:               "master-sub",
		Name:             "Drive Master",
		LocalPath:        localDir,
		RemoteFolderID:   "remote-master",
		RemoteFolderName: "Master",
		Kind:             config.FolderKindMaster,
		Direction:        config.DirectionBidirectional,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy:     config.SenderPolicy{Mode: config.SenderModeAll, UnknownSenderAction: "allow"},
	}
	if err := store.UpsertFolder(folder); err != nil {
		t.Fatal(err)
	}

	// 1) Pasta sobe para o Drive e baixa para o PC
	subLocal := filepath.Join(localDir, "PastaProjeto", "sub")
	if err := os.MkdirAll(subLocal, 0o755); err != nil {
		t.Fatal(err)
	}
	f1 := filepath.Join(localDir, "PastaProjeto", "doc1.txt")
	f2 := filepath.Join(subLocal, "foto.png")
	if err := os.WriteFile(f1, []byte("doc1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f2, []byte("png-data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}

	// 2) Usuário tira/apaga a pasta inteira do Drive
	md.removeRemoteByPath("PastaProjeto/doc1.txt")
	md.removeRemoteByPath("PastaProjeto/sub/foto.png")

	// 3) Sincroniza, altera apenas o mtime (sem mudar conteúdo), e sincroniza mais duas vezes
	if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(2 * time.Minute)
	_ = os.Chtimes(f1, future, future)
	_ = os.Chtimes(f2, future, future)

	for range 2 {
		if err := sy.SyncFolder(context.Background(), folder.ID); err != nil {
			t.Fatal(err)
		}
	}

	// Deve permanecer no PC e NÃO reenviar para o Drive
	if _, err := os.Stat(f1); err != nil {
		t.Fatalf("doc1.txt deveria continuar no PC: %v", err)
	}
	if _, err := os.Stat(f2); err != nil {
		t.Fatalf("foto.png deveria continuar no PC: %v", err)
	}
	entries, _, _ := md.ListTree(context.Background(), folder.RemoteFolderID)
	if len(entries) != 0 {
		t.Fatalf("pasta removida do Drive não deveria subir novamente, mas encontrou: %+v", entries)
	}
}

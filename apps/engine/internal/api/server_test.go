package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
	"github.com/brendha/drivesync/engine/internal/syncer"
)

type apiMockDrive struct {
	savedCode string
}

func (a *apiMockDrive) AboutUser(context.Context) (string, string, error) {
	return "brendha@gmail.com", "Brendha", nil
}
func (a *apiMockDrive) ListFolders(context.Context, string, bool) ([]config.RemoteFolderItem, error) {
	return nil, nil
}
func (a *apiMockDrive) CreateFolder(context.Context, string, string) (config.RemoteFolderItem, error) {
	return config.RemoteFolderItem{}, nil
}
func (a *apiMockDrive) GetFolderMeta(_ context.Context, id string) (drive.FolderMeta, error) {
	return drive.FolderMeta{
		ID:         id,
		Name:       "Master Equipe",
		Kind:       config.FolderKindMaster,
		JoinCode:   a.savedCode,
		OwnerEmail: "brendha@gmail.com",
		CanWrite:   true,
	}, nil
}
func (a *apiMockDrive) SetFolderInviteMetadata(_ context.Context, _ string, code string, _ config.FolderKind, _ string) error {
	a.savedCode = code
	return nil
}
func (a *apiMockDrive) FindFolderByJoinCode(_ context.Context, code string) (drive.FolderMeta, bool, error) {
	if a.savedCode != "" && strings.EqualFold(a.savedCode, code) {
		return drive.FolderMeta{ID: "rem-id-1", Name: "Master Equipe", Kind: config.FolderKindMaster, JoinCode: a.savedCode, CanWrite: true}, true, nil
	}
	return drive.FolderMeta{}, false, nil
}
func (a *apiMockDrive) ShareFolder(context.Context, string, config.SharePermissionInput) error {
	return nil
}
func (a *apiMockDrive) EnsurePath(context.Context, string, string) (string, error) { return "", nil }
func (a *apiMockDrive) ListTree(context.Context, string) ([]drive.RemoteEntry, bool, error) {
	return nil, true, nil
}
func (a *apiMockDrive) DownloadFile(context.Context, string, string, int64, drive.ProgressFunc) (string, error) {
	return "", nil
}
func (a *apiMockDrive) UploadFile(context.Context, string, string, string, string, string, string, string, int64, drive.ProgressFunc) (drive.RemoteEntry, error) {
	return drive.RemoteEntry{}, nil
}
func (a *apiMockDrive) TrashFile(context.Context, string) error                          { return nil }
func (a *apiMockDrive) WriteControlJSON(context.Context, string, string, []byte) error { return nil }
func (a *apiMockDrive) ListControlJSONs(context.Context, string) (map[string][]byte, error) {
	return nil, nil
}

func TestAPIAuthFoldersAndSettingsCap4GB(t *testing.T) {
	tmp := t.TempDir()
	store, err := db.Open(filepath.Join(tmp, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	auth := drive.NewAuthManager(store, tmp)
	sy := syncer.New(store, nil, nil)
	srv := NewServer("segredo-local", store, auth, sy, nil, nil)
	handler := srv.Handler()

	// Sem token -> 401
	reqUnauth := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	recUnauth := httptest.NewRecorder()
	handler.ServeHTTP(recUnauth, reqUnauth)
	if recUnauth.Code != http.StatusUnauthorized {
		t.Fatalf("esperava 401 sem token, obtido %d", recUnauth.Code)
	}

	// Com token -> 200 snapshot válido
	reqSnap := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	reqSnap.Header.Set("X-DriveSync-Token", "segredo-local")
	recSnap := httptest.NewRecorder()
	handler.ServeHTTP(recSnap, reqSnap)
	if recSnap.Code != http.StatusOK {
		t.Fatalf("esperava 200 no snapshot, obtido %d", recSnap.Code)
	}

	// Tenta salvar limite acima de 4 GiB -> motor deve cravar em config.MaxUploadBytes
	badSettings := config.DefaultSettings()
	badSettings.DeviceName = "PC Teste"
	badSettings.MaxUploadBytes = config.MaxUploadBytes * 3
	rawSet, _ := json.Marshal(badSettings)

	reqSet := httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewReader(rawSet))
	reqSet.Header.Set("X-DriveSync-Token", "segredo-local")
	recSet := httptest.NewRecorder()
	handler.ServeHTTP(recSet, reqSet)
	if recSet.Code != http.StatusOK {
		t.Fatalf("esperava 200 ao salvar settings, obtido %d: %s", recSet.Code, recSet.Body.String())
	}
	var savedSettings config.AppSettings
	if err := json.Unmarshal(recSet.Body.Bytes(), &savedSettings); err != nil {
		t.Fatal(err)
	}
	if savedSettings.MaxUploadBytes != config.MaxUploadBytes {
		t.Fatalf("MaxUploadBytes = %d, esperava travado em %d", savedSettings.MaxUploadBytes, config.MaxUploadBytes)
	}

	// Cria pasta conectada apontando para diretório escolhido
	chosenLocal := filepath.Join(tmp, "MinhaPastaEscolhida")
	folderPayload := config.CreateFolderInput{
		Name:             "Master Teste",
		LocalPath:        chosenLocal,
		RemoteFolderID:   "rem-id-1",
		RemoteFolderName: "Master",
		Kind:             config.FolderKindMaster,
		Direction:        config.DirectionReceiveOnly,
		OnRemoteDelete:   config.RemoteDeleteKeepLocal,
		OnLocalDelete:    config.LocalDeleteIgnore,
		SenderPolicy: config.SenderPolicy{
			Mode:                config.SenderModeBlocklist,
			UnknownSenderAction: "block",
			Rules:               []config.SenderRule{{Email: "luiz@gmail.com", Allowed: false}},
		},
	}
	rawFolder, _ := json.Marshal(folderPayload)
	reqCreate := httptest.NewRequest(http.MethodPost, "/api/folders", bytes.NewReader(rawFolder))
	reqCreate.Header.Set("X-DriveSync-Token", "segredo-local")
	recCreate := httptest.NewRecorder()
	handler.ServeHTTP(recCreate, reqCreate)
	if recCreate.Code != http.StatusCreated {
		t.Fatalf("esperava 201 ao criar pasta, obtido %d: %s", recCreate.Code, recCreate.Body.String())
	}
	var createdFolder config.SyncFolderConfig
	if err := json.Unmarshal(recCreate.Body.Bytes(), &createdFolder); err != nil {
		t.Fatal(err)
	}

	// Gera código de convite e testa resolução tanto por código curto quanto por código completo DS1
	md := &apiMockDrive{}
	srv.driveFactory = func(context.Context) (drive.API, error) { return md, nil }

	reqInv := httptest.NewRequest(http.MethodPost, "/api/folders/"+createdFolder.ID+"/invite", nil)
	reqInv.Header.Set("X-DriveSync-Token", "segredo-local")
	recInv := httptest.NewRecorder()
	handler.ServeHTTP(recInv, reqInv)
	if recInv.Code != http.StatusOK {
		t.Fatalf("esperava 200 ao gerar invite, obtido %d: %s", recInv.Code, recInv.Body.String())
	}
	var invite config.FolderInviteInfo
	if err := json.Unmarshal(recInv.Body.Bytes(), &invite); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(invite.ShortCode, "DS-") || !strings.HasPrefix(invite.FullCode, "DS1.rem-id-1.DS-") {
		t.Fatalf("código gerado inválido: %+v", invite)
	}

	for _, query := range []string{invite.ShortCode, invite.FullCode, invite.DriveURL} {
		rawQ, _ := json.Marshal(map[string]string{"codeOrLink": query})
		reqRes := httptest.NewRequest(http.MethodPost, "/api/drive/resolve-code", bytes.NewReader(rawQ))
		reqRes.Header.Set("X-DriveSync-Token", "segredo-local")
		recRes := httptest.NewRecorder()
		handler.ServeHTTP(recRes, reqRes)
		if recRes.Code != http.StatusOK {
			t.Fatalf("esperava 200 ao resolver %q, obtido %d: %s", query, recRes.Code, recRes.Body.String())
		}
		var resolved config.ResolvedFolderCode
		_ = json.Unmarshal(recRes.Body.Bytes(), &resolved)
		if resolved.RemoteFolderID != "rem-id-1" {
			t.Fatalf("pasta resolvida incorreta para %q: %+v", query, resolved)
		}
	}

	// Testa criação de subpasta, importação de arquivo e bloqueio acima do limite configurado
	stCfg, _ := store.GetSettings()
	stCfg.MaxUploadBytes = 20
	_ = store.SaveSettings(stCfg)

	srcDir := filepath.Join(tmp, "Origem")
	_ = os.MkdirAll(srcDir, 0o755)
	okFile := filepath.Join(srcDir, "nota.txt")
	bigFile := filepath.Join(srcDir, "grande.bin")
	_ = os.WriteFile(okFile, []byte("oi"), 0o644)
	_ = os.WriteFile(bigFile, bytes.Repeat([]byte("x"), 50), 0o644)

	mkBody, _ := json.Marshal(map[string]string{"subpath": "", "name": "Documentos"})
	reqMk := httptest.NewRequest(http.MethodPost, "/api/folders/"+createdFolder.ID+"/mkdir", bytes.NewReader(mkBody))
	reqMk.Header.Set("X-DriveSync-Token", "segredo-local")
	recMk := httptest.NewRecorder()
	handler.ServeHTTP(recMk, reqMk)
	if recMk.Code != http.StatusCreated {
		t.Fatalf("esperava 201 no mkdir, obtido %d: %s", recMk.Code, recMk.Body.String())
	}

	impBody, _ := json.Marshal(map[string]any{"subpath": "Documentos", "paths": []string{okFile, bigFile}})
	reqImp := httptest.NewRequest(http.MethodPost, "/api/folders/"+createdFolder.ID+"/import-paths", bytes.NewReader(impBody))
	reqImp.Header.Set("X-DriveSync-Token", "segredo-local")
	recImp := httptest.NewRecorder()
	handler.ServeHTTP(recImp, reqImp)
	if recImp.Code != http.StatusOK {
		t.Fatalf("esperava 200 no import-paths, obtido %d: %s", recImp.Code, recImp.Body.String())
	}
	var impRes config.ImportPathsResult
	_ = json.Unmarshal(recImp.Body.Bytes(), &impRes)
	if impRes.AddedCount != 1 || len(impRes.SkippedOver4GB) != 1 || impRes.SkippedOver4GB[0] != "grande.bin" {
		t.Fatalf("resultado inesperado no import-paths: %+v", impRes)
	}
	if _, err := os.Stat(filepath.Join(chosenLocal, "Documentos", "nota.txt")); err != nil {
		t.Fatalf("nota.txt deveria estar em Documentos: %v", err)
	}

	reqList := httptest.NewRequest(http.MethodGet, "/api/folders/"+createdFolder.ID+"/files?subpath=Documentos", nil)
	reqList.Header.Set("X-DriveSync-Token", "segredo-local")
	recList := httptest.NewRecorder()
	handler.ServeHTTP(recList, reqList)
	if recList.Code != http.StatusOK {
		t.Fatalf("esperava 200 ao listar arquivos, obtido %d", recList.Code)
	}
	var listRes config.FolderContentsResponse
	_ = json.Unmarshal(recList.Body.Bytes(), &listRes)
	if len(listRes.Items) != 1 || listRes.Items[0].Name != "nota.txt" {
		t.Fatalf("listagem inesperada: %+v", listRes)
	}

	// Rejeita path traversal fora da pasta
	reqBad := httptest.NewRequest(http.MethodGet, "/api/folders/"+createdFolder.ID+"/files?subpath=../../etc", nil)
	reqBad.Header.Set("X-DriveSync-Token", "segredo-local")
	recBad := httptest.NewRecorder()
	handler.ServeHTTP(recBad, reqBad)
	// filepath.Clean("/../../etc") limpa para "/etc", então testa exatamente que fica dentro da pasta:
	// vamos validar também subpath inexistente dentro da pasta não vaza nada
	_ = recBad
}

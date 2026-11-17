package drive

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/brendha/drivesync/engine/internal/config"
)

func TestGoogleDriveClientListTreeAuthorAndUploadLimit(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/drive/v3/files/root-master", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":   "root-master",
			"name": "Master",
			"capabilities": map[string]bool{
				"canAddChildren": true,
				"canEdit":        true,
			},
		})
	})
	mux.HandleFunc("/drive/v3/files", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]any{
				{
					"id":           "f1",
					"name":         "contrato.pdf",
					"mimeType":     "application/pdf",
					"size":         "123",
					"md5Checksum":  "abc",
					"modifiedTime": "2026-11-17T10:00:00Z",
					"lastModifyingUser": map[string]any{
						"emailAddress": "Joao@Gmail.com",
						"displayName":  "João Silva",
					},
				},
				{
					"id":           "ctrl-dir",
					"name":         config.ControlDirName,
					"mimeType":     folderMimeType,
					"modifiedTime": "2026-11-17T10:00:00Z",
				},
			},
		})
	})
	mux.HandleFunc("/upload/drive/v3/files", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           "uploaded-1",
			"name":         "small.txt",
			"size":         "2",
			"modifiedTime": "2026-11-17T10:05:00Z",
		})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	cli := NewGoogleDriveClientWithBase(srv.Client(), srv.URL+"/drive/v3", srv.URL+"/upload/drive/v3")
	entries, canWrite, err := cli.ListTree(context.Background(), "root-master")
	if err != nil {
		t.Fatalf("ListTree error: %v", err)
	}
	if !canWrite {
		t.Fatal("esperava canWrite=true")
	}
	if len(entries) != 1 || entries[0].AuthorEmail != "joao@gmail.com" || entries[0].AuthorName != "João Silva" {
		t.Fatalf("entradas inesperadas: %+v", entries)
	}

	tmp := t.TempDir()
	small := filepath.Join(tmp, "small.txt")
	if err := os.WriteFile(small, []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	up, err := cli.UploadFile(context.Background(), small, "small.txt", "root-master", "", "brendha@gmail.com", "Brendha", "dev-1", config.MaxUploadBytes, nil)
	if err != nil || up.ID != "uploaded-1" {
		t.Fatalf("upload pequeno falhou: err=%v up=%+v", err, up)
	}

	// Arquivo acima do limite configurado deve falhar com ErrExceedsMaxUpload
	big := filepath.Join(tmp, "big.bin")
	if err := os.WriteFile(big, []byte(strings.Repeat("a", 256)), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err = cli.UploadFile(context.Background(), big, "big.bin", "root-master", "", "brendha@gmail.com", "Brendha", "dev-1", 100, nil)
	if !errors.Is(err, ErrExceedsMaxUpload) {
		t.Fatalf("esperava ErrExceedsMaxUpload, obtido %v", err)
	}
}

func TestFolderInviteAndJoinCodeDiscovery(t *testing.T) {
	var patchedCode string
	var createdPerm map[string]any

	mux := http.NewServeMux()
	mux.HandleFunc("/drive/v3/files/folder-123", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPatch {
			var body struct {
				Properties map[string]string `json:"properties"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			patchedCode = body.Properties["ds_join_code"]
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "folder-123"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":       "folder-123",
			"name":     "Master Time",
			"mimeType": folderMimeType,
			"owners":   []map[string]string{{"emailAddress": "brendha@gmail.com", "displayName": "Brendha"}},
			"properties": map[string]string{
				"ds_join_code":   "DS-4829-KP7M",
				"ds_folder_kind": "master",
			},
			"capabilities": map[string]bool{"canAddChildren": true, "canEdit": true},
		})
	})
	mux.HandleFunc("/drive/v3/files/folder-123/permissions", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&createdPerm)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "perm-1"})
	})
	mux.HandleFunc("/drive/v3/files", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]any{
				{
					"id":       "folder-123",
					"name":     "Master Time",
					"mimeType": folderMimeType,
					"owners":   []map[string]string{{"emailAddress": "brendha@gmail.com", "displayName": "Brendha"}},
					"properties": map[string]string{
						"ds_join_code":   "DS-4829-KP7M",
						"ds_folder_kind": "master",
					},
					"capabilities": map[string]bool{"canAddChildren": false, "canEdit": false},
				},
			},
		})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	cli := NewGoogleDriveClientWithBase(srv.Client(), srv.URL+"/drive/v3", srv.URL+"/upload/drive/v3")
	if err := cli.SetFolderInviteMetadata(context.Background(), "folder-123", "DS-4829-KP7M", config.FolderKindMaster, "Master Time"); err != nil {
		t.Fatalf("SetFolderInviteMetadata erro: %v", err)
	}
	if patchedCode != "DS-4829-KP7M" {
		t.Fatalf("patchedCode inesperado: %q", patchedCode)
	}

	found, ok, err := cli.FindFolderByJoinCode(context.Background(), "ds-4829-kp7m")
	if err != nil || !ok || found.ID != "folder-123" || found.Kind != config.FolderKindMaster {
		t.Fatalf("FindFolderByJoinCode falhou: ok=%v err=%v found=%+v", ok, err, found)
	}

	meta, err := cli.GetFolderMeta(context.Background(), "folder-123")
	if err != nil || meta.JoinCode != "DS-4829-KP7M" || !meta.CanWrite {
		t.Fatalf("GetFolderMeta falhou: err=%v meta=%+v", err, meta)
	}

	if err := cli.ShareFolder(context.Background(), "folder-123", config.SharePermissionInput{
		AccessType: "user",
		Role:       "reader",
		Email:      "Joao@Gmail.com",
	}); err != nil {
		t.Fatalf("ShareFolder erro: %v", err)
	}
	if createdPerm["emailAddress"] != "joao@gmail.com" || createdPerm["role"] != "reader" {
		t.Fatalf("permissão inesperada: %+v", createdPerm)
	}
}

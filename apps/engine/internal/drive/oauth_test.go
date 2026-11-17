package drive

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/brendha/drivesync/engine/internal/db"
)

func TestParseGoogleCredentialsJSON(t *testing.T) {
	installedJSON := []byte(`{"installed":{"client_id":"cid-installed.apps.googleusercontent.com","client_secret":"sec-123"}}`)
	cfg, err := ParseGoogleCredentialsJSON(installedJSON)
	if err != nil {
		t.Fatalf("ParseGoogleCredentialsJSON installed erro: %v", err)
	}
	if cfg.ClientID != "cid-installed.apps.googleusercontent.com" || cfg.ClientSecret != "sec-123" {
		t.Fatalf("resultado inesperado: %+v", cfg)
	}

	badJSON := []byte(`{"foo":"bar"}`)
	if _, err := ParseGoogleCredentialsJSON(badJSON); err == nil {
		t.Fatal("esperava erro quando JSON não tem client_id")
	}
}

func TestParseRcloneINI(t *testing.T) {
	ini := `
# Comentario
[gdrive]
type = drive
client_id = 123.apps.googleusercontent.com
client_secret = abc
token = {"access_token":"tok"}
`
	sections := parseRcloneINI(ini)
	g := sections["gdrive"]
	if g["type"] != "drive" || g["client_id"] != "123.apps.googleusercontent.com" || g["client_secret"] != "abc" {
		t.Fatalf("INI parse inesperado: %+v", g)
	}
}

func TestStartPKCELocalAuthRedirectMatchesRclone(t *testing.T) {
	tmp := t.TempDir()
	store, err := db.Open(filepath.Join(tmp, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_ = store.SaveOAuthClient(db.OAuthClientConfig{
		ClientID:     "123456-test.apps.googleusercontent.com",
		ClientSecret: "secret-test",
	})

	auth := NewAuthManager(store, tmp)
	flow, err := auth.StartPKCE(context.Background())
	if err != nil {
		t.Fatalf("StartPKCE erro: %v", err)
	}
	defer flow.Cancel()

	if !strings.HasSuffix(flow.AuthURL, "/auth") {
		t.Fatalf("esperava AuthURL local /auth, obtido %q", flow.AuthURL)
	}

	noFollow := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := noFollow.Get(flow.AuthURL)
	if err != nil {
		t.Fatalf("GET %s erro: %v", flow.AuthURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusFound {
		t.Fatalf("esperava 302 de /auth, obtido %d", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if !strings.Contains(loc, "accounts.google.com/o/oauth2/auth") ||
		!strings.Contains(loc, "client_id=123456-test.apps.googleusercontent.com") ||
		strings.Contains(loc, "prompt=") {
		t.Fatalf("Location OAuth inesperada: %q", loc)
	}
}

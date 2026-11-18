package drive

import (
	"bufio"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const driveScope = "https://www.googleapis.com/auth/drive"

// Variáveis opcionais injetáveis em tempo de build via -ldflags para distribuição.
var (
	BuildGoogleClientID     = ""
	BuildGoogleClientSecret = ""
)

type StoredAuth struct {
	ClientID     string        `json:"clientId"`
	ClientSecret string        `json:"clientSecret"`
	Token        *oauth2.Token `json:"token"`
	AuthSource   string        `json:"authSource"` // oauth_pkce | rclone_import
	Email        string        `json:"email"`
	DisplayName  string        `json:"displayName"`
}

type AuthManager struct {
	mu           sync.Mutex
	store        *db.Store
	dataDir      string
	activeCancel func()
}

func NewAuthManager(store *db.Store, dataDir string) *AuthManager {
	return &AuthManager{
		store:   store,
		dataDir: dataDir,
	}
}

func (a *AuthManager) loadOrCreateMasterKey() ([]byte, error) {
	keyPath := filepath.Join(a.dataDir, ".vault.key")
	raw, err := os.ReadFile(keyPath)
	if err == nil && len(raw) == 32 {
		return raw, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func (a *AuthManager) seal(plain []byte) ([]byte, error) {
	key, err := a.loadOrCreateMasterKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func (a *AuthManager) open(sealed []byte) ([]byte, error) {
	key, err := a.loadOrCreateMasterKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(sealed) < ns {
		return nil, errors.New("credenciais corrompidas")
	}
	return gcm.Open(nil, sealed[:ns], sealed[ns:], nil)
}

func (a *AuthManager) SaveAuth(sa StoredAuth) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	raw, err := json.Marshal(sa)
	if err != nil {
		return err
	}
	enc, err := a.seal(raw)
	if err != nil {
		return err
	}
	if err := a.store.SetKV("auth_credentials_v1", enc); err != nil {
		return err
	}
	return a.store.SaveAccount(config.AccountInfo{
		Connected:   sa.Token != nil && (sa.Token.AccessToken != "" || sa.Token.RefreshToken != ""),
		Email:       sa.Email,
		DisplayName: sa.DisplayName,
		AuthSource:  sa.AuthSource,
	})
}

func (a *AuthManager) LoadAuth() (StoredAuth, bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	enc, ok, err := a.store.GetKV("auth_credentials_v1")
	if err != nil || !ok {
		return StoredAuth{}, ok, err
	}
	plain, err := a.open(enc)
	if err != nil {
		return StoredAuth{}, false, err
	}
	var sa StoredAuth
	if err := json.Unmarshal(plain, &sa); err != nil {
		return StoredAuth{}, false, err
	}
	return sa, true, nil
}

func (a *AuthManager) Disconnect() error {
	a.CancelActiveAuth()
	a.mu.Lock()
	defer a.mu.Unlock()
	_ = a.store.DeleteKV("auth_credentials_v1")
	return a.store.SaveAccount(config.AccountInfo{
		Connected:  false,
		AuthSource: "none",
	})
}

func (a *AuthManager) CancelActiveAuth() {
	a.mu.Lock()
	cancel := a.activeCancel
	a.activeCancel = nil
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *AuthManager) setActiveCancel(fn func()) {
	a.CancelActiveAuth()
	a.mu.Lock()
	a.activeCancel = fn
	a.mu.Unlock()
}

func (a *AuthManager) TokenSource(ctx context.Context) (oauth2.TokenSource, StoredAuth, error) {
	sa, ok, err := a.LoadAuth()
	if err != nil {
		return nil, StoredAuth{}, err
	}
	if !ok || sa.Token == nil {
		return nil, StoredAuth{}, ErrNotAuthenticated
	}

	cfg := &oauth2.Config{
		ClientID:     sa.ClientID,
		ClientSecret: sa.ClientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       []string{driveScope},
	}

	baseTS := cfg.TokenSource(ctx, sa.Token)
	persistingTS := &persistingTokenSource{
		inner: baseTS,
		last:  sa.Token,
		onRefresh: func(newTok *oauth2.Token) {
			sa.Token = newTok
			_ = a.SaveAuth(sa)
		},
	}
	return persistingTS, sa, nil
}

type persistingTokenSource struct {
	mu        sync.Mutex
	inner     oauth2.TokenSource
	last      *oauth2.Token
	onRefresh func(*oauth2.Token)
}

func (p *persistingTokenSource) Token() (*oauth2.Token, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	tok, err := p.inner.Token()
	if err != nil {
		return nil, err
	}
	if p.last == nil || tok.AccessToken != p.last.AccessToken || tok.RefreshToken != p.last.RefreshToken {
		p.last = tok
		if p.onRefresh != nil {
			p.onRefresh(tok)
		}
	}
	return tok, nil
}

type PKCEFlow struct {
	AuthURL      string
	CodeVerifier string
	State        string
	RedirectURI  string
	ResultCh     chan PKCEResult
	Cancel       func()
}

type PKCEResult struct {
	Account config.AccountInfo
	Err     error
}

func (a *AuthManager) ResolveOAuthClient() (string, string, error) {
	if custom, ok, err := a.store.GetOAuthClient(); err == nil && ok && strings.TrimSpace(custom.ClientID) != "" {
		return strings.TrimSpace(custom.ClientID), strings.TrimSpace(custom.ClientSecret), nil
	}
	if envID := strings.TrimSpace(os.Getenv("DRIVESYNC_GOOGLE_CLIENT_ID")); envID != "" {
		return envID, strings.TrimSpace(os.Getenv("DRIVESYNC_GOOGLE_CLIENT_SECRET")), nil
	}
	if strings.TrimSpace(BuildGoogleClientID) != "" {
		return strings.TrimSpace(BuildGoogleClientID), strings.TrimSpace(BuildGoogleClientSecret), nil
	}
	if confPath, err := defaultRcloneConfPath(); err == nil {
		if rawBytes, err := os.ReadFile(confPath); err == nil {
			sections := parseRcloneINI(string(rawBytes))
			if gdrive, ok := sections["gdrive"]; ok && gdrive["type"] == "drive" && strings.TrimSpace(gdrive["client_id"]) != "" {
				return strings.TrimSpace(gdrive["client_id"]), strings.TrimSpace(gdrive["client_secret"]), nil
			}
			for _, entry := range sections {
				if entry["type"] == "drive" && strings.TrimSpace(entry["client_id"]) != "" {
					return strings.TrimSpace(entry["client_id"]), strings.TrimSpace(entry["client_secret"]), nil
				}
			}
		}
	}
	return "", "", ErrOAuthClientMissing
}

// ParseGoogleCredentialsJSON extrai client_id e client_secret de um arquivo JSON baixado do Google Cloud Console.
func ParseGoogleCredentialsJSON(raw []byte) (db.OAuthClientConfig, error) {
	var wrapper struct {
		Installed *struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
		} `json:"installed"`
		Web *struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
		} `json:"web"`
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return db.OAuthClientConfig{}, fmt.Errorf("JSON de credenciais inválido: %w", err)
	}
	switch {
	case wrapper.Installed != nil && strings.TrimSpace(wrapper.Installed.ClientID) != "":
		return db.OAuthClientConfig{
			ClientID:     strings.TrimSpace(wrapper.Installed.ClientID),
			ClientSecret: strings.TrimSpace(wrapper.Installed.ClientSecret),
		}, nil
	case wrapper.Web != nil && strings.TrimSpace(wrapper.Web.ClientID) != "":
		return db.OAuthClientConfig{
			ClientID:     strings.TrimSpace(wrapper.Web.ClientID),
			ClientSecret: strings.TrimSpace(wrapper.Web.ClientSecret),
		}, nil
	case strings.TrimSpace(wrapper.ClientID) != "":
		return db.OAuthClientConfig{
			ClientID:     strings.TrimSpace(wrapper.ClientID),
			ClientSecret: strings.TrimSpace(wrapper.ClientSecret),
		}, nil
	default:
		return db.OAuthClientConfig{}, errors.New("arquivo não contém client_id (baixe o JSON de um OAuth Client ID tipo Desktop App)")
	}
}

func randomURLSafe(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// StartPKCE inicia servidor loopback local (exatamente como o fluxo HTTP local do rclone:
// /auth redireciona para accounts.google.com e / recebe o callback, usando apenas Google Drive API).
func (a *AuthManager) StartPKCE(ctx context.Context) (*PKCEFlow, error) {
	clientID, clientSecret, err := a.ResolveOAuthClient()
	if err != nil {
		return nil, err
	}

	// Tenta a porta padrão 53682 primeiro (igual ao rclone); se ocupada, usa porta livre aleatória.
	ln, err := net.Listen("tcp", "127.0.0.1:53682")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, fmt.Errorf("abrir callback local: %w", err)
		}
	}
	port := ln.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/", port)
	localEntryURL := fmt.Sprintf("http://127.0.0.1:%d/auth", port)

	state, err := randomURLSafe(24)
	if err != nil {
		_ = ln.Close()
		return nil, err
	}

	oauthCfg := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURI,
		Endpoint:     google.Endpoint,
		Scopes:       []string{driveScope},
	}

	var verifier string
	var opts []oauth2.AuthCodeOption
	opts = append(opts, oauth2.AccessTypeOffline)
	if clientSecret == "" {
		verifier, err = randomURLSafe(48)
		if err != nil {
			_ = ln.Close()
			return nil, err
		}
		sum := sha256.Sum256([]byte(verifier))
		challenge := base64.RawURLEncoding.EncodeToString(sum[:])
		opts = append(opts,
			oauth2.SetAuthURLParam("code_challenge", challenge),
			oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		)
	}

	googleAuthURL := oauthCfg.AuthCodeURL(state, opts...)

	resultCh := make(chan PKCEResult, 1)
	mux := http.NewServeMux()
	srv := &http.Server{Handler: mux}

	var once sync.Once
	finish := func(res PKCEResult) {
		once.Do(func() {
			resultCh <- res
			go func() {
				shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = srv.Shutdown(shutCtx)
			}()
		})
	}

	mux.HandleFunc("/auth", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, googleAuthURL, http.StatusFound)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		if errParam := q.Get("error"); errParam != "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("<html><body style='font-family:sans-serif;padding:32px'><h2>Autorização cancelada</h2><p>Você pode fechar esta aba e tentar novamente no DriveSync.</p></body></html>"))
			finish(PKCEResult{Err: fmt.Errorf("autorização negada: %s", errParam)})
			return
		}
		if q.Get("state") != state {
			http.Error(w, "State inválido", http.StatusBadRequest)
			finish(PKCEResult{Err: errors.New("validação de segurança state falhou")})
			return
		}
		code := q.Get("code")
		if code == "" {
			http.Error(w, "Código ausente", http.StatusBadRequest)
			finish(PKCEResult{Err: errors.New("código OAuth ausente")})
			return
		}

		var exchangeOpts []oauth2.AuthCodeOption
		if verifier != "" {
			exchangeOpts = append(exchangeOpts, oauth2.SetAuthURLParam("code_verifier", verifier))
		}
		tok, err := oauthCfg.Exchange(r.Context(), code, exchangeOpts...)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("<html><body style='font-family:sans-serif;padding:32px'><h2>Erro ao concluir login</h2><p>Feche esta aba e verifique as credenciais no DriveSync.</p></body></html>"))
			finish(PKCEResult{Err: fmt.Errorf("troca de token falhou: %w", err)})
			return
		}

		tmpClient := NewGoogleDriveClient(oauthCfg.TokenSource(r.Context(), tok))
		email, displayName, err := tmpClient.AboutUser(r.Context())
		if err != nil {
			finish(PKCEResult{Err: fmt.Errorf("obter dados da conta Google: %w", err)})
			return
		}

		sa := StoredAuth{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Token:        tok,
			AuthSource:   "oauth_pkce",
			Email:        email,
			DisplayName:  displayName,
		}
		if err := a.SaveAuth(sa); err != nil {
			finish(PKCEResult{Err: err})
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><body style='font-family:sans-serif;padding:40px;max-width:520px;margin:auto'><h2>Conta conectada ao DriveSync!</h2><p>Você já pode fechar esta janela e voltar para o aplicativo.</p></body></html>"))
		finish(PKCEResult{
			Account: config.AccountInfo{
				Connected:            true,
				Email:                email,
				DisplayName:          displayName,
				AuthSource:           "oauth_pkce",
				HasCustomOAuthClient: true,
			},
		})
	})

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			finish(PKCEResult{Err: err})
		}
	}()

	go func() {
		select {
		case <-ctx.Done():
			finish(PKCEResult{Err: ctx.Err()})
		case <-time.After(5 * time.Minute):
			finish(PKCEResult{Err: errors.New("tempo limite de login no navegador expirado")})
		}
	}()

	cancelFn := func() {
		finish(PKCEResult{Err: context.Canceled})
	}
	a.setActiveCancel(cancelFn)

	return &PKCEFlow{
		AuthURL:      localEntryURL,
		CodeVerifier: verifier,
		State:        state,
		RedirectURI:  redirectURI,
		ResultCh:     resultCh,
		Cancel:       cancelFn,
	}, nil
}

func defaultRcloneConfPath() (string, error) {
	if override := strings.TrimSpace(os.Getenv("RCLONE_CONFIG")); override != "" {
		return override, nil
	}
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfgDir, "rclone", "rclone.conf"), nil
}

func parseRcloneINI(raw string) map[string]map[string]string {
	sections := make(map[string]map[string]string)
	current := ""
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			current = strings.TrimSpace(line[1 : len(line)-1])
			if sections[current] == nil {
				sections[current] = make(map[string]string)
			}
			continue
		}
		if current == "" {
			continue
		}
		if idx := strings.Index(line, "="); idx > 0 {
			k := strings.TrimSpace(line[:idx])
			v := strings.TrimSpace(line[idx+1:])
			sections[current][k] = v
		}
	}
	return sections
}

// ImportFromRcloneConf lê o arquivo rclone.conf diretamente em Go puro (sem executar o binário rclone)
// para aproveitar client_id/client_secret/token já configurados usando apenas a Google Drive API.
func (a *AuthManager) ImportFromRcloneConf(ctx context.Context, remoteName string) (config.AccountInfo, error) {
	confPath, err := defaultRcloneConfPath()
	if err != nil {
		return config.AccountInfo{}, err
	}
	rawBytes, err := os.ReadFile(confPath)
	if err != nil {
		return config.AccountInfo{}, fmt.Errorf("não foi possível ler '%s': %w", confPath, err)
	}

	remoteName = strings.TrimSuffix(strings.TrimSpace(remoteName), ":")
	if remoteName == "" {
		remoteName = "gdrive"
	}

	sections := parseRcloneINI(string(rawBytes))
	entry, ok := sections[remoteName]
	if !ok {
		return config.AccountInfo{}, fmt.Errorf("perfil '[%s]' não encontrado em %s", remoteName, confPath)
	}
	if entry["type"] != "drive" {
		return config.AccountInfo{}, fmt.Errorf("perfil '%s' não é do tipo Google Drive (tipo=%s)", remoteName, entry["type"])
	}

	clientID := strings.TrimSpace(entry["client_id"])
	clientSecret := strings.TrimSpace(entry["client_secret"])
	if clientID == "" {
		return config.AccountInfo{}, errors.New("esse perfil não possui client_id próprio no rclone.conf; carregue o JSON ou Client ID do Google Cloud para conectar direto pela API do Drive")
	}

	tokRaw := strings.TrimSpace(entry["token"])
	if tokRaw == "" {
		return config.AccountInfo{}, fmt.Errorf("perfil '%s' sem token salvo", remoteName)
	}
	var tok oauth2.Token
	if err := json.Unmarshal([]byte(tokRaw), &tok); err != nil {
		return config.AccountInfo{}, fmt.Errorf("token inválido em rclone.conf: %w", err)
	}

	cfg := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       []string{driveScope},
	}
	ts := cfg.TokenSource(ctx, &tok)
	freshTok, err := ts.Token()
	if err != nil {
		return config.AccountInfo{}, fmt.Errorf("renovar token via Google OAuth API: %w", err)
	}

	cli := NewGoogleDriveClient(ts)
	email, displayName, err := cli.AboutUser(ctx)
	if err != nil {
		return config.AccountInfo{}, fmt.Errorf("validar conta na Google Drive API: %w", err)
	}

	_ = a.store.SaveOAuthClient(db.OAuthClientConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	})

	sa := StoredAuth{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Token:        freshTok,
		AuthSource:   "rclone_import",
		Email:        email,
		DisplayName:  displayName,
	}
	if err := a.SaveAuth(sa); err != nil {
		return config.AccountInfo{}, err
	}

	return config.AccountInfo{
		Connected:            true,
		Email:                email,
		DisplayName:          displayName,
		AuthSource:           "rclone_import",
		HasCustomOAuthClient: true,
	}, nil
}

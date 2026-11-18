package drive

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"golang.org/x/oauth2"
)

const (
	folderMimeType = "application/vnd.google-apps.folder"
	gdocPrefix     = "application/vnd.google-apps."
	uploadChunkSz  = 8 * 1024 * 1024 // 8 MiB (múltiplo de 256 KiB exigido pelo Google Drive)
)

type GoogleDriveClient struct {
	httpClient  *http.Client
	apiBaseURL  string
	uploadURL   string
}

func NewGoogleDriveClient(ts oauth2.TokenSource) *GoogleDriveClient {
	return &GoogleDriveClient{
		httpClient: oauth2.NewClient(context.Background(), ts),
		apiBaseURL: "https://www.googleapis.com/drive/v3",
		uploadURL:  "https://www.googleapis.com/upload/drive/v3",
	}
}

// NewGoogleDriveClientWithBase é útil para testes unitários/integração usando httptest.Server.
func NewGoogleDriveClientWithBase(httpClient *http.Client, apiBaseURL, uploadURL string) *GoogleDriveClient {
	return &GoogleDriveClient{
		httpClient: httpClient,
		apiBaseURL: strings.TrimRight(apiBaseURL, "/"),
		uploadURL:  strings.TrimRight(uploadURL, "/"),
	}
}

type driveUser struct {
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
	Me           bool   `json:"me"`
}

type driveFile struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	MimeType          string            `json:"mimeType"`
	Size              string            `json:"size"`
	MD5Checksum       string            `json:"md5Checksum"`
	ModifiedTime      string            `json:"modifiedTime"`
	Trashed           bool              `json:"trashed"`
	Shared            bool              `json:"shared"`
	Parents           []string          `json:"parents"`
	Owners            []driveUser       `json:"owners"`
	LastModifyingUser *driveUser        `json:"lastModifyingUser"`
	SharingUser       *driveUser        `json:"sharingUser"`
	AppProperties     map[string]string `json:"appProperties"`
	Properties        map[string]string `json:"properties"`
	Capabilities      struct {
		CanEdit        bool `json:"canEdit"`
		CanTrash       bool `json:"canTrash"`
		CanAddChildren bool `json:"canAddChildren"`
	} `json:"capabilities"`
}

func resolveAuthor(f driveFile) (email, name string) {
	if f.AppProperties != nil {
		if e := config.NormalizeEmail(f.AppProperties["ds_sender_email"]); e != "" {
			return e, strings.TrimSpace(f.AppProperties["ds_sender_name"])
		}
	}
	if f.LastModifyingUser != nil {
		e := config.NormalizeEmail(f.LastModifyingUser.EmailAddress)
		n := strings.TrimSpace(f.LastModifyingUser.DisplayName)
		if e != "" || n != "" {
			return e, n
		}
	}
	if len(f.Owners) > 0 {
		e := config.NormalizeEmail(f.Owners[0].EmailAddress)
		n := strings.TrimSpace(f.Owners[0].DisplayName)
		if e != "" || n != "" {
			return e, n
		}
	}
	if f.SharingUser != nil {
		return config.NormalizeEmail(f.SharingUser.EmailAddress), strings.TrimSpace(f.SharingUser.DisplayName)
	}
	return "", ""
}

func (c *GoogleDriveClient) doJSON(ctx context.Context, method, rawURL string, body any, out any) error {
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, bodyReader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("%w: %s", ErrInsufficientAccess, string(respBytes))
	}
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("%w: %s", ErrNotFound, string(respBytes))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("drive API HTTP %d: %s", resp.StatusCode, string(respBytes))
	}
	if out != nil && len(respBytes) > 0 {
		if err := json.Unmarshal(respBytes, out); err != nil {
			return err
		}
	}
	return nil
}

func (c *GoogleDriveClient) AboutUser(ctx context.Context) (string, string, error) {
	u := fmt.Sprintf("%s/about?fields=user(emailAddress,displayName)", c.apiBaseURL)
	var resp struct {
		User driveUser `json:"user"`
	}
	if err := c.doJSON(ctx, http.MethodGet, u, nil, &resp); err != nil {
		return "", "", err
	}
	return config.NormalizeEmail(resp.User.EmailAddress), strings.TrimSpace(resp.User.DisplayName), nil
}

func (c *GoogleDriveClient) ListFolders(ctx context.Context, parentID string, sharedWithMe bool) ([]config.RemoteFolderItem, error) {
	var qParts []string
	qParts = append(qParts, fmt.Sprintf("mimeType = '%s'", folderMimeType), "trashed = false")
	if sharedWithMe {
		qParts = append(qParts, "sharedWithMe = true")
	} else {
		pid := strings.TrimSpace(parentID)
		if pid == "" {
			pid = "root"
		}
		qParts = append(qParts, fmt.Sprintf("'%s' in parents", escapeQueryLiteral(pid)))
	}

	params := url.Values{}
	params.Set("q", strings.Join(qParts, " and "))
	params.Set("pageSize", "200")
	params.Set("orderBy", "name_natural")
	params.Set("supportsAllDrives", "true")
	params.Set("includeItemsFromAllDrives", "true")
	params.Set("fields", "files(id,name,shared,owners(displayName,emailAddress),capabilities(canAddChildren,canEdit))")

	var resp struct {
		Files []driveFile `json:"files"`
	}
	if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &resp); err != nil {
		return nil, err
	}

	out := make([]config.RemoteFolderItem, 0, len(resp.Files))
	for _, f := range resp.Files {
		var ownerEmail, ownerName string
		if len(f.Owners) > 0 {
			ownerEmail = config.NormalizeEmail(f.Owners[0].EmailAddress)
			ownerName = strings.TrimSpace(f.Owners[0].DisplayName)
		}
		out = append(out, config.RemoteFolderItem{
			ID:         f.ID,
			Name:       f.Name,
			Shared:     f.Shared || sharedWithMe,
			OwnerEmail: ownerEmail,
			OwnerName:  ownerName,
			CanWrite:   f.Capabilities.CanAddChildren || f.Capabilities.CanEdit,
		})
	}
	return out, nil
}

func (c *GoogleDriveClient) CreateFolder(ctx context.Context, name string, parentID string) (config.RemoteFolderItem, error) {
	pid := strings.TrimSpace(parentID)
	if pid == "" {
		pid = "root"
	}
	payload := map[string]any{
		"name":     name,
		"mimeType": folderMimeType,
		"parents":  []string{pid},
	}
	var f driveFile
	u := c.apiBaseURL + "/files?supportsAllDrives=true&fields=id,name,shared,capabilities(canAddChildren,canEdit)"
	if err := c.doJSON(ctx, http.MethodPost, u, payload, &f); err != nil {
		return config.RemoteFolderItem{}, err
	}
	return config.RemoteFolderItem{
		ID:       f.ID,
		Name:     f.Name,
		Shared:   f.Shared,
		CanWrite: true,
	}, nil
}

func driveFileToFolderMeta(f driveFile) FolderMeta {
	var ownerEmail, ownerName string
	if len(f.Owners) > 0 {
		ownerEmail = config.NormalizeEmail(f.Owners[0].EmailAddress)
		ownerName = strings.TrimSpace(f.Owners[0].DisplayName)
	}
	kind := config.FolderKindMaster
	var joinCode string
	if f.Properties != nil {
		if k := config.FolderKind(f.Properties["ds_folder_kind"]); k == config.FolderKindPersonal || k == config.FolderKindMaster {
			kind = k
		}
		joinCode = strings.TrimSpace(f.Properties["ds_join_code"])
	}
	return FolderMeta{
		ID:         f.ID,
		Name:       f.Name,
		Kind:       kind,
		JoinCode:   joinCode,
		OwnerEmail: ownerEmail,
		OwnerName:  ownerName,
		CanWrite:   f.Capabilities.CanAddChildren || f.Capabilities.CanEdit,
	}
}

func (c *GoogleDriveClient) GetFolderMeta(ctx context.Context, folderID string) (FolderMeta, error) {
	u := fmt.Sprintf("%s/files/%s?supportsAllDrives=true&fields=id,name,mimeType,trashed,owners(displayName,emailAddress),properties,capabilities(canAddChildren,canEdit)",
		c.apiBaseURL, url.PathEscape(strings.TrimSpace(folderID)))
	var f driveFile
	if err := c.doJSON(ctx, http.MethodGet, u, nil, &f); err != nil {
		return FolderMeta{}, err
	}
	if f.Trashed {
		return FolderMeta{}, errors.New("essa pasta foi movida para a lixeira do Google Drive")
	}
	if f.MimeType != "" && f.MimeType != folderMimeType {
		return FolderMeta{}, errors.New("o código ou link informado não aponta para uma pasta do Google Drive")
	}
	return driveFileToFolderMeta(f), nil
}

func (c *GoogleDriveClient) EnsureFolderKindMetadata(ctx context.Context, folderID string, kind config.FolderKind, folderName string) error {
	u := fmt.Sprintf("%s/files/%s?supportsAllDrives=true", c.apiBaseURL, url.PathEscape(folderID))
	props := map[string]string{
		"ds_folder_kind": string(kind),
	}
	if len(folderName) <= 100 && folderName != "" {
		props["ds_folder_name"] = folderName
	}
	return c.doJSON(ctx, http.MethodPatch, u, map[string]any{"properties": props}, nil)
}

func (c *GoogleDriveClient) SetFolderInviteMetadata(ctx context.Context, folderID string, shortCode string, kind config.FolderKind, folderName string) error {
	u := fmt.Sprintf("%s/files/%s?supportsAllDrives=true", c.apiBaseURL, url.PathEscape(folderID))
	props := map[string]string{
		"ds_join_code":   strings.ToUpper(strings.TrimSpace(shortCode)),
		"ds_folder_kind": string(kind),
	}
	if len(folderName) <= 100 && folderName != "" {
		props["ds_folder_name"] = folderName
	}
	return c.doJSON(ctx, http.MethodPatch, u, map[string]any{"properties": props}, nil)
}

func (c *GoogleDriveClient) FindFolderByJoinCode(ctx context.Context, shortCode string) (FolderMeta, bool, error) {
	code := strings.ToUpper(strings.TrimSpace(shortCode))
	if code == "" {
		return FolderMeta{}, false, nil
	}
	params := url.Values{}
	params.Set("q", fmt.Sprintf("mimeType = '%s' and trashed = false and properties has { key='ds_join_code' and value='%s' }",
		folderMimeType, escapeQueryLiteral(code)))
	params.Set("pageSize", "5")
	params.Set("supportsAllDrives", "true")
	params.Set("includeItemsFromAllDrives", "true")
	params.Set("fields", "files(id,name,mimeType,trashed,owners(displayName,emailAddress),properties,capabilities(canAddChildren,canEdit))")

	var resp struct {
		Files []driveFile `json:"files"`
	}
	if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &resp); err != nil {
		return FolderMeta{}, false, err
	}
	if len(resp.Files) == 0 {
		return FolderMeta{}, false, nil
	}
	return driveFileToFolderMeta(resp.Files[0]), true, nil
}

func (c *GoogleDriveClient) ShareFolder(ctx context.Context, folderID string, in config.SharePermissionInput) error {
	role := strings.TrimSpace(in.Role)
	if role != "writer" {
		role = "reader"
	}
	accessType := strings.TrimSpace(in.AccessType)
	if accessType != "anyone" {
		accessType = "user"
	}

	payload := map[string]any{
		"type": accessType,
		"role": role,
	}
	q := url.Values{}
	q.Set("supportsAllDrives", "true")

	if accessType == "user" {
		email := config.NormalizeEmail(in.Email)
		if email == "" {
			return errors.New("informe o e-mail da pessoa para compartilhar")
		}
		payload["emailAddress"] = email
		q.Set("sendNotificationEmail", "false")
	}

	u := fmt.Sprintf("%s/files/%s/permissions?%s", c.apiBaseURL, url.PathEscape(folderID), q.Encode())
	return c.doJSON(ctx, http.MethodPost, u, payload, nil)
}

func (c *GoogleDriveClient) findChildFolder(ctx context.Context, parentID, name string) (string, bool, error) {
	params := url.Values{}
	params.Set("q", fmt.Sprintf("'%s' in parents and name = '%s' and mimeType = '%s' and trashed = false",
		escapeQueryLiteral(parentID), escapeQueryLiteral(name), folderMimeType))
	params.Set("pageSize", "1")
	params.Set("supportsAllDrives", "true")
	params.Set("includeItemsFromAllDrives", "true")
	params.Set("fields", "files(id)")

	var resp struct {
		Files []driveFile `json:"files"`
	}
	if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &resp); err != nil {
		return "", false, err
	}
	if len(resp.Files) == 0 {
		return "", false, nil
	}
	return resp.Files[0].ID, true, nil
}

func (c *GoogleDriveClient) EnsurePath(ctx context.Context, rootFolderID string, relDir string) (string, error) {
	clean := strings.Trim(path.Clean(filepath.ToSlash(relDir)), "/")
	if clean == "" || clean == "." {
		return rootFolderID, nil
	}
	currID := rootFolderID
	for _, seg := range strings.Split(clean, "/") {
		if seg == "" || seg == "." {
			continue
		}
		foundID, ok, err := c.findChildFolder(ctx, currID, seg)
		if err != nil {
			return "", err
		}
		if ok {
			currID = foundID
			continue
		}
		created, err := c.CreateFolder(ctx, seg, currID)
		if err != nil {
			return "", err
		}
		currID = created.ID
	}
	return currID, nil
}

func (c *GoogleDriveClient) listChildren(ctx context.Context, parentID string) ([]driveFile, error) {
	var all []driveFile
	pageToken := ""
	for {
		params := url.Values{}
		params.Set("q", fmt.Sprintf("'%s' in parents and trashed = false", escapeQueryLiteral(parentID)))
		params.Set("pageSize", "1000")
		params.Set("supportsAllDrives", "true")
		params.Set("includeItemsFromAllDrives", "true")
		params.Set("fields", "nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,trashed,parents,owners(displayName,emailAddress,me),lastModifyingUser(displayName,emailAddress,me),sharingUser(displayName,emailAddress,me),appProperties,capabilities(canEdit,canTrash,canAddChildren))")
		if pageToken != "" {
			params.Set("pageToken", pageToken)
		}
		var resp struct {
			NextPageToken string      `json:"nextPageToken"`
			Files         []driveFile `json:"files"`
		}
		if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &resp); err != nil {
			return nil, err
		}
		all = append(all, resp.Files...)
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return all, nil
}

func (c *GoogleDriveClient) ListTree(ctx context.Context, rootFolderID string) ([]RemoteEntry, bool, error) {
	rootMetaURL := fmt.Sprintf("%s/files/%s?supportsAllDrives=true&fields=id,name,capabilities(canAddChildren,canEdit)", c.apiBaseURL, url.PathEscape(rootFolderID))
	var rootMeta driveFile
	if err := c.doJSON(ctx, http.MethodGet, rootMetaURL, nil, &rootMeta); err != nil {
		return nil, false, err
	}
	rootCanWrite := rootMeta.Capabilities.CanAddChildren || rootMeta.Capabilities.CanEdit

	type queueNode struct {
		id     string
		prefix string
	}
	visited := map[string]bool{rootFolderID: true}
	queue := []queueNode{{id: rootFolderID, prefix: ""}}
	var entries []RemoteEntry

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		children, err := c.listChildren(ctx, curr.id)
		if err != nil {
			return nil, rootCanWrite, err
		}
		for _, ch := range children {
			if ch.Name == config.ControlDirName || ch.Name == config.QuarantineDirName {
				continue
			}
			relPath := ch.Name
			if curr.prefix != "" {
				relPath = curr.prefix + "/" + ch.Name
			}

			if ch.MimeType == folderMimeType {
				if !visited[ch.ID] {
					visited[ch.ID] = true
					queue = append(queue, queueNode{id: ch.ID, prefix: relPath})
				}
				continue
			}
			// Pula Google Docs nativos sem tamanho binário exportado (equivalente a --drive-skip-gdocs)
			if strings.HasPrefix(ch.MimeType, gdocPrefix) {
				continue
			}

			sz, _ := strconv.ParseInt(ch.Size, 10, 64)
			modT, _ := time.Parse(time.RFC3339Nano, ch.ModifiedTime)
			authorEmail, authorName := resolveAuthor(ch)

			entries = append(entries, RemoteEntry{
				ID:           ch.ID,
				Name:         ch.Name,
				RelativePath: relPath,
				ParentID:     curr.id,
				MimeType:     ch.MimeType,
				IsDir:        false,
				Size:         sz,
				MD5:          strings.ToLower(ch.MD5Checksum),
				ModTime:      modT,
				AuthorEmail:  authorEmail,
				AuthorName:   authorName,
				CanEdit:      ch.Capabilities.CanEdit,
				CanTrash:     ch.Capabilities.CanTrash,
			})
		}
	}

	return entries, rootCanWrite, nil
}

func (c *GoogleDriveClient) DownloadFile(ctx context.Context, fileID string, destPath string, expectedSize int64, progress ProgressFunc) (string, error) {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return "", err
	}

	u := fmt.Sprintf("%s/files/%s?alt=media&supportsAllDrives=true", c.apiBaseURL, url.PathEscape(fileID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("download HTTP %d: %s", resp.StatusCode, string(b))
	}

	partPath := destPath + ".drivesync.part"
	fh, err := os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return "", err
	}
	cleanupPart := true
	defer func() {
		_ = fh.Close()
		if cleanupPart {
			_ = os.Remove(partPath)
		}
	}()

	hasher := md5.New()
	total := expectedSize
	if total <= 0 && resp.ContentLength > 0 {
		total = resp.ContentLength
	}

	buf := make([]byte, 256*1024)
	var written int64
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := fh.Write(buf[:n]); err != nil {
				return "", err
			}
			_, _ = hasher.Write(buf[:n])
			written += int64(n)
			if progress != nil {
				progress(written, total)
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}

	if err := fh.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(partPath, destPath); err != nil {
		return "", err
	}
	cleanupPart = false
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (c *GoogleDriveClient) UploadFile(
	ctx context.Context,
	localPath string,
	remoteName string,
	parentID string,
	existingFileID string,
	senderEmail string,
	senderName string,
	deviceID string,
	maxBytes int64,
	progress ProgressFunc,
) (RemoteEntry, error) {
	if maxBytes <= 0 || maxBytes > config.MaxUploadBytes {
		maxBytes = config.MaxUploadBytes
	}

	fh, err := os.Open(localPath)
	if err != nil {
		return RemoteEntry{}, err
	}
	defer fh.Close()

	st, err := fh.Stat()
	if err != nil {
		return RemoteEntry{}, err
	}
	size := st.Size()
	if size > maxBytes {
		return RemoteEntry{}, fmt.Errorf("%w (%d bytes > %d bytes)", ErrExceedsMaxUpload, size, maxBytes)
	}

	meta := map[string]any{
		"name": remoteName,
		"appProperties": map[string]string{
			"ds_sender_email": config.NormalizeEmail(senderEmail),
			"ds_sender_name":  senderName,
			"ds_device_id":    deviceID,
		},
	}
	if existingFileID == "" {
		meta["parents"] = []string{parentID}
	}

	if size <= 4*1024*1024 {
		return c.uploadMultipart(ctx, fh, size, meta, existingFileID, progress)
	}
	return c.uploadResumable(ctx, fh, size, meta, existingFileID, maxBytes, progress)
}

func (c *GoogleDriveClient) uploadMultipart(
	ctx context.Context,
	fh *os.File,
	size int64,
	meta map[string]any,
	existingFileID string,
	progress ProgressFunc,
) (RemoteEntry, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)

	metaHeader := make(textproto.MIMEHeader)
	metaHeader.Set("Content-Type", "application/json; charset=UTF-8")
	part1, err := mw.CreatePart(metaHeader)
	if err != nil {
		return RemoteEntry{}, err
	}
	if err := json.NewEncoder(part1).Encode(meta); err != nil {
		return RemoteEntry{}, err
	}

	mediaHeader := make(textproto.MIMEHeader)
	mediaHeader.Set("Content-Type", "application/octet-stream")
	part2, err := mw.CreatePart(mediaHeader)
	if err != nil {
		return RemoteEntry{}, err
	}
	if _, err := io.Copy(part2, fh); err != nil {
		return RemoteEntry{}, err
	}
	if err := mw.Close(); err != nil {
		return RemoteEntry{}, err
	}

	method := http.MethodPost
	u := c.uploadURL + "/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,owners,lastModifyingUser,appProperties"
	if existingFileID != "" {
		method = http.MethodPatch
		u = fmt.Sprintf("%s/files/%s?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,owners,lastModifyingUser,appProperties", c.uploadURL, url.PathEscape(existingFileID))
	}

	req, err := http.NewRequestWithContext(ctx, method, u, &body)
	if err != nil {
		return RemoteEntry{}, err
	}
	req.Header.Set("Content-Type", "multipart/related; boundary="+mw.Boundary())
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return RemoteEntry{}, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusForbidden {
		return RemoteEntry{}, fmt.Errorf("%w: %s", ErrInsufficientAccess, string(respBytes))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RemoteEntry{}, fmt.Errorf("upload multipart HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	var f driveFile
	if err := json.Unmarshal(respBytes, &f); err != nil {
		return RemoteEntry{}, err
	}
	if progress != nil {
		progress(size, size)
	}
	return driveFileToEntry(f), nil
}

func (c *GoogleDriveClient) uploadResumable(
	ctx context.Context,
	fh *os.File,
	size int64,
	meta map[string]any,
	existingFileID string,
	maxBytes int64,
	progress ProgressFunc,
) (RemoteEntry, error) {
	metaRaw, err := json.Marshal(meta)
	if err != nil {
		return RemoteEntry{}, err
	}

	method := http.MethodPost
	initURL := c.uploadURL + "/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,owners,lastModifyingUser,appProperties"
	if existingFileID != "" {
		method = http.MethodPatch
		initURL = fmt.Sprintf("%s/files/%s?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,owners,lastModifyingUser,appProperties", c.uploadURL, url.PathEscape(existingFileID))
	}

	initReq, err := http.NewRequestWithContext(ctx, method, initURL, bytes.NewReader(metaRaw))
	if err != nil {
		return RemoteEntry{}, err
	}
	initReq.Header.Set("Content-Type", "application/json; charset=UTF-8")
	initReq.Header.Set("X-Upload-Content-Type", "application/octet-stream")
	initReq.Header.Set("X-Upload-Content-Length", strconv.FormatInt(size, 10))

	initResp, err := c.httpClient.Do(initReq)
	if err != nil {
		return RemoteEntry{}, err
	}
	_ = initResp.Body.Close()
	if initResp.StatusCode == http.StatusForbidden {
		return RemoteEntry{}, ErrInsufficientAccess
	}
	if initResp.StatusCode < 200 || initResp.StatusCode >= 300 {
		return RemoteEntry{}, fmt.Errorf("iniciar upload resumível HTTP %d", initResp.StatusCode)
	}
	sessionURI := initResp.Header.Get("Location")
	if sessionURI == "" {
		return RemoteEntry{}, errors.New("Google Drive não retornou Location de sessão resumível")
	}

	buf := make([]byte, uploadChunkSz)
	var offset int64
	for offset < size {
		if offset > maxBytes {
			return RemoteEntry{}, ErrExceedsMaxUpload
		}
		toRead := uploadChunkSz
		if rem := size - offset; rem < int64(toRead) {
			toRead = int(rem)
		}
		n, readErr := io.ReadFull(fh, buf[:toRead])
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return RemoteEntry{}, readErr
		}
		if offset+int64(n) > maxBytes {
			return RemoteEntry{}, ErrExceedsMaxUpload
		}

		end := offset + int64(n) - 1
		chunkReq, err := http.NewRequestWithContext(ctx, http.MethodPut, sessionURI, bytes.NewReader(buf[:n]))
		if err != nil {
			return RemoteEntry{}, err
		}
		chunkReq.ContentLength = int64(n)
		chunkReq.Header.Set("Content-Type", "application/octet-stream")
		chunkReq.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, end, size))

		chunkResp, err := c.httpClient.Do(chunkReq)
		if err != nil {
			return RemoteEntry{}, err
		}
		respBytes, _ := io.ReadAll(chunkResp.Body)
		_ = chunkResp.Body.Close()

		offset += int64(n)
		if progress != nil {
			progress(offset, size)
		}

		if chunkResp.StatusCode == 308 {
			continue
		}
		if chunkResp.StatusCode >= 200 && chunkResp.StatusCode < 300 {
			var f driveFile
			if err := json.Unmarshal(respBytes, &f); err != nil {
				return RemoteEntry{}, err
			}
			return driveFileToEntry(f), nil
		}
		return RemoteEntry{}, fmt.Errorf("chunk upload HTTP %d: %s", chunkResp.StatusCode, string(respBytes))
	}

	return RemoteEntry{}, errors.New("upload resumível terminou sem resposta final do servidor")
}

func driveFileToEntry(f driveFile) RemoteEntry {
	sz, _ := strconv.ParseInt(f.Size, 10, 64)
	modT, _ := time.Parse(time.RFC3339Nano, f.ModifiedTime)
	authorEmail, authorName := resolveAuthor(f)
	var parentID string
	if len(f.Parents) > 0 {
		parentID = f.Parents[0]
	}
	return RemoteEntry{
		ID:           f.ID,
		Name:         f.Name,
		ParentID:     parentID,
		MimeType:     f.MimeType,
		Size:         sz,
		MD5:          strings.ToLower(f.MD5Checksum),
		ModTime:      modT,
		AuthorEmail:  authorEmail,
		AuthorName:   authorName,
		CanEdit:      f.Capabilities.CanEdit,
		CanTrash:     f.Capabilities.CanTrash,
	}
}

func (c *GoogleDriveClient) TrashFile(ctx context.Context, fileID string) error {
	u := fmt.Sprintf("%s/files/%s?supportsAllDrives=true", c.apiBaseURL, url.PathEscape(fileID))
	return c.doJSON(ctx, http.MethodPatch, u, map[string]bool{"trashed": true}, nil)
}

func (c *GoogleDriveClient) WriteControlJSON(ctx context.Context, rootFolderID string, fileName string, payload []byte) error {
	devicesFolderID, err := c.EnsurePath(ctx, rootFolderID, config.ControlDirName+"/devices")
	if err != nil {
		return err
	}
	return c.upsertJSONInParent(ctx, devicesFolderID, fileName, payload)
}

func (c *GoogleDriveClient) WriteFolderProfileJSON(ctx context.Context, rootFolderID string, payload []byte) error {
	ctrlFolderID, err := c.EnsurePath(ctx, rootFolderID, config.ControlDirName)
	if err != nil {
		return err
	}
	return c.upsertJSONInParent(ctx, ctrlFolderID, "folder-config.json", payload)
}

func (c *GoogleDriveClient) upsertJSONInParent(ctx context.Context, parentID string, fileName string, payload []byte) error {
	params := url.Values{}
	params.Set("q", fmt.Sprintf("'%s' in parents and name = '%s' and trashed = false",
		escapeQueryLiteral(parentID), escapeQueryLiteral(fileName)))
	params.Set("pageSize", "1")
	params.Set("supportsAllDrives", "true")
	params.Set("includeItemsFromAllDrives", "true")
	params.Set("fields", "files(id)")

	var listResp struct {
		Files []driveFile `json:"files"`
	}
	if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &listResp); err != nil {
		return err
	}

	tmp, err := os.CreateTemp("", "ds-ctrl-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		return err
	}
	_ = tmp.Close()

	existingID := ""
	if len(listResp.Files) > 0 {
		existingID = listResp.Files[0].ID
	}
	_, err = c.UploadFile(ctx, tmpPath, fileName, parentID, existingID, "", "", "", config.MaxUploadBytes, nil)
	return err
}

func (c *GoogleDriveClient) downloadSmallControlFile(ctx context.Context, fileID string) ([]byte, bool) {
	u := fmt.Sprintf("%s/files/%s?alt=media&supportsAllDrives=true", c.apiBaseURL, url.PathEscape(fileID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, false
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false
	}
	b, readErr := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if readErr != nil {
		return nil, false
	}
	return b, true
}

func (c *GoogleDriveClient) ListControlJSONs(ctx context.Context, rootFolderID string) (map[string][]byte, error) {
	ctrlID, ok, err := c.findChildFolder(ctx, rootFolderID, config.ControlDirName)
	if err != nil || !ok {
		return nil, err
	}
	devID, ok, err := c.findChildFolder(ctx, ctrlID, "devices")
	if err != nil || !ok {
		return nil, err
	}
	children, err := c.listChildren(ctx, devID)
	if err != nil {
		return nil, err
	}
	out := make(map[string][]byte, len(children))
	for _, ch := range children {
		if !strings.HasSuffix(ch.Name, ".json") {
			continue
		}
		if b, ok := c.downloadSmallControlFile(ctx, ch.ID); ok {
			out[ch.Name] = b
		}
	}
	return out, nil
}

func (c *GoogleDriveClient) DiscoverDriveSyncFolders(ctx context.Context) ([]config.DiscoveredRemoteFolder, error) {
	queries := []string{
		fmt.Sprintf("name = '%s' and mimeType = '%s' and trashed = false", escapeQueryLiteral(config.ControlDirName), folderMimeType),
		fmt.Sprintf("mimeType = '%s' and trashed = false and properties has { key='ds_folder_kind' and value='master' }", folderMimeType),
		fmt.Sprintf("mimeType = '%s' and trashed = false and properties has { key='ds_folder_kind' and value='personal' }", folderMimeType),
	}

	rootIDs := make(map[string]struct{})
	for i, q := range queries {
		params := url.Values{}
		params.Set("q", q)
		params.Set("pageSize", "100")
		params.Set("supportsAllDrives", "true")
		params.Set("includeItemsFromAllDrives", "true")
		params.Set("fields", "files(id,parents)")
		var resp struct {
			Files []driveFile `json:"files"`
		}
		if err := c.doJSON(ctx, http.MethodGet, c.apiBaseURL+"/files?"+params.Encode(), nil, &resp); err != nil {
			continue
		}
		for _, f := range resp.Files {
			if i == 0 {
				for _, p := range f.Parents {
					if p != "" {
						rootIDs[p] = struct{}{}
					}
				}
			} else if f.ID != "" {
				rootIDs[f.ID] = struct{}{}
			}
		}
	}

	out := make([]config.DiscoveredRemoteFolder, 0, len(rootIDs))
	for rootID := range rootIDs {
		meta, err := c.GetFolderMeta(ctx, rootID)
		if err != nil {
			continue
		}
		item := config.DiscoveredRemoteFolder{
			RemoteFolderID:   meta.ID,
			RemoteFolderName: meta.Name,
			Kind:             meta.Kind,
			ShortCode:        meta.JoinCode,
			OwnerEmail:       meta.OwnerEmail,
			OwnerName:        meta.OwnerName,
			CanWrite:         meta.CanWrite,
			OnRemoteDelete:   config.RemoteDeleteKeepLocal,
			OnLocalDelete:    config.LocalDeleteIgnore,
			Direction:        config.DirectionBidirectional,
		}
		if !meta.CanWrite {
			item.Direction = config.DirectionReceiveOnly
		}

		if ctrlID, ok, _ := c.findChildFolder(ctx, rootID, config.ControlDirName); ok {
			if children, listErr := c.listChildren(ctx, ctrlID); listErr == nil {
				for _, ch := range children {
					if ch.Name == "folder-config.json" {
						if b, ok := c.downloadSmallControlFile(ctx, ch.ID); ok {
							var prof config.DiscoveredRemoteFolder
							if json.Unmarshal(b, &prof) == nil {
								if prof.Kind != "" {
									item.Kind = prof.Kind
								}
								if prof.RemoteFolderName != "" {
									item.RemoteFolderName = prof.RemoteFolderName
								}
								if prof.ShortCode != "" && item.ShortCode == "" {
									item.ShortCode = prof.ShortCode
								}
								if prof.OnRemoteDelete != "" {
									item.OnRemoteDelete = prof.OnRemoteDelete
								}
								if prof.OnLocalDelete != "" {
									item.OnLocalDelete = prof.OnLocalDelete
								}
								if prof.SenderPolicy != nil {
									item.SenderPolicy = prof.SenderPolicy
								}
							}
						}
					}
				}
			}
		}

		if rawDevs, _ := c.ListControlJSONs(ctx, rootID); len(rawDevs) > 0 {
			seenNames := make(map[string]struct{})
			for _, b := range rawDevs {
				var dev config.DeviceRegistration
				if json.Unmarshal(b, &dev) == nil && dev.DeviceID != "" {
					item.Devices = append(item.Devices, dev)
					if dev.DeviceName != "" {
						seenNames[dev.DeviceName] = struct{}{}
					}
				}
			}
			for name := range seenNames {
				item.DeviceNames = append(item.DeviceNames, name)
			}
			sort.Strings(item.DeviceNames)
		}
		if item.DeviceNames == nil {
			item.DeviceNames = []string{}
		}
		out = append(out, item)
	}

	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].RemoteFolderName) < strings.ToLower(out[j].RemoteFolderName)
	})
	return out, nil
}

func escapeQueryLiteral(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `\'`)
	return s
}

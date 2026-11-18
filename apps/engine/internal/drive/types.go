package drive

import (
	"context"
	"errors"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
)

var (
	ErrNotAuthenticated   = errors.New("conta Google Drive não conectada")
	ErrExceedsMaxUpload   = errors.New("arquivo ultrapassa o limite máximo de 4 GB por upload")
	ErrInsufficientAccess = errors.New("sem permissão de escrita nesta pasta do Drive")
	ErrNotFound           = errors.New("pasta ou arquivo não encontrado no Google Drive (ou sem compartilhamento para esta conta)")
	ErrOAuthClientMissing = errors.New("credenciais OAuth do Google não configuradas")
)

type RemoteEntry struct {
	ID           string
	Name         string
	RelativePath string
	ParentID     string
	MimeType     string
	IsDir        bool
	Size         int64
	MD5          string
	ModTime      time.Time
	AuthorEmail  string
	AuthorName   string
	CanEdit      bool
	CanTrash     bool
}

type ProgressFunc func(transferred int64, total int64)

type FolderMeta struct {
	ID         string
	Name       string
	Kind       config.FolderKind
	JoinCode   string
	OwnerEmail string
	OwnerName  string
	CanWrite   bool
}

type API interface {
	AboutUser(ctx context.Context) (email string, displayName string, err error)
	ListFolders(ctx context.Context, parentID string, sharedWithMe bool) ([]config.RemoteFolderItem, error)
	CreateFolder(ctx context.Context, name string, parentID string) (config.RemoteFolderItem, error)
	GetFolderMeta(ctx context.Context, folderID string) (FolderMeta, error)
	EnsureFolderKindMetadata(ctx context.Context, folderID string, kind config.FolderKind, folderName string) error
	SetFolderInviteMetadata(ctx context.Context, folderID string, shortCode string, kind config.FolderKind, folderName string) error
	FindFolderByJoinCode(ctx context.Context, shortCode string) (FolderMeta, bool, error)
	ShareFolder(ctx context.Context, folderID string, in config.SharePermissionInput) error
	EnsurePath(ctx context.Context, rootFolderID string, relDir string) (folderID string, err error)
	ListTree(ctx context.Context, rootFolderID string) (entries []RemoteEntry, rootCanWrite bool, err error)
	DownloadFile(ctx context.Context, fileID string, destPath string, expectedSize int64, progress ProgressFunc) (md5Hex string, err error)
	UploadFile(ctx context.Context, localPath string, remoteName string, parentID string, existingFileID string, senderEmail string, senderName string, deviceID string, maxBytes int64, progress ProgressFunc) (RemoteEntry, error)
	TrashFile(ctx context.Context, fileID string) error
	WriteControlJSON(ctx context.Context, rootFolderID string, fileName string, payload []byte) error
	ListControlJSONs(ctx context.Context, rootFolderID string) (map[string][]byte, error)
	WriteFolderProfileJSON(ctx context.Context, rootFolderID string, payload []byte) error
	DiscoverDriveSyncFolders(ctx context.Context) ([]config.DiscoveredRemoteFolder, error)
}

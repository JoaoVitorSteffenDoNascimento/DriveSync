package config

import "strings"

const (
	// MaxUploadBytes é o limite rígido de 4 GiB (4.294.967.296 bytes) por arquivo enviado.
	MaxUploadBytes int64 = 4 * 1024 * 1024 * 1024

	ControlDirName    = ".drivesync"
	QuarantineDirName = ".DriveSync-Quarentena"
	AppVersion        = "0.2.0"
)

type FolderKind string

const (
	FolderKindPersonal FolderKind = "personal"
	FolderKindMaster   FolderKind = "master"
)

type SyncDirection string

const (
	DirectionBidirectional SyncDirection = "bidirectional"
	DirectionReceiveOnly   SyncDirection = "receive_only"
)

type RemoteDeletePolicy string

const (
	RemoteDeleteKeepLocal   RemoteDeletePolicy = "keep_local"
	RemoteDeleteMirrorTrash RemoteDeletePolicy = "mirror_trash"
)

type LocalDeletePolicy string

const (
	LocalDeleteIgnore      LocalDeletePolicy = "ignore"
	LocalDeleteTrashRemote LocalDeletePolicy = "trash_remote"
)

type SenderPolicyMode string

const (
	SenderModeAll       SenderPolicyMode = "all"
	SenderModeBlocklist SenderPolicyMode = "blocklist"
	SenderModeAllowlist SenderPolicyMode = "allowlist"
)

type SenderRule struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName,omitempty"`
	Allowed     bool   `json:"allowed"`
}

type SenderPolicy struct {
	Mode                SenderPolicyMode `json:"mode"`
	UnknownSenderAction string           `json:"unknownSenderAction"` // "allow" | "block"
	Rules               []SenderRule     `json:"rules"`
}

type KnownSender struct {
	FolderID    string `json:"folderId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	LastSeenAt  string `json:"lastSeenAt"`
}

type SyncFolderConfig struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	LocalPath        string             `json:"localPath"`
	RemoteFolderID   string             `json:"remoteFolderId"`
	RemoteFolderName string             `json:"remoteFolderName"`
	Kind             FolderKind         `json:"kind"`
	Direction        SyncDirection      `json:"direction"`
	OnRemoteDelete   RemoteDeletePolicy `json:"onRemoteDelete"`
	OnLocalDelete    LocalDeletePolicy  `json:"onLocalDelete"`
	SenderPolicy     SenderPolicy       `json:"senderPolicy"`
	Paused           bool               `json:"paused"`
	ShareCode        string             `json:"shareCode,omitempty"`
	CreatedAt        string             `json:"createdAt"`
}

type FolderInviteInfo struct {
	FolderID   string     `json:"folderId"`
	FolderName string     `json:"folderName"`
	ShortCode  string     `json:"shortCode"`
	FullCode   string     `json:"fullCode"`
	DriveURL   string     `json:"driveUrl"`
	Kind       FolderKind `json:"kind"`
}

type ResolvedFolderCode struct {
	RemoteFolderID   string     `json:"remoteFolderId"`
	RemoteFolderName string     `json:"remoteFolderName"`
	ShortCode        string     `json:"shortCode,omitempty"`
	Kind             FolderKind `json:"kind"`
	OwnerEmail       string     `json:"ownerEmail,omitempty"`
	OwnerName        string     `json:"ownerName,omitempty"`
	CanWrite         bool       `json:"canWrite"`
	MatchedBy        string     `json:"matchedBy"` // full_code | drive_link | short_code
}

type SharePermissionInput struct {
	AccessType string `json:"accessType"` // "user" | "anyone"
	Role       string `json:"role"`       // "reader" | "writer"
	Email      string `json:"email,omitempty"`
}

type FolderContentItem struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	IsDir        bool   `json:"isDir"`
	SizeBytes    int64  `json:"sizeBytes"`
	ModifiedAt   string `json:"modifiedAt"`
	Exceeds4GB   bool   `json:"exceeds4gb"`
}

type FolderContentsResponse struct {
	FolderID   string              `json:"folderId"`
	FolderName string              `json:"folderName"`
	LocalPath  string              `json:"localPath"`
	Subpath    string              `json:"subpath"`
	Items      []FolderContentItem `json:"items"`
}

type ImportPathsResult struct {
	AddedCount     int      `json:"addedCount"`
	SkippedOver4GB []string `json:"skippedOver4GB"`
	Errors         []string `json:"errors"`
}

type CreateFolderInput struct {
	Name             string             `json:"name"`
	LocalPath        string             `json:"localPath"`
	RemoteFolderID   string             `json:"remoteFolderId"`
	RemoteFolderName string             `json:"remoteFolderName"`
	Kind             FolderKind         `json:"kind"`
	Direction        SyncDirection      `json:"direction"`
	OnRemoteDelete   RemoteDeletePolicy `json:"onRemoteDelete"`
	OnLocalDelete    LocalDeletePolicy  `json:"onLocalDelete"`
	SenderPolicy     SenderPolicy       `json:"senderPolicy"`
}

type FolderRuntimeState struct {
	FolderID           string  `json:"folderId"`
	Status             string  `json:"status"` // idle | syncing | ok | warning | error | paused
	Message            string  `json:"message"`
	LastSyncAt         string  `json:"lastSyncAt,omitempty"`
	CurrentFile        string  `json:"currentFile,omitempty"`
	ProgressPercent    float64 `json:"progressPercent,omitempty"`
	BytesTransferred   int64   `json:"bytesTransferred,omitempty"`
	BytesTotal         int64   `json:"bytesTotal,omitempty"`
	Blocked4GBCount    int     `json:"blocked4gbCount"`
	IgnoredSenderCount int     `json:"ignoredSenderCount"`
	KeptLocalCount     int     `json:"keptLocalCount"`
	SyncedFilesCount   int     `json:"syncedFilesCount"`
}

type DeviceRegistration struct {
	DeviceID        string        `json:"deviceId"`
	DeviceName      string        `json:"deviceName"`
	Platform        string        `json:"platform"`
	Arch            string        `json:"arch"`
	AppVersion      string        `json:"appVersion"`
	AccountEmail    string        `json:"accountEmail"`
	SyncMode        SyncDirection `json:"syncMode"`
	FolderID        string        `json:"folderId"`
	Status          string        `json:"status"` // online | syncing | paused | readonly
	LastSeenAt      string        `json:"lastSeenAt"`
	IsCurrentDevice bool          `json:"isCurrentDevice,omitempty"`
}

type AccountInfo struct {
	Connected            bool   `json:"connected"`
	Email                string `json:"email"`
	DisplayName          string `json:"displayName"`
	AuthSource           string `json:"authSource"` // oauth_pkce | rclone_import | none
	HasCustomOAuthClient bool   `json:"hasCustomOAuthClient"`
}

type AppSettings struct {
	DeviceID               string             `json:"deviceId"`
	DeviceName             string             `json:"deviceName"`
	MaxUploadBytes         int64              `json:"maxUploadBytes"`
	PollIntervalSeconds    int                `json:"pollIntervalSeconds"`
	StartOnBoot            bool               `json:"startOnBoot"`
	MinimizeToTray         bool               `json:"minimizeToTray"`
	EnableWaybarBridge     bool               `json:"enableWaybarBridge"`
	DefaultOnRemoteDelete  RemoteDeletePolicy `json:"defaultOnRemoteDelete"`
	SyncRootPath           string             `json:"syncRootPath,omitempty"`
	AutoSyncAccountFolders bool               `json:"autoSyncAccountFolders"`
}

type BlockedFileEntry struct {
	ID            int64  `json:"id"`
	FolderID      string `json:"folderId"`
	FolderName    string `json:"folderName"`
	RelativePath  string `json:"relativePath"`
	LocalPath     string `json:"localPath,omitempty"`
	FileSizeBytes int64  `json:"fileSizeBytes"`
	AuthorEmail   string `json:"authorEmail,omitempty"`
	AuthorName    string `json:"authorName,omitempty"`
	Reason        string `json:"reason"` // exceeds_4gb | sender_blocked | ignore_pattern
	Detail        string `json:"detail"`
	DetectedAt    string `json:"detectedAt"`
}

type ActivityEvent struct {
	ID            int64  `json:"id"`
	FolderID      string `json:"folderId"`
	FolderName    string `json:"folderName"`
	Kind          string `json:"kind"`
	Level         string `json:"level"`
	Message       string `json:"message"`
	RelativePath  string `json:"relativePath,omitempty"`
	AuthorEmail   string `json:"authorEmail,omitempty"`
	FileSizeBytes int64  `json:"fileSizeBytes,omitempty"`
	CreatedAt     string `json:"createdAt"`
}

type RemoteFolderItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Shared     bool   `json:"shared"`
	OwnerEmail string `json:"ownerEmail,omitempty"`
	OwnerName  string `json:"ownerName,omitempty"`
	CanWrite   bool   `json:"canWrite"`
}

type DiscoveredRemoteFolder struct {
	RemoteFolderID   string               `json:"remoteFolderId"`
	RemoteFolderName string               `json:"remoteFolderName"`
	Kind             FolderKind           `json:"kind"`
	ShortCode        string               `json:"shortCode,omitempty"`
	OwnerEmail       string               `json:"ownerEmail,omitempty"`
	OwnerName        string               `json:"ownerName,omitempty"`
	CanWrite         bool                 `json:"canWrite"`
	DeviceNames      []string             `json:"deviceNames"`
	Devices          []DeviceRegistration `json:"devices,omitempty"`
	OnRemoteDelete   RemoteDeletePolicy   `json:"onRemoteDelete"`
	OnLocalDelete    LocalDeletePolicy    `json:"onLocalDelete"`
	Direction        SyncDirection        `json:"direction"`
	SenderPolicy     *SenderPolicy        `json:"senderPolicy,omitempty"`
}

type DaemonSnapshot struct {
	Account           AccountInfo                   `json:"account"`
	Settings          AppSettings                   `json:"settings"`
	Folders           []SyncFolderConfig            `json:"folders"`
	Runtime           map[string]FolderRuntimeState `json:"runtime"`
	Devices           []DeviceRegistration          `json:"devices"`
	KnownSenders      []KnownSender                 `json:"knownSenders"`
	BlockedFiles      []BlockedFileEntry            `json:"blockedFiles"`
	RecentActivity    []ActivityEvent               `json:"recentActivity"`
	DiscoveredFolders []DiscoveredRemoteFolder      `json:"discoveredFolders,omitempty"`
}

func NormalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

// IsSenderAllowed avalia se um arquivo enviado por senderEmail deve ser baixado neste dispositivo.
func IsSenderAllowed(senderEmail string, policy SenderPolicy) bool {
	norm := NormalizeEmail(senderEmail)
	if norm == "" {
		return policy.UnknownSenderAction == "allow"
	}

	switch policy.Mode {
	case SenderModeAll, "":
		return true
	case SenderModeBlocklist:
		for _, r := range policy.Rules {
			if NormalizeEmail(r.Email) == norm {
				return r.Allowed
			}
		}
		return true
	case SenderModeAllowlist:
		for _, r := range policy.Rules {
			if NormalizeEmail(r.Email) == norm {
				return r.Allowed
			}
		}
		return false
	default:
		return true
	}
}

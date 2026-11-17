package presence

import (
	"context"
	"encoding/json"
	"errors"
	"runtime"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
)

type Manager struct {
	store *db.Store
	drive drive.API
}

func NewManager(store *db.Store, driveAPI drive.API) *Manager {
	return &Manager{
		store: store,
		drive: driveAPI,
	}
}

func (m *Manager) SyncFolderDevices(ctx context.Context, folder config.SyncFolderConfig, settings config.AppSettings, account config.AccountInfo, folderStatus string) error {
	if !account.Connected || m.drive == nil {
		return nil
	}

	selfStatus := "online"
	if folder.Paused {
		selfStatus = "paused"
	} else if folderStatus == "syncing" {
		selfStatus = "syncing"
	} else if folder.Direction == config.DirectionReceiveOnly {
		selfStatus = "readonly"
	}

	selfDev := config.DeviceRegistration{
		DeviceID:        settings.DeviceID,
		DeviceName:      settings.DeviceName,
		Platform:        runtime.GOOS,
		Arch:            runtime.GOARCH,
		AppVersion:      config.AppVersion,
		AccountEmail:    account.Email,
		SyncMode:        folder.Direction,
		FolderID:        folder.ID,
		Status:          selfStatus,
		LastSeenAt:      time.Now().Format(time.RFC3339),
		IsCurrentDevice: true,
	}

	// Sempre grava localmente primeiro (mesmo se a pasta Drive for somente leitura)
	_ = m.store.UpsertDevice(selfDev)

	payload, err := json.MarshalIndent(selfDev, "", "  ")
	if err == nil {
		writeErr := m.drive.WriteControlJSON(ctx, folder.RemoteFolderID, settings.DeviceID+".json", payload)
		if writeErr != nil && !errors.Is(writeErr, drive.ErrInsufficientAccess) {
			// Ignora sem falhar o sync se não tiver permissão de escrita na pasta Master
			_ = writeErr
		}
	}

	remoteFiles, err := m.drive.ListControlJSONs(ctx, folder.RemoteFolderID)
	if err != nil {
		return nil
	}
	for _, raw := range remoteFiles {
		var peer config.DeviceRegistration
		if err := json.Unmarshal(raw, &peer); err != nil || peer.DeviceID == "" {
			continue
		}
		peer.FolderID = folder.ID
		peer.IsCurrentDevice = peer.DeviceID == settings.DeviceID
		_ = m.store.UpsertDevice(peer)
	}
	return nil
}

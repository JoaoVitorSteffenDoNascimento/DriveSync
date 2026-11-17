package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// DataDir retorna o diretório persistente de dados e configurações do DriveSync.
func DataDir() (string, error) {
	if override := os.Getenv("DRIVESYNC_DATA_DIR"); override != "" {
		if err := os.MkdirAll(override, 0o700); err != nil {
			return "", err
		}
		return override, nil
	}

	base, err := os.UserConfigDir()
	if err != nil {
		home, hErr := os.UserHomeDir()
		if hErr != nil {
			return "", hErr
		}
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, "DriveSync")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// StateDir retorna o diretório XDG/local de estado compatível com os scripts legados no Linux.
func StateDir() string {
	if v := os.Getenv("NUVEM_STATE_DIR"); v != "" {
		return v
	}
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	if runtime.GOOS == "windows" {
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			return filepath.Join(localAppData, "DriveSync", "state")
		}
	}
	return filepath.Join(home, ".local", "state")
}

func DefaultDeviceName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "Meu-Dispositivo"
	}
	switch runtime.GOOS {
	case "windows":
		return fmt.Sprintf("%s (Windows)", host)
	case "linux":
		return fmt.Sprintf("%s (Linux)", host)
	default:
		return fmt.Sprintf("%s (%s)", host, runtime.GOOS)
	}
}

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "id-fallback"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}

func DefaultSettings() AppSettings {
	return AppSettings{
		DeviceID:              NewID(),
		DeviceName:            DefaultDeviceName(),
		MaxUploadBytes:        MaxUploadBytes,
		PollIntervalSeconds:   45,
		StartOnBoot:           false,
		MinimizeToTray:        true,
		EnableWaybarBridge:    runtime.GOOS == "linux",
		DefaultOnRemoteDelete: RemoteDeleteKeepLocal,
	}
}

package legacy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
)

// WriteWaybarStatus grava nuvem-status.json em formato compatível com scripts/status-waybar.py.
func WriteWaybarStatus(enabled bool, status string, errorsCount int, message string, localDir string, remoteName string) {
	if !enabled || runtime.GOOS != "linux" {
		return
	}
	stateDir := config.StateDir()
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return
	}
	target := os.Getenv("NUVEM_STATUS_FILE")
	if target == "" {
		target = filepath.Join(stateDir, "nuvem-status.json")
	}

	payload := map[string]any{
		"timestamp": time.Now().Format(time.RFC3339),
		"status":    status,
		"errors":    errorsCount,
		"exit_code": 0,
		"message":   message,
		"local_dir": localDir,
		"remote":    remoteName,
		"dry_run":   false,
	}
	if errorsCount > 0 {
		payload["exit_code"] = 1
	}

	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return
	}
	raw = append(raw, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(target), ".status-*.tmp")
	if err != nil {
		return
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return
	}
	_ = tmp.Close()
	_ = os.Rename(tmpName, target)
}

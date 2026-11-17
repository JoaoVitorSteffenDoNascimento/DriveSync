package config

import (
	"path"
	"path/filepath"
	"strings"
)

var defaultIgnoredDirs = map[string]struct{}{
	"node_modules":        {},
	".git":                {},
	"venv":                {},
	".venv":               {},
	"__pycache__":         {},
	".pytest_cache":       {},
	".mypy_cache":         {},
	".ruff_cache":         {},
	"dist":                {},
	"build":               {},
	"target":              {},
	".next":               {},
	".nuxt":               {},
	".turbo":              {},
	".parcel-cache":       {},
	".image-build":        {},
	".addon-cache":        {},
	"cache":               {},
	"code cache":          {},
	"gpucache":            {},
	"cacheddata":          {},
	"cachedextensionvsixs": {},
	"service worker":               {},
	ControlDirName:                 {},
	".drivesync-quarentena":        {},
}

var defaultIgnoredGlobs = []string{
	"*.tmp",
	"*.swp",
	"*.swo",
	"*~",
	".ds_store",
	"thumbs.db",
	"desktop.ini",
	"*.part",
	"*.crdownload",
	"*.iso",
	"*.img",
	"*.qcow2",
	"*.vdi",
	"*.vmdk",
	"*.ova",
	"*.pkg.tar.zst",
	"*.deb",
	"*.appimage",
	"*.drivesync.part",
}

// ShouldIgnore verifica se um caminho relativo (com '/') deve ser ignorado pela sincronização.
func ShouldIgnore(relPath string) bool {
	slash := filepath.ToSlash(strings.TrimSpace(relPath))
	slash = strings.TrimPrefix(slash, "./")
	slash = strings.TrimPrefix(slash, "/")
	if slash == "" || slash == "." {
		return false
	}

	parts := strings.Split(slash, "/")
	for _, segment := range parts {
		lower := strings.ToLower(segment)
		if _, ok := defaultIgnoredDirs[lower]; ok {
			return true
		}
		if strings.HasPrefix(lower, ".trash-") {
			return true
		}
	}

	base := strings.ToLower(parts[len(parts)-1])
	for _, g := range defaultIgnoredGlobs {
		if matched, err := path.Match(g, base); err == nil && matched {
			return true
		}
	}
	return false
}

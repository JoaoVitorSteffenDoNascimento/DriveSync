package watcher

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/fsnotify/fsnotify"
)

// FolderWatcher observa recursivamente todas as pastas locais configuradas e dispara
// callback com trailing-edge debounce quando arquivos relevantes mudam.
type FolderWatcher struct {
	mu       sync.Mutex
	fw       *fsnotify.Watcher
	roots    map[string]string // folderID -> rootPath
	debounce time.Duration
	onChange func(folderID string)
}

func New(debounce time.Duration, onChange func(folderID string)) (*FolderWatcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if debounce <= 0 {
		debounce = 4 * time.Second
	}
	return &FolderWatcher{
		fw:       fw,
		roots:    make(map[string]string),
		debounce: debounce,
		onChange: onChange,
	}, nil
}

func (w *FolderWatcher) Close() error {
	if w == nil || w.fw == nil {
		return nil
	}
	return w.fw.Close()
}

func (w *FolderWatcher) SetFolders(folders []config.SyncFolderConfig) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, p := range w.fw.WatchList() {
		_ = w.fw.Remove(p)
	}
	w.roots = make(map[string]string)

	for _, f := range folders {
		if f.Paused || f.Direction == config.DirectionReceiveOnly {
			continue
		}
		info, err := os.Stat(f.LocalPath)
		if err != nil || !info.IsDir() {
			continue
		}
		cleanRoot := filepath.Clean(f.LocalPath)
		w.roots[f.ID] = cleanRoot
		_ = w.addTree(cleanRoot, cleanRoot)
	}
	return nil
}

func (w *FolderWatcher) addTree(root string, startDir string) error {
	return filepath.WalkDir(startDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr == nil && rel != "." && config.ShouldIgnore(rel) {
			return filepath.SkipDir
		}
		_ = w.fw.Add(p)
		return nil
	})
}

func (w *FolderWatcher) Run(ctx context.Context) {
	timers := make(map[string]*time.Timer)
	var timersMu sync.Mutex

	schedule := func(folderID string) {
		timersMu.Lock()
		defer timersMu.Unlock()
		if t, ok := timers[folderID]; ok {
			t.Reset(w.debounce)
			return
		}
		timers[folderID] = time.AfterFunc(w.debounce, func() {
			if w.onChange != nil {
				w.onChange(folderID)
			}
		})
	}

	for {
		select {
		case <-ctx.Done():
			timersMu.Lock()
			for _, t := range timers {
				t.Stop()
			}
			timersMu.Unlock()
			return

		case ev, ok := <-w.fw.Events:
			if !ok {
				return
			}
			w.mu.Lock()
			matchedID := ""
			matchedRoot := ""
			for id, root := range w.roots {
				if isInside(root, ev.Name) {
					matchedID = id
					matchedRoot = root
					break
				}
			}
			w.mu.Unlock()

			if matchedID == "" {
				continue
			}

			rel, err := filepath.Rel(matchedRoot, ev.Name)
			if err != nil || config.ShouldIgnore(rel) {
				continue
			}

			// Se uma nova subpasta foi criada, adiciona watcher recursivo nela também (essencial no Linux inotify)
			if ev.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
				if st, statErr := os.Stat(ev.Name); statErr == nil && st.IsDir() {
					_ = w.addTree(matchedRoot, ev.Name)
				}
			}

			if ev.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) != 0 {
				schedule(matchedID)
			}

		case _, ok := <-w.fw.Errors:
			if !ok {
				return
			}
		}
	}
}

func isInside(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return rel != ".." && !filepath.IsAbs(rel) && (len(rel) < 3 || rel[:3] != ".."+string(filepath.Separator))
}

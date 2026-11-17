package syncer

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
	"github.com/brendha/drivesync/engine/internal/legacy"
	"github.com/brendha/drivesync/engine/internal/presence"
)

const maxDeleteSafetyPercent = 15

type EventListener func(eventType string, payload any)

type Syncer struct {
	store    *db.Store
	drive    drive.API
	presence *presence.Manager

	mu           sync.Mutex
	folderLocks  map[string]*sync.Mutex
	runtimeState map[string]config.FolderRuntimeState
	listeners    []EventListener
}

func New(store *db.Store, driveAPI drive.API, listener EventListener) *Syncer {
	s := &Syncer{
		store:        store,
		drive:        driveAPI,
		presence:     presence.NewManager(store, driveAPI),
		folderLocks:  make(map[string]*sync.Mutex),
		runtimeState: make(map[string]config.FolderRuntimeState),
	}
	if listener != nil {
		s.listeners = append(s.listeners, listener)
	}
	return s
}

func (s *Syncer) SetDriveAPI(api drive.API) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.drive = api
	s.presence = presence.NewManager(s.store, api)
}

func (s *Syncer) getDriveAPI() drive.API {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.drive
}

func (s *Syncer) getFolderLock(folderID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lk, ok := s.folderLocks[folderID]
	if !ok {
		lk = &sync.Mutex{}
		s.folderLocks[folderID] = lk
	}
	return lk
}

func (s *Syncer) emit(eventType string, payload any) {
	s.mu.Lock()
	listeners := append([]EventListener(nil), s.listeners...)
	s.mu.Unlock()
	for _, fn := range listeners {
		fn(eventType, payload)
	}
}

func (s *Syncer) setRuntime(st config.FolderRuntimeState) {
	s.mu.Lock()
	s.runtimeState[st.FolderID] = st
	s.mu.Unlock()
	s.emit("folder_runtime", st)
}

func (s *Syncer) GetAllRuntime() map[string]config.FolderRuntimeState {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]config.FolderRuntimeState, len(s.runtimeState))
	for k, v := range s.runtimeState {
		out[k] = v
	}
	return out
}

type localFile struct {
	RelPath string
	AbsPath string
	Size    int64
	MtimeNs int64
}

func scanLocalFolder(root string) (map[string]localFile, error) {
	out := make(map[string]localFile)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == root {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		slash := filepath.ToSlash(rel)
		if config.ShouldIgnore(slash) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// Ignora symlinks para evitar loops/vazamento fora da pasta
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		out[slash] = localFile{
			RelPath: slash,
			AbsPath: p,
			Size:    info.Size(),
			MtimeNs: info.ModTime().UnixNano(),
		}
		return nil
	})
	return out, err
}

func fileMD5(absPath string) (string, error) {
	fh, err := os.Open(absPath)
	if err != nil {
		return "", err
	}
	defer fh.Close()
	h := md5.New()
	if _, err := io.Copy(h, fh); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (s *Syncer) SyncAll(ctx context.Context) {
	folders, err := s.store.ListFolders()
	if err != nil {
		return
	}
	for _, f := range folders {
		if ctx.Err() != nil {
			return
		}
		_ = s.SyncFolder(ctx, f.ID)
	}
}

func (s *Syncer) SyncFolder(ctx context.Context, folderID string) error {
	lk := s.getFolderLock(folderID)
	if !lk.TryLock() {
		return nil
	}
	defer lk.Unlock()

	folder, err := s.store.GetFolder(folderID)
	if err != nil {
		return err
	}
	settings, err := s.store.GetSettings()
	if err != nil {
		settings = config.DefaultSettings()
	}
	account, _ := s.store.GetAccount()
	driveAPI := s.getDriveAPI()

	if folder.Paused {
		syncedCnt, keptCnt, _ := s.store.CountSyncedStats(folder.ID)
		s.setRuntime(config.FolderRuntimeState{
			FolderID:         folder.ID,
			Status:           "paused",
			Message:          "Sincronização pausada pelo usuário.",
			SyncedFilesCount: syncedCnt,
			KeptLocalCount:   keptCnt,
		})
		return nil
	}

	if !account.Connected || driveAPI == nil {
		s.setRuntime(config.FolderRuntimeState{
			FolderID: folder.ID,
			Status:   "error",
			Message:  "Conecte uma conta Google Drive para sincronizar.",
		})
		return drive.ErrNotAuthenticated
	}

	if st, statErr := os.Stat(folder.LocalPath); statErr != nil || !st.IsDir() {
		msg := fmt.Sprintf("Pasta local não encontrada: %s", folder.LocalPath)
		s.setRuntime(config.FolderRuntimeState{
			FolderID: folder.ID,
			Status:   "error",
			Message:  msg,
		})
		return errors.New(msg)
	}

	s.setRuntime(config.FolderRuntimeState{
		FolderID: folder.ID,
		Status:   "syncing",
		Message:  "Verificando alterações...",
	})

	_ = s.presence.SyncFolderDevices(ctx, folder, settings, account, "syncing")

	remoteEntries, rootCanWrite, err := driveAPI.ListTree(ctx, folder.RemoteFolderID)
	if err != nil {
		msg := fmt.Sprintf("Erro ao listar pasta no Drive: %v", err)
		s.recordError(folder, msg, settings)
		return err
	}

	remoteMap := make(map[string]drive.RemoteEntry, len(remoteEntries))
	for _, re := range remoteEntries {
		if config.ShouldIgnore(re.RelativePath) {
			continue
		}
		if re.AuthorEmail != "" {
			_ = s.store.UpsertKnownSender(folder.ID, re.AuthorEmail, re.AuthorName)
		}
		if prev, exists := remoteMap[re.RelativePath]; !exists || re.ModTime.After(prev.ModTime) {
			remoteMap[re.RelativePath] = re
		}
	}

	localMap, err := scanLocalFolder(folder.LocalPath)
	if err != nil {
		msg := fmt.Sprintf("Erro ao escanear pasta local: %v", err)
		s.recordError(folder, msg, settings)
		return err
	}

	stateMap, err := s.store.GetSyncedFiles(folder.ID)
	if err != nil {
		msg := fmt.Sprintf("Erro ao ler banco local: %v", err)
		s.recordError(folder, msg, settings)
		return err
	}

	_ = s.store.ClearBlockedFilesForFolder(folder.ID)

	maxBytes := settings.MaxUploadBytes
	if maxBytes <= 0 || maxBytes > config.MaxUploadBytes {
		maxBytes = config.MaxUploadBytes
	}

	// Trava de segurança para exclusões em massa quando mirror_trash está ativo
	if folder.OnRemoteDelete == config.RemoteDeleteMirrorTrash {
		var toTrash []string
		activeSynced := 0
		for rel, st := range stateMap {
			if !st.DeletedOnRemote && !st.IgnoredLocalDelete {
				activeSynced++
				if _, existsRemote := remoteMap[rel]; !existsRemote {
					if _, existsLocal := localMap[rel]; existsLocal {
						toTrash = append(toTrash, rel)
					}
				}
			}
		}
		if activeSynced > 5 && len(toTrash) > 2 {
			pct := (len(toTrash) * 100) / activeSynced
			if pct > maxDeleteSafetyPercent {
				msg := fmt.Sprintf("Trava de segurança: %d%% dos arquivos (%d) sumiram do Drive. Exclusão local abortada.", pct, len(toTrash))
				_ = s.store.AddActivity(config.ActivityEvent{
					FolderID:   folder.ID,
					FolderName: folder.Name,
					Kind:       "sync_error",
					Level:      "warning",
					Message:    msg,
				})
				s.recordWarning(folder, msg, settings, 0, 0)
				return nil
			}
		}
	}

	// Uniao de caminhos
	allPaths := make(map[string]struct{})
	for p := range remoteMap {
		allPaths[p] = struct{}{}
	}
	for p := range localMap {
		allPaths[p] = struct{}{}
	}
	for p := range stateMap {
		allPaths[p] = struct{}{}
	}

	blocked4gb := 0
	ignoredSenders := 0
	hadErrors := 0
	var lastErr string

	for relPath := range allPaths {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		rem, hasRemote := remoteMap[relPath]
		loc, hasLocal := localMap[relPath]
		st, hasState := stateMap[relPath]

		switch {
		// 1) Somente no Drive
		case hasRemote && !hasLocal:
			// Se já tinha sido sincronizado antes e o usuário apagou localmente
			if hasState && !st.DeletedOnRemote {
				remoteChanged := (rem.MD5 != "" && rem.MD5 != st.RemoteMD5) || (rem.MD5 == "" && rem.ModTime.After(parseTime(st.RemoteModTime)))
				if folder.Direction == config.DirectionBidirectional && folder.OnLocalDelete == config.LocalDeleteTrashRemote && !remoteChanged {
					if err := driveAPI.TrashFile(ctx, rem.ID); err != nil {
						hadErrors++
						lastErr = err.Error()
						continue
					}
					_ = s.store.DeleteSyncedFile(folder.ID, relPath)
					_ = s.store.AddActivity(config.ActivityEvent{
						FolderID:     folder.ID,
						FolderName:   folder.Name,
						Kind:         "system",
						Level:        "info",
						RelativePath: relPath,
						Message:      fmt.Sprintf("'%s' foi movido para a lixeira do Drive após exclusão local.", relPath),
					})
					continue
				}
				// Se o usuário apagou no PC mas quer ignorar ou manter no Drive e não houve mudança remota
				if !remoteChanged && st.IgnoredLocalDelete {
					continue
				}
				if !remoteChanged && (folder.Direction == config.DirectionReceiveOnly || folder.OnLocalDelete == config.LocalDeleteIgnore) {
					st.IgnoredLocalDelete = true
					_ = s.store.UpsertSyncedFile(st)
					continue
				}
			}

			if !config.IsSenderAllowed(rem.AuthorEmail, folder.SenderPolicy) {
				ignoredSenders++
				s.recordBlockedSender(folder, relPath, rem)
				continue
			}

			if err := s.downloadEntry(ctx, driveAPI, folder, rem); err != nil {
				hadErrors++
				lastErr = err.Error()
			}

		// 2) Somente no PC
		case !hasRemote && hasLocal:
			if hasState {
				// Arquivo existia no Drive e foi apagado lá
				if folder.OnRemoteDelete == config.RemoteDeleteKeepLocal {
					if !st.DeletedOnRemote {
						locHash, hashErr := fileMD5(loc.AbsPath)
						if hashErr != nil || locHash == "" {
							locHash = st.LocalMD5
						}
						st.DeletedOnRemote = true
						st.KeptLocalHash = locHash
						st.KeptLocalMtimeNs = loc.MtimeNs
						st.LocalSize = loc.Size
						st.LocalMtimeNs = loc.MtimeNs
						if locHash != "" {
							st.LocalMD5 = locHash
						}
						_ = s.store.UpsertSyncedFile(st)
						_ = s.store.AddActivity(config.ActivityEvent{
							FolderID:      folder.ID,
							FolderName:    folder.Name,
							Kind:          "kept_local",
							Level:         "info",
							RelativePath:  relPath,
							FileSizeBytes: loc.Size,
							Message:       fmt.Sprintf("'%s' foi apagado no Drive, mas sua cópia já baixada foi mantida no PC.", relPath),
						})
						continue
					}
					// Já marcado como mantido no PC: só reenviar se usuário modificou o arquivo localmente depois
					if loc.MtimeNs == st.KeptLocalMtimeNs && loc.Size == st.LocalSize {
						continue
					}
					locHash, hashErr := fileMD5(loc.AbsPath)
					if hashErr != nil || locHash == "" {
						continue
					}
					if st.KeptLocalHash == "" && loc.Size == st.LocalSize {
						st.KeptLocalHash = locHash
						st.KeptLocalMtimeNs = loc.MtimeNs
						_ = s.store.UpsertSyncedFile(st)
						continue
					}
					if strings.EqualFold(locHash, st.KeptLocalHash) {
						st.KeptLocalMtimeNs = loc.MtimeNs
						_ = s.store.UpsertSyncedFile(st)
						continue
					}
					if folder.Direction != config.DirectionBidirectional {
						continue
					}
					// Usuário editou localmente após preservação -> segue para upload abaixo
				} else {
					// Política mirror_trash: move cópia local para quarentena
					if err := moveToQuarantine(folder.LocalPath, relPath, loc.AbsPath); err != nil {
						hadErrors++
						lastErr = err.Error()
						continue
					}
					_ = s.store.DeleteSyncedFile(folder.ID, relPath)
					_ = s.store.AddActivity(config.ActivityEvent{
						FolderID:      folder.ID,
						FolderName:    folder.Name,
						Kind:          "trashed_local",
						Level:         "info",
						RelativePath:  relPath,
						FileSizeBytes: loc.Size,
						Message:       fmt.Sprintf("'%s' foi apagado no Drive e movido para Quarentena local.", relPath),
					})
					continue
				}
			}

			if folder.Direction != config.DirectionBidirectional {
				continue
			}
			if !rootCanWrite {
				continue
			}
			if loc.Size > maxBytes {
				blocked4gb++
				s.recordBlocked4GB(folder, loc)
				continue
			}
			if err := s.uploadEntry(ctx, driveAPI, folder, settings, account, loc, "", maxBytes); err != nil {
				if errors.Is(err, drive.ErrExceedsMaxUpload) {
					blocked4gb++
					s.recordBlocked4GB(folder, loc)
				} else {
					hadErrors++
					lastErr = err.Error()
				}
			}

		// 3) Em ambos os lados
		case hasRemote && hasLocal:
			if !hasState {
				locHash, err := fileMD5(loc.AbsPath)
				if err != nil {
					hadErrors++
					lastErr = err.Error()
					continue
				}
				if rem.MD5 != "" && strings.EqualFold(locHash, rem.MD5) {
					_ = s.store.UpsertSyncedFile(db.SyncedFileRecord{
						FolderID:      folder.ID,
						RelativePath:  relPath,
						RemoteFileID:  rem.ID,
						RemoteMD5:     rem.MD5,
						RemoteModTime: rem.ModTime.Format(time.RFC3339Nano),
						LocalSize:     loc.Size,
						LocalMtimeNs:  loc.MtimeNs,
						LocalMD5:      locHash,
						AuthorEmail:   rem.AuthorEmail,
						AuthorName:    rem.AuthorName,
						Origin:        "remote",
					})
					continue
				}
				// Conteúdo diferente no pareamento inicial -> preserva cópia perdedora
				if folder.Direction == config.DirectionReceiveOnly || rem.ModTime.UnixNano() >= loc.MtimeNs {
					if !config.IsSenderAllowed(rem.AuthorEmail, folder.SenderPolicy) {
						ignoredSenders++
						s.recordBlockedSender(folder, relPath, rem)
						continue
					}
					if conflictPath, cErr := preserveConflictCopy(loc.AbsPath); cErr == nil {
						_ = s.store.AddActivity(config.ActivityEvent{
							FolderID:     folder.ID,
							FolderName:   folder.Name,
							Kind:         "conflict",
							Level:        "warning",
							RelativePath: relPath,
							Message:      fmt.Sprintf("Conflito em '%s': versão local preservada como '%s'.", relPath, filepath.Base(conflictPath)),
						})
					}
					if err := s.downloadEntry(ctx, driveAPI, folder, rem); err != nil {
						hadErrors++
						lastErr = err.Error()
					}
				} else if rootCanWrite {
					if loc.Size > maxBytes {
						blocked4gb++
						s.recordBlocked4GB(folder, loc)
						continue
					}
					// Baixa versão antiga do remoto como conflito antes de subir local
					if conflictPath, cErr := nextConflictPath(loc.AbsPath); cErr == nil {
						_, _ = driveAPI.DownloadFile(ctx, rem.ID, conflictPath, rem.Size, nil)
					}
					if err := s.uploadEntry(ctx, driveAPI, folder, settings, account, loc, rem.ID, maxBytes); err != nil {
						hadErrors++
						lastErr = err.Error()
					}
				}
				continue
			}

			// Já sincronizado anteriormente: verifica o que mudou
			remoteChanged := (rem.MD5 != "" && !strings.EqualFold(rem.MD5, st.RemoteMD5)) ||
				(rem.MD5 == "" && rem.ModTime.After(parseTime(st.RemoteModTime))) ||
				(st.DeletedOnRemote && rem.ID != st.RemoteFileID)
			localChanged := loc.Size != st.LocalSize || loc.MtimeNs != st.LocalMtimeNs
			if localChanged && loc.Size == st.LocalSize && st.LocalMD5 != "" {
				if h, err := fileMD5(loc.AbsPath); err == nil && strings.EqualFold(h, st.LocalMD5) {
					localChanged = false
					st.LocalMtimeNs = loc.MtimeNs
					_ = s.store.UpsertSyncedFile(st)
				}
			}

			switch {
			case !remoteChanged && !localChanged:
				continue

			case remoteChanged && !localChanged:
				if !config.IsSenderAllowed(rem.AuthorEmail, folder.SenderPolicy) {
					ignoredSenders++
					s.recordBlockedSender(folder, relPath, rem)
					continue
				}
				if err := s.downloadEntry(ctx, driveAPI, folder, rem); err != nil {
					hadErrors++
					lastErr = err.Error()
				}

			case !remoteChanged && localChanged:
				if folder.Direction != config.DirectionBidirectional || !rootCanWrite {
					continue
				}
				if loc.Size > maxBytes {
					blocked4gb++
					s.recordBlocked4GB(folder, loc)
					continue
				}
				if err := s.uploadEntry(ctx, driveAPI, folder, settings, account, loc, rem.ID, maxBytes); err != nil {
					if errors.Is(err, drive.ErrExceedsMaxUpload) {
						blocked4gb++
						s.recordBlocked4GB(folder, loc)
					} else {
						hadErrors++
						lastErr = err.Error()
					}
				}

			case remoteChanged && localChanged:
				if folder.Direction == config.DirectionReceiveOnly || rem.ModTime.UnixNano() >= loc.MtimeNs {
					if !config.IsSenderAllowed(rem.AuthorEmail, folder.SenderPolicy) {
						ignoredSenders++
						s.recordBlockedSender(folder, relPath, rem)
						continue
					}
					if conflictPath, cErr := preserveConflictCopy(loc.AbsPath); cErr == nil {
						_ = s.store.AddActivity(config.ActivityEvent{
							FolderID:     folder.ID,
							FolderName:   folder.Name,
							Kind:         "conflict",
							Level:        "warning",
							RelativePath: relPath,
							Message:      fmt.Sprintf("Conflito em '%s': versão local salva como '%s'.", relPath, filepath.Base(conflictPath)),
						})
					}
					if err := s.downloadEntry(ctx, driveAPI, folder, rem); err != nil {
						hadErrors++
						lastErr = err.Error()
					}
				} else if rootCanWrite {
					if loc.Size > maxBytes {
						blocked4gb++
						s.recordBlocked4GB(folder, loc)
						continue
					}
					if conflictPath, cErr := nextConflictPath(loc.AbsPath); cErr == nil {
						_, _ = driveAPI.DownloadFile(ctx, rem.ID, conflictPath, rem.Size, nil)
					}
					if err := s.uploadEntry(ctx, driveAPI, folder, settings, account, loc, rem.ID, maxBytes); err != nil {
						hadErrors++
						lastErr = err.Error()
					}
				}
			}

		// 4) Não existe nem no remoto nem no local -> limpa registro órfão
		case !hasRemote && !hasLocal && hasState:
			_ = s.store.DeleteSyncedFile(folder.ID, relPath)
		}
	}

	syncedCnt, keptCnt, _ := s.store.CountSyncedStats(folder.ID)
	finalStatus := "ok"
	finalMsg := "Tudo sincronizado"
	if hadErrors > 0 {
		finalStatus = "error"
		finalMsg = fmt.Sprintf("Concluído com %d erro(s): %s", hadErrors, lastErr)
	} else if blocked4gb > 0 {
		finalStatus = "warning"
		finalMsg = fmt.Sprintf("Sincronizado (%d arquivo(s) acima de 4 GB bloqueado(s))", blocked4gb)
	}

	s.setRuntime(config.FolderRuntimeState{
		FolderID:           folder.ID,
		Status:             finalStatus,
		Message:            finalMsg,
		LastSyncAt:         time.Now().Format(time.RFC3339),
		Blocked4GBCount:    blocked4gb,
		IgnoredSenderCount: ignoredSenders,
		KeptLocalCount:     keptCnt,
		SyncedFilesCount:   syncedCnt,
	})
	_ = s.presence.SyncFolderDevices(ctx, folder, settings, account, finalStatus)
	legacy.WriteWaybarStatus(settings.EnableWaybarBridge, mapLegacyStatus(finalStatus), hadErrors, finalMsg, folder.LocalPath, folder.RemoteFolderName)
	return nil
}

func (s *Syncer) downloadEntry(ctx context.Context, driveAPI drive.API, folder config.SyncFolderConfig, rem drive.RemoteEntry) error {
	dest := filepath.Join(folder.LocalPath, filepath.FromSlash(rem.RelativePath))
	s.setRuntime(config.FolderRuntimeState{
		FolderID:    folder.ID,
		Status:      "syncing",
		Message:     fmt.Sprintf("Baixando %s", rem.Name),
		CurrentFile: rem.RelativePath,
		BytesTotal:  rem.Size,
	})

	md5Hex, err := driveAPI.DownloadFile(ctx, rem.ID, dest, rem.Size, func(done, total int64) {
		pct := 0.0
		if total > 0 {
			pct = float64(done) * 100.0 / float64(total)
		}
		s.setRuntime(config.FolderRuntimeState{
			FolderID:         folder.ID,
			Status:           "syncing",
			Message:          fmt.Sprintf("Baixando %s", rem.Name),
			CurrentFile:      rem.RelativePath,
			ProgressPercent:  pct,
			BytesTransferred: done,
			BytesTotal:       total,
		})
	})
	if err != nil {
		return err
	}

	info, err := os.Stat(dest)
	if err != nil {
		return err
	}
	rMD5 := rem.MD5
	if rMD5 == "" {
		rMD5 = md5Hex
	}
	err = s.store.UpsertSyncedFile(db.SyncedFileRecord{
		FolderID:      folder.ID,
		RelativePath:  rem.RelativePath,
		RemoteFileID:  rem.ID,
		RemoteMD5:     rMD5,
		RemoteModTime: rem.ModTime.Format(time.RFC3339Nano),
		LocalSize:     info.Size(),
		LocalMtimeNs:  info.ModTime().UnixNano(),
		LocalMD5:      md5Hex,
		AuthorEmail:   rem.AuthorEmail,
		AuthorName:    rem.AuthorName,
		Origin:        "remote",
	})
	if err != nil {
		return err
	}

	fromLabel := rem.AuthorName
	if fromLabel == "" {
		fromLabel = rem.AuthorEmail
	}
	msg := fmt.Sprintf("Baixado '%s'", rem.RelativePath)
	if fromLabel != "" {
		msg = fmt.Sprintf("Baixado '%s' (enviado por %s)", rem.RelativePath, fromLabel)
	}
	_ = s.store.AddActivity(config.ActivityEvent{
		FolderID:      folder.ID,
		FolderName:    folder.Name,
		Kind:          "download",
		Level:         "success",
		Message:       msg,
		RelativePath:  rem.RelativePath,
		AuthorEmail:   rem.AuthorEmail,
		FileSizeBytes: info.Size(),
	})
	return nil
}

func (s *Syncer) uploadEntry(
	ctx context.Context,
	driveAPI drive.API,
	folder config.SyncFolderConfig,
	settings config.AppSettings,
	account config.AccountInfo,
	loc localFile,
	existingID string,
	maxBytes int64,
) error {
	parentDir := path.Dir(loc.RelPath)
	parentID := folder.RemoteFolderID
	if parentDir != "." && parentDir != "" {
		ensuredID, err := driveAPI.EnsurePath(ctx, folder.RemoteFolderID, parentDir)
		if err != nil {
			return err
		}
		parentID = ensuredID
	}

	baseName := path.Base(loc.RelPath)
	s.setRuntime(config.FolderRuntimeState{
		FolderID:    folder.ID,
		Status:      "syncing",
		Message:     fmt.Sprintf("Enviando %s", baseName),
		CurrentFile: loc.RelPath,
		BytesTotal:  loc.Size,
	})

	locHash, _ := fileMD5(loc.AbsPath)
	upEntry, err := driveAPI.UploadFile(
		ctx,
		loc.AbsPath,
		baseName,
		parentID,
		existingID,
		account.Email,
		account.DisplayName,
		settings.DeviceID,
		maxBytes,
		func(done, total int64) {
			pct := 0.0
			if total > 0 {
				pct = float64(done) * 100.0 / float64(total)
			}
			s.setRuntime(config.FolderRuntimeState{
				FolderID:         folder.ID,
				Status:           "syncing",
				Message:          fmt.Sprintf("Enviando %s", baseName),
				CurrentFile:      loc.RelPath,
				ProgressPercent:  pct,
				BytesTransferred: done,
				BytesTotal:       total,
			})
		},
	)
	if err != nil {
		return err
	}

	rMD5 := upEntry.MD5
	if rMD5 == "" {
		rMD5 = locHash
	}
	_ = s.store.UpsertSyncedFile(db.SyncedFileRecord{
		FolderID:      folder.ID,
		RelativePath:  loc.RelPath,
		RemoteFileID:  upEntry.ID,
		RemoteMD5:     rMD5,
		RemoteModTime: upEntry.ModTime.Format(time.RFC3339Nano),
		LocalSize:     loc.Size,
		LocalMtimeNs:  loc.MtimeNs,
		LocalMD5:      locHash,
		AuthorEmail:   account.Email,
		AuthorName:    account.DisplayName,
		Origin:        "local",
	})
	_ = s.store.AddActivity(config.ActivityEvent{
		FolderID:      folder.ID,
		FolderName:    folder.Name,
		Kind:          "upload",
		Level:         "success",
		Message:       fmt.Sprintf("Enviado '%s'", loc.RelPath),
		RelativePath:  loc.RelPath,
		AuthorEmail:   account.Email,
		FileSizeBytes: loc.Size,
	})
	return nil
}

func (s *Syncer) recordBlocked4GB(folder config.SyncFolderConfig, loc localFile) {
	detail := "Arquivo excede o limite de 4 GB por upload."
	_ = s.store.AddBlockedFile(config.BlockedFileEntry{
		FolderID:      folder.ID,
		FolderName:    folder.Name,
		RelativePath:  loc.RelPath,
		LocalPath:     loc.AbsPath,
		FileSizeBytes: loc.Size,
		Reason:        "exceeds_4gb",
		Detail:        detail,
	})
	_ = s.store.AddActivity(config.ActivityEvent{
		FolderID:      folder.ID,
		FolderName:    folder.Name,
		Kind:          "blocked_4gb",
		Level:         "warning",
		Message:       fmt.Sprintf("Upload bloqueado (> 4 GB): '%s'", loc.RelPath),
		RelativePath:  loc.RelPath,
		FileSizeBytes: loc.Size,
	})
}

func (s *Syncer) recordBlockedSender(folder config.SyncFolderConfig, relPath string, rem drive.RemoteEntry) {
	who := rem.AuthorEmail
	if who == "" {
		who = "remetente desconhecido"
	}
	_ = s.store.AddBlockedFile(config.BlockedFileEntry{
		FolderID:      folder.ID,
		FolderName:    folder.Name,
		RelativePath:  relPath,
		FileSizeBytes: rem.Size,
		AuthorEmail:   rem.AuthorEmail,
		AuthorName:    rem.AuthorName,
		Reason:        "sender_blocked",
		Detail:        fmt.Sprintf("Ignorado porque '%s' não está autorizado a enviar para este dispositivo.", who),
	})
}

func (s *Syncer) recordError(folder config.SyncFolderConfig, msg string, settings config.AppSettings) {
	s.setRuntime(config.FolderRuntimeState{
		FolderID: folder.ID,
		Status:   "error",
		Message:  msg,
	})
	_ = s.store.AddActivity(config.ActivityEvent{
		FolderID:   folder.ID,
		FolderName: folder.Name,
		Kind:       "sync_error",
		Level:      "error",
		Message:    msg,
	})
	legacy.WriteWaybarStatus(settings.EnableWaybarBridge, "error", 1, msg, folder.LocalPath, folder.RemoteFolderName)
}

func (s *Syncer) recordWarning(folder config.SyncFolderConfig, msg string, settings config.AppSettings, blocked4gb, ignoredSenders int) {
	syncedCnt, keptCnt, _ := s.store.CountSyncedStats(folder.ID)
	s.setRuntime(config.FolderRuntimeState{
		FolderID:           folder.ID,
		Status:             "warning",
		Message:            msg,
		LastSyncAt:         time.Now().Format(time.RFC3339),
		Blocked4GBCount:    blocked4gb,
		IgnoredSenderCount: ignoredSenders,
		KeptLocalCount:     keptCnt,
		SyncedFilesCount:   syncedCnt,
	})
	legacy.WriteWaybarStatus(settings.EnableWaybarBridge, "aborted", 1, msg, folder.LocalPath, folder.RemoteFolderName)
}

func (s *Syncer) ResendKeptFile(ctx context.Context, folderID, relPath string) error {
	if err := s.store.DeleteSyncedFile(folderID, relPath); err != nil {
		return err
	}
	return s.SyncFolder(ctx, folderID)
}

func moveToQuarantine(rootLocal, relPath, absPath string) error {
	dateDir := time.Now().Format("2006-01-02")
	qTarget := filepath.Join(rootLocal, config.QuarantineDirName, dateDir, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(qTarget), 0o755); err != nil {
		return err
	}
	return os.Rename(absPath, qTarget)
}

func nextConflictPath(absPath string) (string, error) {
	dir := filepath.Dir(absPath)
	base := filepath.Base(absPath)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	ts := time.Now().Format("20060102-150405")
	for i := 1; i < 100; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s.conflict-%s-%d%s", stem, ts, i, ext))
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		}
	}
	return "", errors.New("não foi possível gerar nome de conflito")
}

func preserveConflictCopy(absPath string) (string, error) {
	dst, err := nextConflictPath(absPath)
	if err != nil {
		return "", err
	}
	if err := os.Rename(absPath, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func parseTime(raw string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, raw)
	return t
}

func mapLegacyStatus(st string) string {
	switch st {
	case "ok", "warning":
		return "ok"
	case "syncing":
		return "syncing"
	default:
		return "error"
	}
}

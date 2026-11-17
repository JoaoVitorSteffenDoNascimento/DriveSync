package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/brendha/drivesync/engine/internal/api"
	"github.com/brendha/drivesync/engine/internal/config"
	"github.com/brendha/drivesync/engine/internal/db"
	"github.com/brendha/drivesync/engine/internal/drive"
	"github.com/brendha/drivesync/engine/internal/syncer"
	"github.com/brendha/drivesync/engine/internal/watcher"
)

func main() {
	portFlag := flag.Int("port", 47831, "Porta HTTP local (0 = aleatória)")
	tokenFlag := flag.String("token", "", "Token de autenticação local (opcional)")
	dataDirFlag := flag.String("data-dir", "", "Diretório de dados (opcional)")
	showVersion := flag.Bool("version", false, "Exibe versão e encerra")
	flag.Parse()

	if *showVersion {
		fmt.Printf("drivesyncd %s\n", config.AppVersion)
		return
	}

	if *dataDirFlag != "" {
		_ = os.Setenv("DRIVESYNC_DATA_DIR", *dataDirFlag)
	}
	dataDir, err := config.DataDir()
	if err != nil {
		log.Fatalf("erro ao inicializar diretório de dados: %v", err)
	}

	store, err := db.Open(filepath.Join(dataDir, "drivesync.db"))
	if err != nil {
		log.Fatalf("erro ao abrir SQLite: %v", err)
	}
	defer store.Close()

	authMgr := drive.NewAuthManager(store, dataDir)

	var initialAPI drive.API
	if ts, _, err := authMgr.TokenSource(context.Background()); err == nil {
		initialAPI = drive.NewGoogleDriveClient(ts)
	}

	var apiSrv *api.Server
	sy := syncer.New(store, initialAPI, func(evType string, payload any) {
		if apiSrv != nil {
			apiSrv.Broadcast(evType, payload)
		}
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fw, err := watcher.New(4*time.Second, func(folderID string) {
		_ = sy.SyncFolder(ctx, folderID)
		if apiSrv != nil {
			apiSrv.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}
	})
	if err != nil {
		log.Fatalf("erro ao iniciar watcher: %v", err)
	}
	defer fw.Close()

	if folders, err := store.ListFolders(); err == nil {
		_ = fw.SetFolders(folders)
	}
	go fw.Run(ctx)

	refreshDrive := func() {
		if ts, _, err := authMgr.TokenSource(context.Background()); err == nil {
			sy.SetDriveAPI(drive.NewGoogleDriveClient(ts))
		} else {
			sy.SetDriveAPI(nil)
		}
	}

	apiSrv = api.NewServer(*tokenFlag, store, authMgr, sy, fw, refreshDrive)

	// Loop periódico de sincronização (checa mudanças remotas no Drive / Drive Master)
	go func() {
		// Dispara uma primeira rodada breve após subir
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
			sy.SyncAll(ctx)
			apiSrv.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
		}

		for {
			st, _ := store.GetSettings()
			interval := time.Duration(st.PollIntervalSeconds) * time.Second
			if interval < 15*time.Second {
				interval = 45 * time.Second
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(interval):
				sy.SyncAll(ctx)
				apiSrv.Broadcast("snapshot_dirty", map[string]bool{"dirty": true})
			}
		}
	}()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *portFlag))
	if err != nil {
		log.Fatalf("erro ao escutar em 127.0.0.1:%d: %v", *portFlag, err)
	}
	actualPort := ln.Addr().(*net.TCPAddr).Port
	fmt.Printf("DRIVESYNCD_READY port=%d\n", actualPort)

	httpSrv := &http.Server{Handler: apiSrv.Handler()}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutCtx)
	}()

	if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("erro no servidor HTTP local: %v", err)
	}
}

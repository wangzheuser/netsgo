package server

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"netsgo/internal/storage"
)

type InitParams struct {
	AdminUsername string
	AdminPassword string
	ServerAddr    string
}

func (p InitParams) IsComplete() bool {
	return p.AdminUsername != "" &&
		p.AdminPassword != "" &&
		p.ServerAddr != ""
}

func IsInitialized(dataDir string) (bool, error) {
	return IsInitializedDB(filepath.Join(dataDir, "server", serverDBFileName))
}

func IsInitializedDB(path string) (bool, error) {
	db, err := storage.OpenReadOnly(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("open server sqlite init state: %w", err)
	}
	defer func() { _ = db.Close() }()

	hasConfig, err := storage.TableExists(db, "server_config")
	if err != nil {
		return false, fmt.Errorf("read server init schema: %w", err)
	}
	if !hasConfig {
		return false, nil
	}

	var initialized int
	err = db.QueryRow(`SELECT initialized FROM server_config WHERE id = 1`).Scan(&initialized)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read server init state: %w", err)
	}
	return intToBool(initialized), nil
}

func ApplyInit(dataDir string, params InitParams) error {
	log.Printf("正在初始化 server 数据...")
	adminStore, err := NewAdminStoreWithOptions(filepath.Join(dataDir, "server", serverDBFileName), AdminStoreOptions{SuppressUninitializedWarning: true})
	if err != nil {
		return err
	}
	defer func() { _ = adminStore.Close() }()
	initialized, err := adminStore.IsInitializedE()
	if err != nil {
		return err
	}
	if initialized {
		return nil
	}

	serverAddr, err := validateServerAddr(params.ServerAddr)
	if err != nil {
		return err
	}

	return adminStore.Initialize(params.AdminUsername, params.AdminPassword, serverAddr, nil)
}

func LoadRecoverableInitParams(dataDir string) (InitParams, error) {
	adminStore, err := NewAdminStore(filepath.Join(dataDir, "server", serverDBFileName))
	if err != nil {
		return InitParams{}, err
	}
	defer func() { _ = adminStore.Close() }()
	initialized, err := adminStore.IsInitializedE()
	if err != nil {
		return InitParams{}, err
	}
	if !initialized {
		return InitParams{}, fmt.Errorf("server historical data has not been initialized")
	}

	config, err := adminStore.GetServerConfigE()
	if err != nil {
		return InitParams{}, err
	}
	if strings.TrimSpace(config.ServerAddr) == "" {
		return InitParams{}, fmt.Errorf("server historical data is incomplete")
	}

	return InitParams{
		ServerAddr: config.ServerAddr,
	}, nil
}

package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsInitializedDBTreatsSchemaMissingAsUninitialized(t *testing.T) {
	path := filepath.Join(t.TempDir(), serverDBFileName)
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("failed to create empty sqlite placeholder: %v", err)
	}

	initialized, err := IsInitializedDB(path)
	if err != nil {
		t.Fatalf("IsInitializedDB() should not fail when server_config is missing: %v", err)
	}
	if initialized {
		t.Fatal("empty sqlite placeholder should not be initialized")
	}
}

func TestLoadRecoverableInitParams(t *testing.T) {
	dataDir := t.TempDir()
	params := InitParams{
		AdminUsername: "admin",
		AdminPassword: "Password123",
		ServerAddr:    "https://panel.example.com",
	}
	if err := ApplyInit(dataDir, params); err != nil {
		t.Fatalf("ApplyInit() failed: %v", err)
	}

	got, err := LoadRecoverableInitParams(dataDir)
	if err != nil {
		t.Fatalf("LoadRecoverableInitParams() failed: %v", err)
	}
	if got.ServerAddr != params.ServerAddr {
		t.Fatalf("ServerAddr = %q, want %q", got.ServerAddr, params.ServerAddr)
	}
}

func TestLoadRecoverableInitParamsRequiresInitializedData(t *testing.T) {
	if _, err := LoadRecoverableInitParams(t.TempDir()); err == nil {
		t.Fatal("uninitialized historical data should return error")
	}
}

func TestLoadRecoverableInitParamsKeepsHistoricalServerAddr(t *testing.T) {
	dataDir := t.TempDir()
	params := InitParams{
		AdminUsername: "admin",
		AdminPassword: "Password123",
		ServerAddr:    "https://old.example.com",
	}
	if err := ApplyInit(dataDir, params); err != nil {
		t.Fatalf("ApplyInit() failed: %v", err)
	}
	got, err := LoadRecoverableInitParams(dataDir)
	if err != nil {
		t.Fatalf("LoadRecoverableInitParams() failed: %v", err)
	}
	if got.ServerAddr != "https://old.example.com" {
		t.Fatalf("historical recovery should use old ServerAddr, got %q", got.ServerAddr)
	}
}

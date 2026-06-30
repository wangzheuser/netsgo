package manage

import (
	"os"
	"path/filepath"
	"testing"

	"netsgo/internal/svcmgr"
)

func TestUninstallAllWithRemovesBothRolesAndOptionalBinary(t *testing.T) {
	ui := &fakeUI{
		selects:  []int{1},
		confirms: []bool{true, true, true},
	}

	serverLayout := svcmgr.NewLayout(svcmgr.RoleServer)
	clientLayout := svcmgr.NewLayout(svcmgr.RoleClient)

	serverRemoved := []string{}
	clientRemoved := []string{}
	binaryRemoved := false
	sharedRemoved := []string{}
	userRemoved := ""

	err := uninstallAllWith(uninstallAllDeps{
		UI: ui,
		Server: serverDeps{
			DisableAndStop: func() error { return nil },
			RemovePaths: func(paths ...string) error {
				serverRemoved = append(serverRemoved, paths...)
				return nil
			},
			DaemonReload: func() error { return nil },
			RemoveBinary: func() error {
				binaryRemoved = true
				return nil
			},
		},
		Client: clientDeps{
			DisableAndStop: func() error { return nil },
			RemovePaths: func(paths ...string) error {
				clientRemoved = append(clientRemoved, paths...)
				return nil
			},
		},
		RemoveSharedPaths: func(paths ...string) error {
			sharedRemoved = append(sharedRemoved, paths...)
			return nil
		},
		RemoveUser: func(username string) error {
			userRemoved = username
			return nil
		},
	})
	assertSelectionExit(t, err)

	if !containsPath(serverRemoved, serverDataPath(serverLayout)) {
		t.Fatalf("bulk uninstall should remove server data when requested: %v", serverRemoved)
	}
	if !containsPath(serverRemoved, roleLockPath(serverLayout)) {
		t.Fatalf("bulk uninstall should remove server lock file: %v", serverRemoved)
	}
	if !containsPath(clientRemoved, clientDataPath(clientLayout)) {
		t.Fatalf("bulk uninstall should remove client data: %v", clientRemoved)
	}
	if !containsPath(clientRemoved, roleLockPath(clientLayout)) {
		t.Fatalf("bulk uninstall should remove client lock file: %v", clientRemoved)
	}
	if !binaryRemoved {
		t.Fatal("bulk uninstall should support removing the shared binary after both roles are removed")
	}
	if !containsPath(sharedRemoved, filepath.Join(svcmgr.ManagedDataDir, "locks")) {
		t.Fatalf("bulk uninstall should remove locks directory: %v", sharedRemoved)
	}
	if !containsPath(sharedRemoved, svcmgr.ManagedDataDir) {
		t.Fatalf("bulk uninstall should remove managed data dir: %v", sharedRemoved)
	}
	if userRemoved != svcmgr.SystemUser {
		t.Fatalf("bulk uninstall should remove system user %q, got %q", svcmgr.SystemUser, userRemoved)
	}
	if len(ui.summaries) != 3 || ui.summaries[2].title != "托管服务已卸载" {
		t.Fatalf("bulk uninstall should end with a completion summary, got %#v", ui.summaries)
	}
	assertSummaryCallDoesNotContain(t, ui.summaries[1], "身份")
	assertSummaryCallRow(t, ui.summaries[2], "server 角色", "已移除")
	assertSummaryCallRow(t, ui.summaries[2], "client 角色", "已移除")
	assertConfirmPhrase(t, ui.confirmCalls, "在批量移除中包含 server 卸载？", "remove server data")
	assertConfirmPhrase(t, ui.confirmCalls, "在批量移除中包含 client 卸载？", "uninstall client")
	assertConfirmPhrase(t, ui.confirmCalls, "未检测到其他托管角色。是否同时移除共享二进制 /usr/local/bin/netsgo？", "remove binary")
}

func TestUninstallAllKeepServerDataSkipsSharedCleanup(t *testing.T) {
	ui := &fakeUI{
		selects:  []int{0},
		confirms: []bool{true, true, true},
	}

	serverLayout := svcmgr.NewLayout(svcmgr.RoleServer)
	clientLayout := svcmgr.NewLayout(svcmgr.RoleClient)

	serverRemoved := []string{}
	clientRemoved := []string{}
	sharedRemoved := []string{}
	userRemoved := ""

	err := uninstallAllWith(uninstallAllDeps{
		UI: ui,
		Server: serverDeps{
			DisableAndStop: func() error { return nil },
			RemovePaths: func(paths ...string) error {
				serverRemoved = append(serverRemoved, paths...)
				return nil
			},
			DaemonReload: func() error { return nil },
			RemoveBinary: func() error { return nil },
		},
		Client: clientDeps{
			DisableAndStop: func() error { return nil },
			RemovePaths: func(paths ...string) error {
				clientRemoved = append(clientRemoved, paths...)
				return nil
			},
		},
		RemoveSharedPaths: func(paths ...string) error {
			sharedRemoved = append(sharedRemoved, paths...)
			return nil
		},
		RemoveUser: func(username string) error {
			userRemoved = username
			return nil
		},
	})
	assertSelectionExit(t, err)

	if containsPath(serverRemoved, serverDataPath(serverLayout)) {
		t.Fatal("keep-data mode should not remove server data dir")
	}
	if containsPath(serverRemoved, roleLockPath(serverLayout)) {
		t.Fatal("keep-data mode should not remove server lock file")
	}
	if !containsPath(clientRemoved, clientDataPath(clientLayout)) {
		t.Fatal("client data should always be removed in bulk uninstall")
	}
	if !containsPath(clientRemoved, roleLockPath(clientLayout)) {
		t.Fatal("client lock file should always be removed in bulk uninstall")
	}
	if len(sharedRemoved) != 0 {
		t.Fatalf("shared cleanup should not run when server data is kept: %v", sharedRemoved)
	}
	if userRemoved != "" {
		t.Fatalf("system user should not be removed when server data is kept, got %q", userRemoved)
	}
}

func containsPath(paths []string, target string) bool {
	for _, path := range paths {
		if path == target {
			return true
		}
	}
	return false
}

func TestRemoveEmptyDirRemovesOnlyEmptyDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "empty")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatalf("create empty dir: %v", err)
	}

	removeEmptyDir(dir)

	if _, err := os.Lstat(dir); !os.IsNotExist(err) {
		t.Fatalf("empty dir should be removed, err=%v", err)
	}
}

func TestRemoveEmptyDirLeavesNonEmptyDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "non-empty")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatalf("create non-empty dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "kept"), []byte("x"), 0o644); err != nil {
		t.Fatalf("create child file: %v", err)
	}

	removeEmptyDir(dir)

	if _, err := os.Lstat(filepath.Join(dir, "kept")); err != nil {
		t.Fatalf("non-empty dir contents should remain: %v", err)
	}
}

func TestRemoveEmptyDirDoesNotFollowSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	link := filepath.Join(root, "link")
	if err := os.Mkdir(target, 0o755); err != nil {
		t.Fatalf("create target dir: %v", err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not available on this platform: %v", err)
	}

	removeEmptyDir(link)

	if _, err := os.Lstat(link); err != nil {
		t.Fatalf("symlink should remain untouched: %v", err)
	}
	if _, err := os.Lstat(target); err != nil {
		t.Fatalf("symlink target should remain untouched: %v", err)
	}
}

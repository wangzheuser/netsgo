package svcmgr

import (
	"runtime"
	"testing"
)

func TestUserExists(t *testing.T) {
	exists, err := UserExists("root")
	if err != nil {
		t.Fatalf("UserExists(root) should not return an error: %v", err)
	}
	if !exists {
		t.Fatal("root user should exist")
	}

	exists, err = UserExists("netsgo-user-should-not-exist-xyz")
	if err != nil {
		t.Fatalf("UserExists(nonexistent) should not return an error: %v", err)
	}
	if exists {
		t.Fatal("a random nonexistent user should not exist")
	}
}

func TestEnsureUserStub(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("covered by the real implementation on Linux")
	}

	if err := EnsureUser("netsgo"); err != ErrUnsupportedPlatform {
		t.Fatalf("non-Linux platforms should return ErrUnsupportedPlatform, got %v", err)
	}
}

func TestRemoveUserStub(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("covered by the real implementation on Linux")
	}

	if err := RemoveUser("netsgo"); err != ErrUnsupportedPlatform {
		t.Fatalf("non-Linux platforms should return ErrUnsupportedPlatform, got %v", err)
	}
}

func TestGroupExists(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("group lookup behavior differs on non-Linux platforms")
	}

	exists, err := GroupExists("root")
	if err != nil {
		t.Fatalf("GroupExists(root) should not return an error: %v", err)
	}
	if !exists {
		t.Fatal("root group should exist")
	}

	exists, err = GroupExists("netsgo-group-should-not-exist-xyz")
	if err != nil {
		t.Fatalf("GroupExists(nonexistent) should not return an error: %v", err)
	}
	if exists {
		t.Fatal("a random nonexistent group should not exist")
	}
}

//go:build linux

package svcmgr

import (
	"os/user"
	"testing"
)

func TestRemoveUserRemovesUserAndGroup(t *testing.T) {
	stubLookupSystemUserResult(t, &user.User{Username: "netsgo"}, nil)
	stubLookupSystemGroupResult(t, &user.Group{Name: "netsgo"}, nil)

	commands := stubRunUserCommand(t)
	if err := RemoveUser("netsgo"); err != nil {
		t.Fatalf("RemoveUser should remove user and group: %v", err)
	}

	want := []string{"userdel netsgo", "groupdel netsgo"}
	if !sameStrings(commands(), want) {
		t.Fatalf("commands = %v, want %v", commands(), want)
	}
}

func TestRemoveUserRemovesGroupWhenUserAlreadyMissing(t *testing.T) {
	stubLookupSystemUserResult(t, nil, user.UnknownUserError("netsgo"))
	stubLookupSystemGroupResult(t, &user.Group{Name: "netsgo"}, nil)

	commands := stubRunUserCommand(t)
	if err := RemoveUser("netsgo"); err != nil {
		t.Fatalf("RemoveUser should remove a leftover group: %v", err)
	}

	want := []string{"groupdel netsgo"}
	if !sameStrings(commands(), want) {
		t.Fatalf("commands = %v, want %v", commands(), want)
	}
}

func TestRemoveUserSkipsMissingUserAndGroup(t *testing.T) {
	stubLookupSystemUserResult(t, nil, user.UnknownUserError("netsgo"))
	stubLookupSystemGroupResult(t, nil, user.UnknownGroupError("netsgo"))

	commands := stubRunUserCommand(t)
	if err := RemoveUser("netsgo"); err != nil {
		t.Fatalf("RemoveUser should treat missing user and group as removed: %v", err)
	}
	if len(commands()) != 0 {
		t.Fatalf("missing user and group should not run commands: %v", commands())
	}
}

func stubLookupSystemUserResult(t *testing.T, result *user.User, err error) {
	t.Helper()

	original := lookupSystemUser
	lookupSystemUser = func(string) (*user.User, error) {
		return result, err
	}
	t.Cleanup(func() {
		lookupSystemUser = original
	})
}

func stubLookupSystemGroupResult(t *testing.T, result *user.Group, err error) {
	t.Helper()

	original := lookupSystemGroup
	lookupSystemGroup = func(string) (*user.Group, error) {
		return result, err
	}
	t.Cleanup(func() {
		lookupSystemGroup = original
	})
}

func stubRunUserCommand(t *testing.T) func() []string {
	t.Helper()

	commands := []string{}
	original := runUserCommand
	runUserCommand = func(name string, args ...string) error {
		command := name
		for _, arg := range args {
			command += " " + arg
		}
		commands = append(commands, command)
		return nil
	}
	t.Cleanup(func() {
		runUserCommand = original
	})
	return func() []string {
		return commands
	}
}

func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

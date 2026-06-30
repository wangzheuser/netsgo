//go:build !linux

package svcmgr

func EnsureUser(username string) error {
	return ErrUnsupportedPlatform
}

func RemoveUser(username string) error {
	return ErrUnsupportedPlatform
}

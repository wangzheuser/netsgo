package server

// ValidateServerAddr validates the management panel server address.
// Returns an error if the address is invalid (must be http:// or https:// URL).
func ValidateServerAddr(addr string) error {
	_, err := validateServerAddr(addr)
	return err
}

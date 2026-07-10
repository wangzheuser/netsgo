package server

import (
	"testing"

	"netsgo/pkg/protocol"
)

func TestComputeTunnelCapabilitiesIncludesCanMigrateAndBlocksPending(t *testing.T) {
	t.Run("stable non-pending tunnel can migrate", func(t *testing.T) {
		// Given
		config := protocol.ProxyConfig{
			ID:           "tunnel-1",
			Revision:     7,
			DesiredState: protocol.ProxyDesiredStateRunning,
			RuntimeState: protocol.ProxyRuntimeStateOffline,
		}

		// When
		capabilities := computeTunnelCapabilities(config)

		// Then
		if !capabilities.CanMigrate {
			t.Fatalf("CanMigrate = false, want true for stable non-pending tunnel: %+v", capabilities)
		}
		if !capabilities.CanEdit || !capabilities.CanDelete {
			t.Fatalf("ordinary edit/delete should remain independent capabilities: %+v", capabilities)
		}
	})

	t.Run("pending stable tunnel cannot migrate", func(t *testing.T) {
		// Given
		config := protocol.ProxyConfig{
			ID:           "tunnel-2",
			Revision:     3,
			DesiredState: protocol.ProxyDesiredStateRunning,
			RuntimeState: protocol.ProxyRuntimeStatePending,
		}

		// When
		capabilities := computeTunnelCapabilities(config)

		// Then
		if capabilities.CanMigrate {
			t.Fatalf("CanMigrate = true, want false for pending tunnel: %+v", capabilities)
		}
	})

	t.Run("missing stable id or revision cannot migrate", func(t *testing.T) {
		for _, tc := range []struct {
			name     string
			id       string
			revision int64
		}{
			{name: "missing id", id: "", revision: 1},
			{name: "missing revision", id: "tunnel-3", revision: 0},
		} {
			t.Run(tc.name, func(t *testing.T) {
				// Given
				config := protocol.ProxyConfig{
					ID:           tc.id,
					Revision:     tc.revision,
					DesiredState: protocol.ProxyDesiredStateStopped,
					RuntimeState: protocol.ProxyRuntimeStateIdle,
				}

				// When
				capabilities := computeTunnelCapabilities(config)

				// Then
				if capabilities.CanMigrate {
					t.Fatalf("CanMigrate = true, want false when stable identity is invalid: %+v", capabilities)
				}
				if !capabilities.CanEdit || !capabilities.CanDelete {
					t.Fatalf("test setup must keep ordinary edit/delete available: %+v", capabilities)
				}
			})
		}
	})
}

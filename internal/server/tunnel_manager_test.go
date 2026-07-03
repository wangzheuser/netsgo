package server

import (
	"testing"
	"time"

	"netsgo/pkg/protocol"
)

func TestHasStoredTunnelForEvent(t *testing.T) {
	s := New(0)
	storedAt := time.Now().UTC()
	stored := testStoredServerExposeTCPTunnel("stored-event-id", "stored-event", "client-a", 8080, 18080, storedAt)

	if s.hasStoredTunnelForEvent("client-a", storedTunnelToProxyConfig(stored)) {
		t.Fatal("server without a tunnel store should suppress tunnel events")
	}

	s.store = newTestTunnelStore(t)
	mustAddStableTunnel(t, s.store, stored)

	tests := []struct {
		name     string
		clientID string
		config   protocol.ProxyConfig
		want     bool
	}{
		{
			name:     "owner id match",
			clientID: "ignored-client",
			config: protocol.ProxyConfig{
				ID:            stored.ID,
				Name:          stored.Name,
				OwnerClientID: stored.OwnerClientID,
			},
			want: true,
		},
		{
			name:     "client id fallback",
			clientID: "ignored-client",
			config: protocol.ProxyConfig{
				ID:       stored.ID,
				Name:     stored.Name,
				ClientID: stored.ClientID,
			},
			want: true,
		},
		{
			name:     "event client id fallback",
			clientID: stored.ClientID,
			config: protocol.ProxyConfig{
				ID:   stored.ID,
				Name: stored.Name,
			},
			want: true,
		},
		{
			name:     "name fallback after missing id",
			clientID: stored.ClientID,
			config: protocol.ProxyConfig{
				ID:            "missing-id",
				Name:          stored.Name,
				OwnerClientID: stored.OwnerClientID,
			},
			want: true,
		},
		{
			name:     "runtime only id and name",
			clientID: stored.ClientID,
			config: protocol.ProxyConfig{
				ID:            "runtime-id",
				Name:          "runtime-only",
				OwnerClientID: stored.OwnerClientID,
			},
			want: false,
		},
		{
			name:     "wrong owner suppresses",
			clientID: stored.ClientID,
			config: protocol.ProxyConfig{
				ID:            stored.ID,
				Name:          stored.Name,
				OwnerClientID: "other-client",
			},
			want: false,
		},
		{
			name:     "empty identity suppresses",
			clientID: "",
			config:   protocol.ProxyConfig{Name: stored.Name},
			want:     false,
		},
		{
			name:     "empty id and name suppresses",
			clientID: stored.ClientID,
			config:   protocol.ProxyConfig{OwnerClientID: stored.OwnerClientID},
			want:     false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := s.hasStoredTunnelForEvent(tc.clientID, tc.config); got != tc.want {
				t.Fatalf("hasStoredTunnelForEvent() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestEmitTunnelChangedIfStoredSuppressesRuntimeOnlyTunnels(t *testing.T) {
	s := New(0)
	s.store = newTestTunnelStore(t)
	ch := s.events.Subscribe()
	defer s.events.Unsubscribe(ch)

	now := time.Now().UTC()
	runtimeOnly := testRuntimeOnlyProxyTunnel("runtime-event-id", "runtime-only-event", "client-a", 8081, 18081, now)
	s.emitTunnelChangedIfStored("client-a", runtimeOnly.Config, "error")
	assertNoTunnelChangedEvent(t, ch, 150*time.Millisecond, runtimeOnly.Config.Name)

	stored := testStoredServerExposeTCPTunnel("stored-event-id", "stored-event", "client-a", 8080, 18080, now)
	mustAddStableTunnel(t, s.store, stored)
	s.emitTunnelChangedIfStored("client-a", storedTunnelToProxyConfig(stored), "error")
	payload := waitForTunnelChangedEvent(t, ch, "error", stored.Name)
	if payload["id"] != stored.ID {
		t.Fatalf("stored tunnel_changed id: want %q, got %#v", stored.ID, payload["id"])
	}
}

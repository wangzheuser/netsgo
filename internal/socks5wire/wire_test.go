package socks5wire

import (
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func TestReadConnectRequestRejectsNonzeroRSV(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()
	defer func() { _ = serverConn.Close() }()

	go func() {
		req := []byte{Version, CommandConnect, 0x01, AddrIPv4, 127, 0, 0, 1, 0, 80}
		_, _ = clientConn.Write(req)
	}()

	_ = serverConn.SetReadDeadline(time.Now().Add(time.Second))
	if _, rep, ok := ReadConnectRequest(serverConn); ok || rep != RepGeneralFailure {
		t.Fatalf("nonzero RSV should be rejected with general failure: ok=%v rep=%#x", ok, rep)
	}
}

func TestReadConnectRequestRejectsUnsupportedCommands(t *testing.T) {
	tests := []struct {
		name    string
		command byte
	}{
		{name: "bind", command: CommandBind},
		{name: "udp associate", command: CommandUDPAssociate},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clientConn, serverConn := net.Pipe()
			defer func() { _ = clientConn.Close() }()
			defer func() { _ = serverConn.Close() }()

			go func() {
				req := []byte{Version, tt.command, 0x00, AddrIPv4, 127, 0, 0, 1, 0, 80}
				_, _ = clientConn.Write(req)
			}()

			_ = serverConn.SetReadDeadline(time.Now().Add(time.Second))
			if _, rep, ok := ReadConnectRequest(serverConn); ok || rep != RepCommandUnsupported {
				t.Fatalf("unsupported command should be rejected: ok=%v rep=%#x", ok, rep)
			}
		})
	}
}

func TestReadConnectRequestConnectParsesIPv4(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer func() { _ = clientConn.Close() }()
	defer func() { _ = serverConn.Close() }()

	go func() {
		req := []byte{Version, CommandConnect, 0x00, AddrIPv4, 127, 0, 0, 1, 0, 0}
		binary.BigEndian.PutUint16(req[8:10], 443)
		_, _ = clientConn.Write(req)
	}()

	_ = serverConn.SetReadDeadline(time.Now().Add(time.Second))
	req, rep, ok := ReadConnectRequest(serverConn)
	if !ok {
		t.Fatalf("CONNECT should parse: rep=%#x", rep)
	}
	if req.Host != "127.0.0.1" || req.Port != 443 || req.AddrType == "" {
		t.Fatalf("parsed request mismatch: %+v", req)
	}
}

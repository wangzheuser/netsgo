import { describe, expect, test } from 'bun:test';

import { ApiError } from '@/lib/api';

import { legacyClientTunnelPath, shouldUseLegacyTunnelEndpoint } from './use-tunnel-mutations';

describe('shouldUseLegacyTunnelEndpoint', () => {
  test('allows legacy fallback for old server-expose endpoints', () => {
    expect(shouldUseLegacyTunnelEndpoint(new ApiError(404, 'Not Found'), 'server_expose')).toBe(true);
    expect(shouldUseLegacyTunnelEndpoint(new ApiError(405, 'Method Not Allowed'))).toBe(true);
  });

  test('does not fallback for client-to-client mutations', () => {
    expect(shouldUseLegacyTunnelEndpoint(new ApiError(404, 'Not Found'), 'client_to_client')).toBe(false);
  });

  test('does not fallback for non endpoint-missing errors', () => {
    expect(shouldUseLegacyTunnelEndpoint(new ApiError(500, 'Internal Server Error'), 'server_expose')).toBe(false);
    expect(shouldUseLegacyTunnelEndpoint(new Error('network failed'), 'server_expose')).toBe(false);
  });

  test('legacy client tunnel path encodes clientId path segments', () => {
    expect(legacyClientTunnelPath('client/with?reserved#chars')).toBe('/api/clients/client%2Fwith%3Freserved%23chars/tunnels');
    expect(legacyClientTunnelPath('client/with?reserved#chars', '/tunnel-1/resume')).toBe('/api/clients/client%2Fwith%3Freserved%23chars/tunnels/tunnel-1/resume');
  });
});

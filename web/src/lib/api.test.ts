import { describe, expect, test } from 'bun:test';

import { shouldLogoutOnAPIError, tunnelApi } from './api';

describe('shouldLogoutOnAPIError', () => {
  test('logs out when the server reports an expired or missing session', () => {
    expect(shouldLogoutOnAPIError(401, 'missing_credentials')).toBe(true);
    expect(shouldLogoutOnAPIError(401, 'session_expired_or_revoked')).toBe(true);
    expect(shouldLogoutOnAPIError(401, undefined)).toBe(true);
  });

  test('keeps the current page for credential verification errors', () => {
    expect(shouldLogoutOnAPIError(401, 'current_password_incorrect')).toBe(false);
    expect(shouldLogoutOnAPIError(401, 'invalid_mfa_code')).toBe(false);
    expect(shouldLogoutOnAPIError(401, 'passkey_login_failed')).toBe(false);
  });

  test('ignores non-auth statuses', () => {
    expect(shouldLogoutOnAPIError(400, 'invalid_request_body')).toBe(false);
    expect(shouldLogoutOnAPIError(500, 'temporary_storage_failure')).toBe(false);
  });
});

describe('tunnelApi.migrate', () => {
  test('posts the current revision and target client to the encoded migrate route', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await tunnelApi.migrate('tunnel/with space', {
        expected_revision: 12,
        target_client_id: 'client-next',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedUrl).toBe('/api/tunnels/tunnel%2Fwith%20space/migrate');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      expected_revision: 12,
      target_client_id: 'client-next',
    });
  });
});

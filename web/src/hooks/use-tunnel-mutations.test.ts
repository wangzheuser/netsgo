import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { invalidateTunnelQueries } from './use-tunnel-mutations';

describe('invalidateTunnelQueries', () => {
  test('invalidates every tunnel migration dependent cache', async () => {
    const queryClient = new QueryClient();
    const keys = [
      ['clients'],
      ['client-tunnels', 'old-owner', 'owner'],
      ['client-tunnels', 'new-owner', 'owner'],
      ['client-traffic', 'old-owner', '60s'],
      ['client-traffic', 'new-owner', '24h'],
      ['console-summary'],
      ['server-status'],
      ['unrelated'],
    ] as const;
    for (const key of keys) {
      queryClient.setQueryData(key, { ready: true });
    }

    invalidateTunnelQueries(queryClient);
    await Promise.resolve();

    for (const key of keys.slice(0, -1)) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(keys.at(-1)!)?.isInvalidated).toBe(false);
  });
});

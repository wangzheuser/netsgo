import type { Client, MigrateTunnelInput, ProxyConfig } from '@/types';

export function getLatestTunnelMigrationTarget<Tunnel extends Pick<ProxyConfig, 'id'>>(
  tunnels: readonly Tunnel[],
  tunnelId: string | null,
): Tunnel | null {
  if (tunnelId === null) return null;
  return tunnels.find((tunnel) => tunnel.id === tunnelId) ?? null;
}

export function getTunnelMigrationCandidates(tunnel: ProxyConfig | null, clients: Client[] = []) {
  if (!tunnel) return [];

  const currentTargetClientId = tunnel.target?.client_id || tunnel.owner_client_id || tunnel.client_id;
  const ingressClientId = tunnel.topology === 'client_to_client' ? tunnel.ingress?.client_id : undefined;
  return clients.filter((client) => client.id !== currentTargetClientId && client.id !== ingressClientId);
}

export function buildTunnelMigrationInput(
  tunnel: ProxyConfig | null,
  targetClientId: string,
  clients: Client[] = [],
): MigrateTunnelInput | null {
  const revision = tunnel?.revision;
  if (
    !tunnel?.id
    || revision === undefined
    || !Number.isSafeInteger(revision)
    || revision <= 0
    || !getTunnelMigrationCandidates(tunnel, clients).some((client) => client.id === targetClientId)
  ) {
    return null;
  }
  return {
    tunnelId: tunnel.id,
    expected_revision: revision,
    target_client_id: targetClientId,
  };
}

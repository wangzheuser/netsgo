import { resolveTunnelStatus } from '@/lib/tunnel-model';
import type { Client, ProxyConfig } from '@/types';

export interface DashboardTabMetric {
  total: number;
  healthy: number;
}

export interface DashboardTabMetrics {
  clients: DashboardTabMetric;
  tunnels: DashboardTabMetric;
}

function addClientId(ids: Set<string>, clientId: string | undefined) {
  if (clientId) {
    ids.add(clientId);
  }
}

function getTunnelParticipantIds(tunnel: ProxyConfig) {
  const ids = new Set<string>();
  if (tunnel.ingress?.location === 'client') {
    addClientId(ids, tunnel.ingress.client_id);
  }
  addClientId(ids, tunnel.participants?.ingress?.client_id);
  if (tunnel.target?.location === 'client') {
    addClientId(ids, tunnel.target.client_id);
  }
  addClientId(ids, tunnel.participants?.target?.client_id);
  addClientId(ids, tunnel.client_id);
  return [...ids];
}

function isTunnelHealthy(
  tunnel: ProxyConfig,
  fallbackClientOnline: boolean,
  onlineByClientId: Map<string, boolean>,
) {
  const participantIds = getTunnelParticipantIds(tunnel);
  const participantsOnline = participantIds.length === 0
    ? fallbackClientOnline
    : participantIds.every((clientId) => onlineByClientId.get(clientId) ?? false);

  return resolveTunnelStatus(tunnel, participantsOnline).key === 'exposed';
}

export function buildDashboardTabMetrics(clients: Client[] | undefined): DashboardTabMetrics {
  const clientList = clients ?? [];
  const onlineByClientId = new Map(clientList.map((client) => [client.id, client.online]));
  const seenTunnelIds = new Set<string>();
  const metrics: DashboardTabMetrics = {
    clients: {
      total: clientList.length,
      healthy: clientList.filter((client) => client.online).length,
    },
    tunnels: {
      total: 0,
      healthy: 0,
    },
  };

  for (const client of clientList) {
    for (const tunnel of client.proxies ?? []) {
      if (seenTunnelIds.has(tunnel.id)) {
        continue;
      }
      seenTunnelIds.add(tunnel.id);
      metrics.tunnels.total += 1;
      if (isTunnelHealthy(tunnel, client.online, onlineByClientId)) {
        metrics.tunnels.healthy += 1;
      }
    }
  }

  return metrics;
}

export function formatDashboardTabCount(metric: DashboardTabMetric) {
  if (metric.total === 0) {
    return null;
  }
  if (metric.healthy === metric.total) {
    return String(metric.total);
  }
  return `${metric.healthy}/${metric.total}`;
}

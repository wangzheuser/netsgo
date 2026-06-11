import { bpsToMbpsInput } from '@/lib/format';
import type { Client, ProxyConfig, ProxyType, TunnelTopology } from '@/types';

/** 编辑模式下传入的隧道数据 */
export interface TunnelDialogEditData extends ProxyConfig {
  clientId: string;
}

export interface TunnelFormState {
  name: string;
  topology: TunnelTopology;
  targetClientId: string;
  ingressClientId: string;
  bindIp: string;
  type: ProxyType;
  localIp: string;
  localPort: string;
  remotePort: string;
  domain: string;
  ingressBps: string;
  egressBps: string;
}

type TunnelInitialFormProps =
  | {
    mode: 'create';
    clientId: string;
    clients?: Client[];
  }
  | {
    mode: 'edit';
    tunnel: TunnelDialogEditData | null;
    clients?: Client[];
  };

export function getInitialTunnelFormState(props: TunnelInitialFormProps): TunnelFormState {
  if (props.mode === 'edit' && props.tunnel) {
    return {
      name: props.tunnel.name,
      topology: props.tunnel.topology ?? 'server_expose',
      targetClientId: props.tunnel.target?.client_id ?? props.tunnel.owner_client_id ?? props.tunnel.client_id ?? props.tunnel.clientId,
      ingressClientId: props.tunnel.ingress?.client_id ?? '',
      bindIp: props.tunnel.ingress?.type === 'tcp_listen' || props.tunnel.ingress?.type === 'udp_listen'
        ? props.tunnel.ingress.config.bind_ip
        : '0.0.0.0',
      type: props.tunnel.type,
      localIp: getInitialTargetHost(props.tunnel),
      localPort: String(getInitialTargetPort(props.tunnel) || ''),
      remotePort: String(getInitialIngressPort(props.tunnel) || ''),
      domain: props.tunnel.domain || '',
      ingressBps: bpsToMbpsInput(props.tunnel.ingress_bps),
      egressBps: bpsToMbpsInput(props.tunnel.egress_bps),
    };
  }

  return {
    name: '',
    topology: 'server_expose',
    targetClientId: props.mode === 'create' ? props.clientId : '',
    ingressClientId: '',
    bindIp: '0.0.0.0',
    type: 'tcp',
    localIp: '127.0.0.1',
    localPort: '',
    remotePort: '',
    domain: '',
    ingressBps: '',
    egressBps: '',
  };
}

function getInitialIngressPort(tunnel: TunnelDialogEditData) {
  if (tunnel.ingress?.type === 'tcp_listen' || tunnel.ingress?.type === 'udp_listen') {
    return tunnel.ingress.config.port;
  }
  return tunnel.remote_port;
}

function getInitialTargetHost(tunnel: TunnelDialogEditData) {
  if (tunnel.target?.type === 'tcp_service' || tunnel.target?.type === 'udp_service') {
    return tunnel.target.config.ip || tunnel.target.config.host || '127.0.0.1';
  }
  return tunnel.local_ip || '127.0.0.1';
}

function getInitialTargetPort(tunnel: TunnelDialogEditData) {
  if (tunnel.target?.type === 'tcp_service' || tunnel.target?.type === 'udp_service') {
    return tunnel.target.config.port;
  }
  return tunnel.local_port;
}

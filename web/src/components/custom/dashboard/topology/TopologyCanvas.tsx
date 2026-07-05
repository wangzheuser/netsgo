import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { drag } from 'd3-drag';
import 'd3-transition';
import { useTranslation } from 'react-i18next';
import {
  Undo2,
  Plus,
  Minus,
  LocateFixed,
  Maximize2,
  Minimize2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  SERVER_NODE_ID,
  computeEdgeOffsets,
  computeQuadraticEdge,
  getControlLinkEmphasis,
  getTunnelEdgeEmphasis,
  getTopologyNeighborIds,
  shouldRenderControlLink,
  topologyEdgeTouches,
  type TopologyEdge,
  type TopologyGraph,
  type TopologyNode,
  type TopologyTrafficSnapshot,
  type TopologyViewState,
} from './topology-model';
import {
  EDGE_FLOW_COLORS,
  EDGE_STROKE,
  LABEL_HALO,
  emphasisOpacity,
  flowDuration,
  formatTrafficPair,
  hasTraffic,
  trafficStrokeWidth,
  tunnelStreamDuration,
  truncateLabel,
} from './topology-rendering';
import { TopologyNodeView } from './TopologyNodeView';

interface SimNode extends SimulationNodeDatum {
  id: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: 'control' | 'c2c';
}

const OVERVIEW_FAN_CLIENT_LIMIT = 9;
const FOCUS_FAN_CLIENT_LIMIT = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * clamp(t, 0, 1);
}

function radians(degrees: number) {
  return (degrees / 180) * Math.PI;
}

function overviewServerPosition(width: number, height: number) {
  return {
    x: width / 2,
    y: clamp(height * 0.3, 88, Math.max(88, height * 0.36)),
  };
}

function overviewFanPosition(
  node: TopologyNode,
  clients: TopologyNode[],
  width: number,
  height: number,
) {
  const server = overviewServerPosition(width, height);
  if (node.id === SERVER_NODE_ID) {
    return server;
  }

  const index = Math.max(0, clients.findIndex((candidate) => candidate.id === node.id));
  const count = Math.max(1, clients.length);
  const fanT = count <= 2 ? 0 : (count - 2) / (OVERVIEW_FAN_CLIENT_LIMIT - 2);
  const spread = radians(count === 1 ? 0 : lerp(46, 132, fanT));
  const angle = Math.PI / 2 + (count === 1 ? 0 : (index / (count - 1) - 0.5) * spread);
  const maxRadius = Math.max(116, height - server.y - 64);
  const radius = clamp(Math.min(width * 0.24, height * 0.42), 116, maxRadius);

  return {
    x: clamp(server.x + Math.cos(angle) * radius, 54, Math.max(54, width - 54)),
    y: clamp(server.y + Math.sin(angle) * radius, server.y + 82, Math.max(server.y + 82, height - 48)),
  };
}

function overviewRingPosition(
  node: TopologyNode,
  clients: TopologyNode[],
  width: number,
  height: number,
) {
  const centerX = width / 2;
  const radiusY = clamp(Math.min(height * 0.31, width * 0.17), 132, Math.max(132, height * 0.38));
  const centerY = clamp(height * 0.52, radiusY + 78, Math.max(radiusY + 78, height - 70));
  const server = { x: centerX, y: centerY - radiusY };
  if (node.id === SERVER_NODE_ID) {
    return server;
  }

  const index = Math.max(0, clients.findIndex((candidate) => candidate.id === node.id));
  const count = Math.max(1, clients.length);
  const radiusX = clamp(Math.min(width * 0.3, radiusY * 1.9), 190, Math.max(190, width / 2 - 78));
  const denseT = Math.max(0, count - 10) / 14;
  const topGap = lerp(120, 82, denseT);
  const start = -90 + topGap / 2;
  const span = 360 - topGap;
  const angle = radians(start + ((index + 0.5) / count) * span);

  return {
    x: clamp(centerX + Math.cos(angle) * radiusX, 54, Math.max(54, width - 54)),
    y: clamp(centerY + Math.sin(angle) * radiusY, server.y + 78, Math.max(server.y + 78, height - 48)),
  };
}

function overviewNodePosition(
  node: TopologyNode,
  nodes: TopologyNode[],
  width: number,
  height: number,
) {
  const clients = nodes.filter((candidate) => candidate.kind === 'client');
  if (clients.length <= OVERVIEW_FAN_CLIENT_LIMIT) {
    return overviewFanPosition(node, clients, width, height);
  }
  return overviewRingPosition(node, clients, width, height);
}

function focusAnchorPosition(width: number, height: number) {
  const activeY = clamp(height * 0.42, 132, Math.max(132, height - 150));
  const serverGap = clamp(height * 0.22, 72, 112);
  return {
    active: {
      x: width / 2,
      y: activeY,
    },
    server: {
      x: width / 2,
      y: clamp(activeY - serverGap, 58, Math.max(58, activeY - 72)),
    },
  };
}

function focusFanPosition(
  node: TopologyNode,
  peers: TopologyNode[],
  active: { x: number; y: number },
  width: number,
  height: number,
) {
  const index = Math.max(0, peers.findIndex((candidate) => candidate.id === node.id));
  const count = Math.max(1, peers.length);
  const fanT = count <= 2 ? 0 : (count - 2) / (FOCUS_FAN_CLIENT_LIMIT - 2);
  const spread = radians(count === 1 ? 0 : lerp(52, 150, fanT));
  const angle = Math.PI / 2 + (count === 1 ? 0 : (index / (count - 1) - 0.5) * spread);
  const maxRadius = Math.max(96, height - active.y - 54);
  const radius = clamp(Math.min(width * 0.22, height * 0.3), 96, maxRadius);

  return {
    x: clamp(active.x + Math.cos(angle) * radius, 54, Math.max(54, width - 54)),
    y: clamp(active.y + Math.sin(angle) * radius, active.y + 84, Math.max(active.y + 84, height - 48)),
  };
}

function focusRingPosition(
  node: TopologyNode,
  peers: TopologyNode[],
  active: { x: number; y: number },
  width: number,
  height: number,
) {
  const index = Math.max(0, peers.findIndex((candidate) => candidate.id === node.id));
  const count = Math.max(1, peers.length);
  const radiusY = clamp(Math.min(height * 0.22, width * 0.13), 84, Math.max(84, height - active.y - 56));
  const radiusX = clamp(Math.min(width * 0.28, radiusY * 2.1), 180, Math.max(180, width / 2 - 72));
  const centerY = clamp(active.y + radiusY * 0.95, active.y + 96, Math.max(active.y + 96, height - 52));
  const start = 24;
  const span = 132;
  const angle = radians(start + ((index + 0.5) / count) * span);

  return {
    x: clamp(active.x + Math.cos(angle) * radiusX, 54, Math.max(54, width - 54)),
    y: clamp(centerY + Math.sin(angle) * radiusY, active.y + 84, Math.max(active.y + 84, height - 48)),
  };
}

function focusNodePosition(
  node: TopologyNode,
  nodes: TopologyNode[],
  pinnedId: string,
  width: number,
  height: number,
) {
  const { active, server } = focusAnchorPosition(width, height);
  if (node.id === pinnedId) {
    return active;
  }
  if (node.id === SERVER_NODE_ID) {
    return server;
  }

  const peers = nodes
    .filter((candidate) => candidate.kind === 'client' && candidate.id !== pinnedId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (peers.length <= FOCUS_FAN_CLIENT_LIMIT) {
    return focusFanPosition(node, peers, active, width, height);
  }
  return focusRingPosition(node, peers, active, width, height);
}

function initialNodePosition(
  node: TopologyNode,
  nodes: TopologyNode[],
  pinnedId: string,
  width: number,
  height: number,
) {
  if (pinnedId === SERVER_NODE_ID) {
    return overviewNodePosition(node, nodes, width, height);
  }
  return focusNodePosition(node, nodes, pinnedId, width, height);
}

export function TopologyCanvas({
  graph,
  trafficSnapshot,
  focusId,
  hoveredTunnelId,
  onHoverTunnel,
  onFocusChange,
  isFullscreen,
  onToggleFullscreen,
}: {
  graph: TopologyGraph;
  trafficSnapshot: TopologyTrafficSnapshot;
  focusId: string | null;
  hoveredTunnelId: string | null;
  onHoverTunnel: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodePosRef = useRef(new Map<string, SimNode>());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pinnedIdRef = useRef<string>(SERVER_NODE_ID);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize((previous) => {
          if (previous.width === rect.width && previous.height === rect.height) {
            return previous;
          }
          return { width: rect.width, height: rect.height };
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const effectiveFocusId = focusId !== null
    && focusId !== SERVER_NODE_ID
    && graph.nodes.some((node) => node.id === focusId)
    ? focusId
    : null;
  const effectiveHoveredTunnelId = effectiveFocusId ? hoveredTunnelId : null;

  useEffect(() => {
    if (!effectiveFocusId && hoveredTunnelId) {
      onHoverTunnel(null);
    }
  }, [effectiveFocusId, hoveredTunnelId, onHoverTunnel]);

  const visibleNodes = useMemo(() => {
    if (!effectiveFocusId) {
      return graph.nodes;
    }
    const keep = getTopologyNeighborIds(graph, effectiveFocusId);
    keep.add(effectiveFocusId);
    keep.add(SERVER_NODE_ID);
    return graph.nodes.filter((node) => keep.has(node.id));
  }, [graph, effectiveFocusId]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  }, [graph, visibleNodes]);

  const viewState = useMemo<TopologyViewState>(() => ({
    focusId: effectiveFocusId,
    hoverNodeId,
    hoveredTunnelId: effectiveHoveredTunnelId,
  }), [effectiveFocusId, effectiveHoveredTunnelId, hoverNodeId]);

  const controlNodes = useMemo(
    () => visibleNodes.filter((node) => node.kind === 'client' && shouldRenderControlLink(node.id, viewState)),
    [viewState, visibleNodes],
  );

  const edgeOffsets = useMemo(() => computeEdgeOffsets(visibleEdges), [visibleEdges]);

  const tunnelCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1);
      counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1);
    }
    return counts;
  }, [graph]);

  // 结构签名：只有拓扑结构真正变化时才重启力导向模拟，
  // 避免周期性的 stats 刷新导致画面持续抖动。
  const structureSignature = useMemo(() => {
    const nodesPart = visibleNodes.map((node) => `${node.id}:${node.online ? 1 : 0}`).join(',');
    const edgesPart = visibleEdges.map((edge) => `${edge.id}:${edge.sourceId}>${edge.targetId}`).join(',');
    return `${nodesPart}|${edgesPart}`;
  }, [visibleNodes, visibleEdges]);

  const visibleNodesRef = useRef(visibleNodes);
  visibleNodesRef.current = visibleNodes;
  const visibleEdgesRef = useRef(visibleEdges);
  visibleEdgesRef.current = visibleEdges;
  const edgeOffsetsRef = useRef(edgeOffsets);
  edgeOffsetsRef.current = edgeOffsets;

  const { width, height } = size;

  // 缩放 / 平移
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const svg = select(svgElement);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.5])
      .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
        if (event.type === 'dblclick') return false;
        return !(event as MouseEvent).button;
      })
      .on('zoom', (event) => {
        select(sceneRef.current).attr('transform', event.transform.toString());
      });
    svg.call(behavior);
    zoomRef.current = behavior;
    return () => {
      svg.on('.zoom', null);
      zoomRef.current = null;
    };
  }, []);

  // 力导向模拟
  useLayoutEffect(() => {
    if (!width || !height) return;
    setLayoutReady(false);

    const cx = width / 2;
    const cy = height / 2;
    const ringRadius = Math.max(Math.min(width, height) / 2 - 86, 76);
    const nodePos = nodePosRef.current;

    const nodes = visibleNodesRef.current;
    const edges = visibleEdgesRef.current;
    const pinnedId = effectiveFocusId ?? SERVER_NODE_ID;
    const isOverviewLayout = pinnedId === SERVER_NODE_ID;
    const targetPositions = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
      targetPositions.set(
        node.id,
        initialNodePosition(node, nodes, pinnedId, width, height),
      );
    }
    const linkEndpointId = (endpoint: SimLink['source']) => {
      if (typeof endpoint === 'string') return endpoint;
      if (typeof endpoint === 'number') return String(endpoint);
      return endpoint?.id ?? '';
    };
    const targetDistance = (sourceId: string, targetId: string, fallback: number) => {
      const source = targetPositions.get(sourceId);
      const target = targetPositions.get(targetId);
      if (!source || !target) {
        return fallback;
      }
      return Math.max(72, Math.hypot(target.x - source.x, target.y - source.y));
    };
    // 进入聚焦态时保留旧坐标，让节点平滑移动；
    // 全览模式每次重启模拟都按目标重播种，避免旧焦点坐标污染扇形布局。
    const layoutChanged = pinnedIdRef.current !== pinnedId;
    const reseedAll = isOverviewLayout;
    pinnedIdRef.current = pinnedId;
    let disposed = false;
    let sceneSettled = false;

    const simNodes = nodes.map((node) => {
      let sim = nodePos.get(node.id);
      if (!sim) {
        const position = targetPositions.get(node.id)
          ?? initialNodePosition(node, nodes, pinnedId, width, height);
        sim = {
          id: node.id,
          x: position.x,
          y: position.y,
        };
        nodePos.set(node.id, sim);
      } else if (layoutChanged || reseedAll) {
        if (reseedAll) {
          const position = targetPositions.get(node.id)
            ?? initialNodePosition(node, nodes, pinnedId, width, height);
          sim.x = position.x;
          sim.y = position.y;
        }
        sim.vx = 0;
        sim.vy = 0;
      }
      sim.fx = null;
      sim.fy = null;
      return sim;
    });
    const pinned = nodePos.get(pinnedId);
    const pinnedTarget = targetPositions.get(pinnedId) ?? { x: cx, y: cy };
    if (pinned) {
      pinned.fx = pinnedTarget.x;
      pinned.fy = pinnedTarget.y;
    }
    if (!isOverviewLayout) {
      const server = nodePos.get(SERVER_NODE_ID);
      const serverTarget = targetPositions.get(SERVER_NODE_ID);
      if (server && serverTarget) {
        server.fx = serverTarget.x;
        server.fy = serverTarget.y;
      }
    }

    const simLinks: SimLink[] = [];
    for (const node of nodes) {
      if (node.kind === 'client' && (isOverviewLayout || node.id === pinnedId)) {
        simLinks.push({ source: SERVER_NODE_ID, target: node.id, kind: 'control' });
      }
    }
    const seenPairs = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceId === SERVER_NODE_ID || edge.targetId === SERVER_NODE_ID) continue;
      const key = edge.sourceId < edge.targetId
        ? `${edge.sourceId}|${edge.targetId}`
        : `${edge.targetId}|${edge.sourceId}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      simLinks.push({ source: edge.sourceId, target: edge.targetId, kind: 'c2c' });
    }

    const ticked = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (const sim of simNodes) {
        sim.x = Math.max(34, Math.min(width - 34, sim.x ?? cx));
        sim.y = Math.max(38, Math.min(height - 46, sim.y ?? cy));
      }
      const sceneSel = select(scene);
      sceneSel.select('[data-layer="nodes"]')
        .selectAll<SVGGElement, unknown>('[data-node-id]')
        .attr('transform', function positionNode() {
          const sim = nodePos.get(this.dataset.nodeId ?? '');
          return sim ? `translate(${sim.x},${sim.y})` : null;
        });

      const server = nodePos.get(SERVER_NODE_ID);
      sceneSel.selectAll<SVGPathElement, unknown>('[data-control-id]')
        .attr('d', function controlPath() {
          const client = nodePos.get(this.dataset.controlId ?? '');
          if (!client || !server) return null;
          return `M ${server.x} ${server.y} L ${client.x} ${client.y}`;
        });
      sceneSel.selectAll<SVGGElement, unknown>('[data-control-label]')
        .attr('transform', function positionControlLabel() {
          const client = nodePos.get(this.dataset.controlLabel ?? '');
          if (!client || !server) return null;
          const midpointX = ((server.x ?? cx) + (client.x ?? cx)) / 2;
          const midpointY = ((server.y ?? cy) + (client.y ?? cy)) / 2;
          return `translate(${midpointX},${midpointY})`;
        });

      const offsets = edgeOffsetsRef.current;
      const edgeList = visibleEdgesRef.current;
      const geometryById = new Map<string, ReturnType<typeof computeQuadraticEdge>>();
      const flowGeometryById = new Map<string, ReturnType<typeof computeQuadraticEdge>>();
      const flowEndpointsById = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
      for (const edge of edgeList) {
        const source = nodePos.get(edge.sourceId);
        const target = nodePos.get(edge.targetId);
        const flowSource = nodePos.get(edge.flowSourceId);
        const flowTarget = nodePos.get(edge.flowTargetId);
        if (!source || !target) continue;
        geometryById.set(edge.id, computeQuadraticEdge(
          edge.sourceId,
          edge.targetId,
          { x: source.x ?? cx, y: source.y ?? cy },
          { x: target.x ?? cx, y: target.y ?? cy },
          offsets.get(edge.id) ?? 0,
        ));
        if (flowSource && flowTarget) {
          flowEndpointsById.set(edge.id, {
            x1: flowSource.x ?? cx,
            y1: flowSource.y ?? cy,
            x2: flowTarget.x ?? cx,
            y2: flowTarget.y ?? cy,
          });
          flowGeometryById.set(edge.id, computeQuadraticEdge(
            edge.flowSourceId,
            edge.flowTargetId,
            { x: flowSource.x ?? cx, y: flowSource.y ?? cy },
            { x: flowTarget.x ?? cx, y: flowTarget.y ?? cy },
            offsets.get(edge.id) ?? 0,
          ));
        }
      }
      select(svgRef.current)
        .selectAll<SVGLinearGradientElement, unknown>('[data-edge-gradient]')
        .each(function updateFlowGradient() {
          const endpoints = flowEndpointsById.get(this.dataset.edgeGradient ?? '');
          if (!endpoints) return;
          select(this)
            .attr('x1', endpoints.x1)
            .attr('y1', endpoints.y1)
            .attr('x2', endpoints.x2)
            .attr('y2', endpoints.y2);
        });
      sceneSel.selectAll<SVGGElement, unknown>('[data-edge-id]').each(function updateEdge() {
        const geometry = geometryById.get(this.dataset.edgeId ?? '');
        if (!geometry) return;
        const flowGeometry = flowGeometryById.get(this.dataset.edgeId ?? '') ?? geometry;
        const group = select(this);
        group.selectAll('[data-edge-path="base"], [data-edge-path="hit"]').attr('d', geometry.path);
        group.selectAll('[data-edge-path="flow"]').attr('d', flowGeometry.path);
      });
      sceneSel.selectAll<SVGGElement, unknown>('[data-edge-label]')
        .attr('transform', function positionLabel() {
          const geometry = geometryById.get(this.dataset.edgeLabel ?? '');
          return geometry ? `translate(${geometry.midpoint.x},${geometry.midpoint.y})` : null;
        });

      if (!sceneSettled) {
        sceneSettled = true;
        if (!disposed) {
          setLayoutReady(true);
        }
      }
    };

    const simulation = forceSimulation<SimNode>(simNodes)
      .force('charge', forceManyBody<SimNode>().strength(isOverviewLayout ? -90 : -120))
      .force('collide', forceCollide<SimNode>(46))
      .force('link', forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => targetDistance(
          linkEndpointId(link.source),
          linkEndpointId(link.target),
          link.kind === 'c2c' ? Math.min(180, ringRadius * 1.15) : ringRadius,
        ))
        .strength((link) => (
          link.kind === 'c2c'
            ? (isOverviewLayout ? 0.035 : 0.025)
            : (isOverviewLayout ? 0.025 : 0.028)
        )))
      .force('x', forceX<SimNode>((node) => targetPositions.get(node.id)?.x ?? cx).strength(isOverviewLayout ? 0.12 : 0.32))
      .force('y', forceY<SimNode>((node) => targetPositions.get(node.id)?.y ?? cy).strength(isOverviewLayout ? 0.12 : 0.36))
      .alpha(isOverviewLayout ? 0.24 : 0.32)
      .alphaDecay(0.16)
      .velocityDecay(0.65)
      .on('tick', ticked);

    simRef.current = simulation;
    ticked();

    return () => {
      disposed = true;
      simulation.stop();
      simRef.current = null;
    };
  }, [structureSignature, effectiveFocusId, width, height]);

  // 节点拖拽
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const nodePos = nodePosRef.current;
    const behavior = drag<SVGGElement, unknown>()
      .clickDistance(5)
      .on('start', function dragStart(event) {
        event.sourceEvent?.stopPropagation();
        const sim = nodePos.get(this.dataset.nodeId ?? '');
        if (!sim) return;
        simRef.current?.alphaTarget(0.25).restart();
        sim.fx = sim.x;
        sim.fy = sim.y;
      })
      .on('drag', function dragMove(event) {
        const sim = nodePos.get(this.dataset.nodeId ?? '');
        if (!sim) return;
        sim.fx = event.x;
        sim.fy = event.y;
      })
      .on('end', function dragEnd() {
        simRef.current?.alphaTarget(0);
        const id = this.dataset.nodeId ?? '';
        const sim = nodePos.get(id);
        if (!sim) return;
        if (id !== pinnedIdRef.current) {
          sim.fx = null;
          sim.fy = null;
        }
      });
    select(svgElement)
      .selectAll<SVGGElement, unknown>('[data-node-id]')
      .call(behavior);
  }, [structureSignature]);

  const hoverNeighborIds = useMemo(
    () => (hoverNodeId ? getTopologyNeighborIds(graph, hoverNodeId) : null),
    [graph, hoverNodeId],
  );

  const nodeOpacity = (node: TopologyNode) => {
    if (!hoverNodeId || node.id === hoverNodeId) return 1;
    if (node.id === SERVER_NODE_ID || hoverNeighborIds?.has(node.id)) return 1;
    return 0.3;
  };

  const edgeOpacity = (edge: TopologyEdge) => {
    if (effectiveHoveredTunnelId) return edge.id === effectiveHoveredTunnelId ? 1 : 0.12;
    if (hoverNodeId) return topologyEdgeTouches(edge, hoverNodeId) ? 1 : 0.15;
    if (effectiveFocusId) return topologyEdgeTouches(edge, effectiveFocusId) ? 0.95 : 0.35;
    return 0.85;
  };

  const zoomBy = (factor: number) => {
    const svgElement = svgRef.current;
    if (!svgElement || !zoomRef.current) return;
    zoomRef.current.scaleBy(select(svgElement).transition().duration(200), factor);
  };

  const resetView = () => {
    const svgElement = svgRef.current;
    if (!svgElement || !zoomRef.current) return;
    zoomRef.current.transform(select(svgElement).transition().duration(280), zoomIdentity);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-w-0 flex-1 overflow-hidden',
        isFullscreen ? 'h-full' : 'h-[340px] sm:h-[460px]',
      )}
    >
      {/* 画布背景 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-white dark:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{
          background: '#ffffff',
          backgroundImage: `
            radial-gradient(
              circle at top center,
              rgba(56, 193, 182, 0.25),
              transparent 50%
            )
          `,
          filter: 'blur(200px)',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-black dark:block"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120, 180, 255, 0.5), transparent 70%), #000000',
        }}
      />

      <svg ref={svgRef} className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing">
        <defs>
          <filter id="topo-soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="topo-link-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* 每条隧道边一个 userSpaceOnUse 渐变，端点在 tick 中同步为 owner → ingress。 */}
          {visibleEdges.map((edge) => {
            const colors = EDGE_FLOW_COLORS[edge.status.key];
            return (
              <g key={`edge-gradients-${edge.id}`}>
                <linearGradient
                  id={`topo-edge-${edge.id}`}
                  data-edge-gradient={edge.id}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor={colors.start} stopOpacity="0.68" />
                  <stop offset="0.5" stopColor={colors.middle} stopOpacity="1" />
                  <stop offset="1" stopColor={colors.end} stopOpacity="0.72" />
                </linearGradient>
                <linearGradient
                  id={`topo-flow-${edge.id}`}
                  data-edge-gradient={edge.id}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor={colors.start} stopOpacity="0.32" />
                  <stop offset="0.42" stopColor={colors.spark} stopOpacity="1" />
                  <stop offset="0.62" stopColor={colors.middle} stopOpacity="1" />
                  <stop offset="1" stopColor={colors.end} stopOpacity="0.36" />
                </linearGradient>
                <marker
                  id={`topo-arrow-${edge.id}`}
                  viewBox="0 0 12 12"
                  refX="10"
                  refY="6"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M2 2 L10 6 L2 10 Z" fill={colors.spark} opacity="0.92" />
                </marker>
              </g>
            );
          })}
        </defs>

        <rect
          width="100%"
          height="100%"
          fill="transparent"
        />

        <g
          ref={sceneRef}
          style={{ opacity: layoutReady ? 1 : 0 }}
        >
          <g data-layer="links">
            {controlNodes.map((node) => {
              const rate = trafficSnapshot.clientRates.get(node.id);
              const emphasis = getControlLinkEmphasis(node.id, viewState);
              const active = hasTraffic(rate);
              return (
                <g
                  key={`control-${node.id}`}
                  className="transition-opacity duration-300"
                  style={{ opacity: emphasisOpacity(emphasis) }}
                >
                  <path
                    data-control-id={node.id}
                    fill="none"
                    strokeWidth={trafficStrokeWidth(rate, emphasis === 'strong' ? 1.85 : 0.85, emphasis)}
                    strokeDasharray="2 6"
                    strokeLinecap="round"
                    className={cn(
                      'transition-[stroke-width,opacity] duration-300',
                      node.online ? 'stroke-emerald-500/60' : 'stroke-muted-foreground/40',
                    )}
                  />
                  {active && (
                    <path
                      data-control-id={node.id}
                      fill="none"
                      strokeLinecap="round"
                      strokeWidth={trafficStrokeWidth(rate, emphasis === 'strong' ? 2.6 : 1.5, emphasis)}
                      strokeDasharray="1.5 9"
                      className="stroke-primary"
                      style={{ animation: `topology-flow ${flowDuration(rate)} linear infinite` }}
                    />
                  )}
                </g>
              );
            })}
            {visibleEdges.map((edge) => {
              const emphasis = getTunnelEdgeEmphasis(edge, viewState);
              const rate = trafficSnapshot.tunnelRates.get(edge.id);
              const active = hasTraffic(rate);
              // 焦点模式下已建立的隧道即使没有流量也保留方向性流光
              // （重复流层的方向即 owner → ingress 的隧道发起方向）。
              const flowing = active
                || (emphasis === 'strong' && edge.status.key === 'exposed');
              const hovered = effectiveHoveredTunnelId === edge.id;
              const strokeWidth = trafficStrokeWidth(rate, hovered ? 2.45 : 1.55, emphasis);
              const streamWidth = Math.max(2.15, strokeWidth * 1.18);
              const streamOpacity = flowing ? 1 : 0;
              const streamDuration = tunnelStreamDuration(rate);
              return (
                <g
                  key={edge.id}
                  data-edge-id={edge.id}
                  className="transition-opacity duration-300"
                  style={{ opacity: edgeOpacity(edge) * emphasisOpacity(emphasis) }}
                >
                  <path
                    data-edge-path="base"
                    fill="none"
                    strokeLinecap="round"
                    strokeWidth={strokeWidth + 5}
                    className={EDGE_STROKE[edge.status.key]}
                    style={{ opacity: hovered ? 0.18 : 0.08 }}
                  />
                  <path
                    data-edge-path="base"
                    fill="none"
                    strokeLinecap="round"
                    strokeWidth={strokeWidth}
                    stroke={`url(#topo-edge-${edge.id})`}
                    className="transition-[stroke-width,opacity] duration-300"
                    style={{ opacity: hovered ? 0.48 : 0.28 }}
                  />
                  <path
                    data-edge-path="flow"
                    fill="none"
                    strokeLinecap="round"
                    strokeWidth={streamWidth}
                    stroke={`url(#topo-flow-${edge.id})`}
                    markerEnd={`url(#topo-arrow-${edge.id})`}
                    className="transition-opacity duration-300"
                    strokeDasharray="13 15"
                    style={{
                      animation: `topology-stream ${streamDuration} linear infinite`,
                      filter: flowing ? 'url(#topo-link-glow)' : undefined,
                      opacity: streamOpacity,
                    }}
                  />
                  <path
                    data-edge-path="hit"
                    fill="none"
                    stroke="transparent"
                    strokeLinecap="round"
                    strokeWidth={Math.max(16, strokeWidth + 12)}
                    pointerEvents={effectiveFocusId ? 'stroke' : 'none'}
                    onMouseEnter={() => {
                      if (effectiveFocusId) onHoverTunnel(edge.id);
                    }}
                    onMouseLeave={() => {
                      if (effectiveFocusId) onHoverTunnel(null);
                    }}
                  />
                </g>
              );
            })}
          </g>

          <g data-layer="nodes">
            {visibleNodes.map((node) => (
              <TopologyNodeView
                key={node.id}
                node={node}
                focused={effectiveFocusId === node.id}
                tunnelCount={tunnelCountByNode.get(node.id) ?? 0}
                opacity={nodeOpacity(node)}
                onClick={() => onFocusChange(
                  node.id === SERVER_NODE_ID || effectiveFocusId === node.id ? null : node.id,
                )}
                onHover={(hovering) => setHoverNodeId(hovering ? node.id : null)}
              />
            ))}
          </g>

          {/* 标签组始终挂载、由 tick 定位，仅用透明度控制可见性；
              否则模拟稳定后才出现的标签会停留在原点。 */}
          <g data-layer="labels" className="pointer-events-none">
            {controlNodes.map((node) => {
              const rate = trafficSnapshot.clientRates.get(node.id);
              const emphasis = getControlLinkEmphasis(node.id, viewState);
              const visible = !effectiveFocusId && hasTraffic(rate);
              return (
                <g
                  key={`control-label-${node.id}`}
                  data-control-label={node.id}
                  className="transition-opacity duration-300"
                  style={{ opacity: visible ? (emphasis === 'strong' ? 1 : 0.35) : 0 }}
                >
                  <text
                    textAnchor="middle"
                    dy={-6}
                    className="fill-primary font-mono text-[9px] transition-opacity duration-300"
                    style={LABEL_HALO}
                  >
                    {formatTrafficPair(rate)}
                  </text>
                </g>
              );
            })}
            {visibleEdges.map((edge) => {
              const rate = trafficSnapshot.tunnelRates.get(edge.id);
              const showTrafficLabel = hasTraffic(rate) || effectiveHoveredTunnelId === edge.id;
              const visible = getTunnelEdgeEmphasis(edge, viewState) === 'strong' && showTrafficLabel;
              return (
                <g
                  key={`edge-label-${edge.id}`}
                  data-edge-label={edge.id}
                  className="transition-opacity duration-300"
                  style={{ opacity: visible ? 1 : 0 }}
                >
                  {showTrafficLabel && (
                    <text
                      textAnchor="middle"
                      dy={-8}
                      className="fill-primary font-mono text-[9px]"
                      style={LABEL_HALO}
                    >
                      {formatTrafficPair(rate)}
                    </text>
                  )}
                  <text
                    textAnchor="middle"
                    dy={showTrafficLabel ? 6 : -5}
                    className="fill-muted-foreground font-mono text-[9px]"
                    style={LABEL_HALO}
                  >
                    {truncateLabel(edge.tunnel.name)}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* 返回全览 */}
      <div
        className={cn(
          'absolute left-3 top-3 z-20 transition-all duration-300',
          effectiveFocusId ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0',
        )}
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 border border-border/40 bg-background/80 px-2.5 text-xs shadow-sm backdrop-blur-sm hover:bg-background"
          onClick={() => onFocusChange(null)}
        >
          <Undo2 className="h-3.5 w-3.5" />
          {t('dashboard.topologyBack')}
        </Button>
      </div>

      {/* 缩放控件 */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col overflow-hidden rounded-lg border border-border/50 bg-background/80 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          className="flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={t('dashboard.topologyZoomIn')}
          onClick={() => zoomBy(1.3)}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center border-t border-border/40 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={t('dashboard.topologyZoomOut')}
          onClick={() => zoomBy(1 / 1.3)}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center border-t border-border/40 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={t('dashboard.topologyResetView')}
          onClick={resetView}
        >
          <LocateFixed className="size-3.5" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center border-t border-border/40 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={isFullscreen ? t('dashboard.topologyExitFullscreen') : t('dashboard.topologyFullscreen')}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>

      {/* 图例 */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-3 rounded-lg border border-border/40 bg-background/75 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t('tunnels.statusExposed')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {t('tunnels.statusOffline')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-destructive" />
          {t('tunnels.statusError')}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" strokeDasharray="2 4" strokeWidth="1.2" className="stroke-muted-foreground/70" />
          </svg>
          {t('dashboard.topologyControlLink')}
        </span>
      </div>
    </div>
  );
}

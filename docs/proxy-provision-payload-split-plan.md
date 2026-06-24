# Proxy Provision Payload Split Plan

## Summary

本计划是 `ProxyNewRequest` 与 unified provisioning/runtime 拆分的唯一范围说明。本次改造一次性完成，不拆二期三期；实现时如果需要调整范围，必须先更新本文档。

目标是让 unified tunnel provisioning 以 `TunnelProvisionRequest{Spec TunnelSpec}` 为唯一运行时 schema。`ProxyNewRequest` 退回 legacy create/provision 兼容边界，不再作为 unified runtime 的中间模型。`proxyRequestFromTunnelSpec` 必须删除。

本次不做数据库 schema 变更，不新增 migration，不改变现有 `tunnels` 表字段语义。

## Current Problem

当前代码已经有 unified provisioning 消息：

```text
TunnelProvisionRequest{TunnelID, Revision, Role, Spec TunnelSpec}
```

但 client target runtime 对 TCP/UDP 仍会执行：

```text
TunnelProvisionRequest.Spec -> proxyRequestFromTunnelSpec -> ProxyNewRequest -> c.proxies -> handleStream
```

这会把新模型重新降级回旧 fixed-target flat DTO。`proxyRequestFromTunnelSpec`（`internal/client/unified_tunnel.go:778`）只在 `handleTunnelProvision` 的 target role 非 SOCKS5 分支被调用（`unified_tunnel.go:311`）。SOCKS5 已经走独立 runtime 路径（`clientSOCKS5TargetRuntime`），ingress 侧也已完全基于 `TunnelProvisionRequest` / `TunnelSpec`，不经过 `ProxyNewRequest`。

问题边界：`ProxyNewRequest` 同时承担 client create request、legacy server provisioning payload、以及 unified target runtime config，导致后续 endpoint type 会继续被迫往旧 DTO 塞字段。

## Wire Protocol Facts

以下事实直接影响兼容设计，实现时必须遵守。

### 消息类型别名

`MsgTypeProxyProvision = MsgTypeTunnelProvision`（`pkg/protocol/message.go:39`）。它们在 wire 上是同一个字符串 `"tunnel_provision"`，不是两个独立消息类型。同理 `MsgTypeProxyCreate = MsgTypeTunnelCreate`、`MsgTypeProxyClose = MsgTypeTunnelUnprovision`。`MsgTypeProxy*` 只是源码兼容别名，wire 上不存在 "proxy provision" 和 "tunnel provision" 的区分。

### Client dual-dispatch

`internal/client/client.go:1190` 的 `MsgTypeProxyProvision`（= `MsgTypeTunnelProvision`）handler 内部有 dual-dispatch：

1. 先尝试从 payload 提取 `tunnel_id` 字段。如果存在，解析为 `TunnelProvisionRequest`，调用 `handleTunnelProvision`，回复 `MsgTypeTunnelProvisionAck`。
2. 如果 `tunnel_id` 不存在，解析为 flat `ProxyProvisionRequest`（= `ProxyNewRequest`），写入 `c.proxies`，回复 `MsgTypeProxyProvisionAck`。

这意味着同一个 wire 消息类型承载两种 payload 格式，由 `tunnel_id` 字段的有无来区分。

### Server 双路径

Server 侧有两条 provisioning 路径：

- **Unified 路径**：`notifyClientTunnelProvision`（`internal/server/client_relay.go:220`）发送 `MsgTypeTunnelProvision` + `TunnelProvisionRequest`。用于 server_expose（`server_expose_unified.go`）和 client_to_client（`client_relay.go`）。
- **Legacy 路径**：`notifyClientProxyProvision`（`internal/server/tunnel_manager.go:860`）发送 `MsgTypeProxyProvision`（= 同一个 wire type）+ flat `ProxyProvisionRequest`。用于 legacy managed tunnel 创建、恢复（`tunnel_manager.go` 的 `createManagedTunnel` / `prepareTunnelProvisionRequest`）。

两条路径在 wire 上使用相同的消息类型，区别只在 payload schema。

### Capability gating

Server 在 unified 路径的 reconcile 循环中通过 `capabilityIssuesForStoredTunnel`（`unified_tunnel_api.go:1388`）检查 client 是否支持 target/ingress type。`clientSupportsTargetType` / `clientSupportsIngressType` 对 nil capabilities 返回 false（`unified_tunnel_api.go:1158`）。老 client 不上报 capabilities（`ClientInfo.Capabilities` 为 nil），因此会被 capability gate 拒绝，不会收到不支持的 `TunnelProvisionRequest`。

### Target / Ingress type 枚举

Target types（`pkg/protocol/types.go:25-27`）：

- `TargetTypeTCPService` = `"tcp_service"`
- `TargetTypeUDPService` = `"udp_service"`
- `TargetTypeSOCKS5ConnectHandler` = `"socks5_connect_handler"`

Ingress types（`pkg/protocol/types.go:20-23`）：

- `IngressTypeTCPListen` = `"tcp_listen"`
- `IngressTypeUDPListen` = `"udp_listen"`
- `IngressTypeHTTPHost` = `"http_host"`
- `IngressTypeSOCKS5Listen` = `"socks5_listen"`

HTTP 是 ingress type，不是 target type。HTTP tunnel 的 target 是 `TargetTypeTCPService`，target 侧只需要 TCP dial 到本地 HTTP 服务，不涉及域名。域名属于 server ingress 层面。

## Implementation Scope

### 1. 新增 `clientTargetRuntime` struct

在 `internal/client/unified_tunnel.go` 中新增：

```go
type clientTargetRuntime struct {
    tunnelID          string
    revision          int64
    targetType        string // TargetTypeTCPService / TargetTypeUDPService
    targetHost        string
    targetPort        int
    transportPolicy   string
    actualTransport   string
    bandwidthSettings protocol.BandwidthSettings
}
```

用 `c.targetRuntimes sync.Map` 存储，keyed by `tunnelID`（与 `c.socks5Targets` 平行）。这个 struct 只保存 dial 配置，不包含 listener / packetConn / sourceCIDRs 等 ingress 相关字段。

Bandwidth settings 在本次仅作为 passthrough 字段保存在 runtime 中，不在 target 侧 `handleStream` / `handleUDPStream` 中应用带宽限制。当前代码的 target 侧 relay（`mux.Relay` / `mux.UDPRelay`）不带带宽限制，本次不改变这个行为。保留字段是为了与 `TunnelSpec` 保持字段对齐，并为未来 target 侧带宽限制预留。

### 2. 修改 `handleTunnelProvision` target 分支

当前逻辑（`unified_tunnel.go:305-321`）：

```text
switch req.Role:
case Target:
    if SOCKS5ConnectHandler -> socks5Targets.Store
    else -> proxyRequestFromTunnelSpec -> c.proxies.Store
```

改为：

```text
switch req.Role:
case Target:
    switch req.Spec.Target.Type:
    case SOCKS5ConnectHandler -> socks5Targets.Store (不变)
    case TCPService, UDPService -> 构造 clientTargetRuntime -> c.targetRuntimes.Store
    default -> reject
```

构造 `clientTargetRuntime` 的逻辑从 `proxyRequestFromTunnelSpec` 中提取，直接解析 `req.Spec.Target.Config` 获取 host/port，不再生成 `ProxyNewRequest`。`transportPolicy` 和 `actualTransport` 从 `req.Spec` 取，`bandwidthSettings` 从 `req.Spec.BandwidthSettings` 取。

### 3. 修改 `handleStream` target 侧匹配

当前 `handleStream`（`client.go:934`）的 target 匹配顺序：

```text
1. socks5TargetForDataStreamHeader -> handleSOCKS5TargetStream
2. proxyForDataStreamHeader -> dataStreamHeaderMatchesProxyConfig -> TCP dial / handleUDPStream
```

改为：

```text
1. socks5TargetForDataStreamHeader -> handleSOCKS5TargetStream (不变)
2. targetRuntimeForDataStreamHeader -> dataStreamHeaderMatchesTargetRuntime -> handleTargetStream
3. proxyForDataStreamHeader -> dataStreamHeaderMatchesProxyConfig -> legacy TCP dial / handleUDPStream (fallback)
```

新增函数：

```go
func (c *Client) targetRuntimeForDataStreamHeader(header protocol.DataStreamHeader) (clientTargetRuntime, bool)

func dataStreamHeaderMatchesTargetRuntime(header protocol.DataStreamHeader, rt clientTargetRuntime) bool
```

`dataStreamHeaderMatchesTargetRuntime` 检查：
- `header.TunnelID == rt.tunnelID`
- `header.Revision == rt.revision`
- `header.TargetRole == protocol.DataStreamRoleTarget`
- `header.SourceRole` 是 `Server` 或 `Ingress`
- `header.Direction == IngressToTarget`
- `header.Transport == ServerRelay`
- `rt.transportPolicy != DirectOnly`（与当前 `dataStreamHeaderMatchesProxyConfig` 一致）
- `rt.actualTransport` 为空或 `Unknown` 或与 `header.Transport` 一致

### 4. 新增 `handleTargetStream`

替代当前 `handleStream` 中 TCP dial 和 `handleUDPStream` 的 `ProxyNewRequest` 依赖：

```go
func (c *Client) handleTargetStream(stream *yamux.Stream, rt clientTargetRuntime)
```

根据 `rt.targetType` 分派：
- `TargetTypeTCPService`：`net.DialTimeout("tcp", host:port, 5s)` → `mux.Relay(stream, localConn)`
- `TargetTypeUDPService`：`net.Dial("udp", host:port)` → `mux.UDPRelay(stream, localConn)`

逻辑与当前 `handleStream` 中的 TCP 分支和 `handleUDPStream` 完全一致，只是参数来源从 `ProxyNewRequest` 变为 `clientTargetRuntime`。

### 5. 修改 `handleUDPStream` 签名

当前 `handleUDPStream(stream *yamux.Stream, cfg protocol.ProxyNewRequest)` 需要改为接受 `clientTargetRuntime` 或直接内联到 `handleTargetStream` 中。推荐内联，因为 `handleUDPStream` 只在 `handleStream` 中被调用一次，不存在复用需求。

如果选择保留独立函数，签名改为：

```go
func (c *Client) handleUDPStream(stream *yamux.Stream, rt clientTargetRuntime)
```

内部用 `rt.targetHost` / `rt.targetPort` 替代 `cfg.LocalIP` / `cfg.LocalPort`。

### 6. 修改 `handleTunnelUnprovision` target 分支

当前 `handleTunnelUnprovision`（`unified_tunnel.go:330`）的 target 清理：

```text
if Target or "":
    deleteSOCKS5TargetByTunnelUnprovision
    deleteProxyByTunnelUnprovision
```

改为：

```text
if Target or "":
    deleteSOCKS5TargetByTunnelUnprovision (不变)
    deleteTargetRuntimeByTunnelUnprovision (新增)
    deleteProxyByTunnelUnprovision (保留，只清理 legacy c.proxies)
```

新增 `deleteTargetRuntimeByTunnelUnprovision`，逻辑与 `deleteSOCKS5TargetByTunnelUnprovision` 平行：按 `tunnelID` 查找 `c.targetRuntimes`，检查 revision 覆盖关系，`CompareAndDelete`。

### 7. 删除 `proxyRequestFromTunnelSpec`

删除 `internal/client/unified_tunnel.go:778` 的 `proxyRequestFromTunnelSpec` 函数。

需要重写的直接依赖：

- `internal/client/unified_tunnel_test.go:585`（`TestClientTunnelUnprovisionDeletesLegacyProxyByTunnelID`）：该测试用 `proxyRequestFromTunnelSpec` 构造 legacy proxy 存入 `c.proxies`，测试 unprovision 清理。重写为直接构造 `ProxyNewRequest` 字面量存入 `c.proxies`，不再调用 `proxyRequestFromTunnelSpec`。

### 8. Protocol and DTO boundary

`pkg/protocol/message.go` 当前状态：

```go
type ProxyCreateRequest = ProxyNewRequest   // line 191
type ProxyProvisionRequest = ProxyNewRequest // line 194
```

本次保留别名关系不变。它们仍然是 `ProxyNewRequest` 的 type alias，继续用于 legacy wire path。通过注释和测试明确它们不属于 unified runtime schema。

`ProxyNewRequest` 不得新增 SOCKS5 dynamic target、target policy、ingress access policy、auth 等 endpoint-specific 字段。`pkg/protocol/message_test.go` 已有 `TestProxyNewRequestRemainsLegacyFlatSchema`（line 713）验证这一点，保留并扩展 forbidden 字段列表。

`TunnelProvisionRequest{Spec TunnelSpec}` 是 unified provisioning 的 canonical schema。

### 9. Server behavior

Server 侧本次不改动 provisioning 路径代码。现有的双路径保持不变：

- Unified 路径（server_expose / client_to_client）继续发送 `MsgTypeTunnelProvision` + `TunnelProvisionRequest`。
- Legacy 路径（managed tunnel create / restore / stop / ACK）继续发送 `MsgTypeProxyProvision` + flat `ProxyProvisionRequest`。

Server 侧以下函数/路径不在本次改动范围（但需要理解它们的边界）：

- `tunnel_ready.go` 的 `prepareTunnelProvisionRequest` / `waitForTunnelProvisionAck`：仍接收 `ProxyNewRequest`，服务 legacy 路径。
- `tunnel_manager.go` 的 `createManagedTunnel` / `notifyClientProxyProvision`：仍使用 `ProxyNewRequest` / `ProxyProvisionRequest`。
- `pkg/protocol/types.go` 的 `ProxyConfig.ToProxyNewRequest()`：仍用于 server 侧从 `ProxyConfig` 构造 legacy provision payload。
- `internal/server/store.go` 的 `StoredTunnel` 仍匿名嵌入 `ProxyNewRequest`：这是 storage 层的结构性依赖，本次不改。`ProxyNewRequest` 在 storage 层面仍然是 `StoredTunnel` 的字段载体（ID、Name、Type、LocalIP、LocalPort、RemotePort、BindIP、Domain）。本次的"脱离"仅限 client runtime 层面。

v1/v2 API 写路径统一不属于本次范围。

### 10. `ProxyConfigs` 字段

`internal/client/client.go:73` 的 `ProxyConfigs []protocol.ProxyNewRequest` 和 `e2e_test.go:83` 直接使用 `ProxyNewRequest`。这些是 client 启动时的静态 proxy 配置，走 `MsgTypeProxyCreate`（= `MsgTypeTunnelCreate`）路径，属于 legacy create 路径。本次不改动 `ProxyConfigs` 字段类型和 `e2e_test.go` 中的使用方式。

### 11. Client dual-dispatch 保留

`client.go:1190` 的 `MsgTypeProxyProvision` handler 内部的 dual-dispatch（先检查 `tunnel_id`，有则走 unified，无则走 legacy）在本次保留不变。这是 "老 server + 新 client" 兼容的关键机制：老 server 发送 flat `ProxyProvisionRequest`（无 `tunnel_id` 字段），新 client 走 legacy fallback 路径写入 `c.proxies`。

本次不清理这个 dual-dispatch，因为它是向后兼容的必要路径。未来如果 legacy `MsgTypeProxyProvision` flat payload 被完全移除，可以在此处简化，但不属于本次范围。

## Compatibility Matrix

必须覆盖以下组合；未覆盖的组合不能宣称兼容完成。

默认旧版本兼容基线为最新 stable tag `v0.1.8`。如果需要覆盖 beta，再单独扩展矩阵，但不能替代 stable 基线。

| 组合 | 期望行为 | 机制 |
|---|---|---|
| 新 server + 新 client + 新 tunnel | server_expose TCP/UDP/HTTP/SOCKS5、client_to_client TCP/UDP/SOCKS5 均走 unified runtime，数据面正常 | `TunnelProvisionRequest` → `clientTargetRuntime` / `clientSOCKS5TargetRuntime` / `clientTunnelRuntime` |
| 新 server + 新 client + 旧 tunnel | 旧 DB 中 TCP/UDP/HTTP tunnel 恢复后状态、数据转发、restart recovery 不变 | server_expose 旧 tunnel 走 unified restore 路径，target 侧用 `clientTargetRuntime` 替代 `c.proxies`；legacy managed tunnel 走 legacy restore 路径，target 侧仍用 `c.proxies` |
| 新 server + 老 client | legacy TCP/UDP/HTTP managed tunnel provisioning 仍可用；unified tunnel（server_expose / client_to_client）被 capability gate 拒绝 | 老 client 不上报 capabilities → `clientSupportsTargetType` 返回 false → reconcile 循环标记 error issue，不发送 `TunnelProvisionRequest` |
| 老 server + 新 client | 新 client 继续接受 flat `ProxyProvisionRequest`（无 `tunnel_id`），TCP/UDP/HTTP 数据面正常 | dual-dispatch fallback → `c.proxies` → legacy `handleStream` 路径 |
| 新 client -> 老 client (c2c) | client_to_client 能力不足时被 capability gate 阻止，不产生半在线 | `capabilityIssuesForStoredTunnel` 检查 target client capabilities |
| 老 client -> 新 client (c2c) | 同上 | 同上 |

### HTTP tunnel 补充

HTTP tunnel 的 target type 是 `TargetTypeTCPService`，ingress type 是 `IngressTypeHTTPHost`。HTTP 的域名匹配在 server ingress 层完成，target 侧只需要 TCP dial 到本地 HTTP 服务。因此：

- 新 server + 新 client + HTTP tunnel：target 侧走 `clientTargetRuntime`（与 TCP tunnel 完全一致），ingress 侧由 server 处理域名 dispatch。
- 老 server + 新 client + HTTP tunnel：老 server 发送 flat `ProxyProvisionRequest`（`Type: "http"`, `Domain: "..."`），新 client 走 legacy fallback，`c.proxies` 中保存的 `ProxyNewRequest` 包含 `Domain` 字段。`handleStream` 的 legacy fallback 路径对 HTTP tunnel 的处理与 TCP tunnel 一致（都是 TCP dial 到 `LocalIP:LocalPort`），`Domain` 字段在 client target 侧不参与 stream matching。

### 兼容基线 v0.1.8 的行为

v0.1.8 client 不上报 `ClientCapabilities`（`ClientInfo.Capabilities` 为 nil）。v0.1.8 client 的 `MsgTypeProxyProvision` handler 没有 dual-dispatch，只解析 flat `ProxyProvisionRequest`。v0.1.8 client 不认识 `TunnelProvisionRequest` 的 `tunnel_id` / `revision` / `role` / `spec` 字段结构。

因此新 server 不得向 v0.1.8 client 发送 `TunnelProvisionRequest` payload。Server 的 capability gate 已经处理了这一点：nil capabilities → `clientSupportsTargetType` 返回 false → 不 provision。

v0.1.8 server 发送的 flat `ProxyProvisionRequest` 不包含 `tunnel_id` 字段（`ProxyNewRequest` 没有 `tunnel_id` json tag，只有 `id`）。新 client 的 dual-dispatch 检查 `tunnel_id` 字段，不会匹配，因此走 legacy fallback。

## Detailed File Changes

### `internal/client/unified_tunnel.go`

1. 新增 `clientTargetRuntime` struct。
2. 新增 `clientTargetRuntime` 构造函数 `newClientTargetRuntime(req protocol.TunnelProvisionRequest) (clientTargetRuntime, error)`，解析 `req.Spec.Target.Config` 获取 host/port，从 `req.Spec` 取 transportPolicy / actualTransport / bandwidthSettings。
3. 修改 `handleTunnelProvision` target 分支：SOCKS5 不变，TCP/UDP 改为构造 `clientTargetRuntime` 并存入 `c.targetRuntimes`。
4. 修改 `handleTunnelUnprovision`：新增 `deleteTargetRuntimeByTunnelUnprovision`，在 target 清理中调用。
5. 删除 `proxyRequestFromTunnelSpec` 函数。

### `internal/client/client.go`

1. 在 `Client` struct 中新增 `targetRuntimes sync.Map` 字段（`tunnelID -> clientTargetRuntime`）。
2. 修改 `handleStream`：在 SOCKS5 检查之后、legacy proxy fallback 之前，新增 `targetRuntimeForDataStreamHeader` 查找和 `dataStreamHeaderMatchesTargetRuntime` 校验，匹配则调用 `handleTargetStream`。
3. 新增 `targetRuntimeForDataStreamHeader` 方法。
4. 新增 `dataStreamHeaderMatchesTargetRuntime` 函数。
5. 新增 `handleTargetStream` 方法，根据 `targetType` 分派 TCP dial 或 UDP relay。
6. `handleUDPStream` 保留但修改签名接受 `clientTargetRuntime`，或内联到 `handleTargetStream` 中。如果保留独立函数，`cfg.LocalIP` / `cfg.LocalPort` 改为 `rt.targetHost` / `rt.targetPort`。
7. `proxyForDataStreamHeader` 和 `dataStreamHeaderMatchesProxyConfig` 保留不变，继续服务于 legacy fallback 路径。
8. `ProxyConfigs` 字段、`requestProxy` / `requestProxyRuntime` / `applyProxyCreateResponse` 不变。
9. `MsgTypeProxyProvision` handler 的 dual-dispatch 保留不变。

### `internal/client/unified_tunnel_test.go`

1. 重写 `TestClientTunnelUnprovisionDeletesLegacyProxyByTunnelID`：不再调用 `proxyRequestFromTunnelSpec`，直接构造 `ProxyNewRequest` 字面量。
2. 新增测试：TCP target runtime 从 `TunnelProvisionRequest.Spec` 构造并存入 `c.targetRuntimes`，`handleStream` 能正确匹配并 dial。
3. 新增测试：UDP target runtime 从 `TunnelProvisionRequest.Spec` 构造，`handleStream` 能正确匹配并 relay UDP。
4. 新增测试：HTTP target（`TargetTypeTCPService` + `IngressTypeHTTPHost`）复用 TCP target runtime。
5. 新增测试：revision mismatch、wrong role、wrong direction、wrong transport 必须拒绝。
6. 新增测试：unprovision 按 tunnel id + revision 清理 `c.targetRuntimes`。
7. 新增测试：legacy `MsgTypeProxyProvision`（flat payload，无 `tunnel_id`）仍写入 `c.proxies`，`handleStream` legacy fallback 路径仍工作。
8. 现有 SOCKS5 target runtime 测试保持不变。
9. 现有 ingress runtime 测试保持不变。

### `pkg/protocol/message_test.go`

1. `TestProxyNewRequestRemainsLegacyFlatSchema`（line 713）保留并扩展 forbidden 字段列表（如已有则确认覆盖 `tunnel_id`、`revision`、`role`、`spec`、`allowed_target_cidrs` 等）。
2. `TunnelProvisionRequest` round-trip 测试覆盖 TCP / UDP / HTTP / SOCKS5 endpoint config（如已有则确认覆盖）。

### `internal/server` 测试

1. 确认 unified provision 消息 payload 是 `TunnelProvisionRequest`（现有测试已覆盖）。
2. 确认 legacy provision 消息 payload 是 flat `ProxyProvisionRequest`（现有测试已覆盖）。
3. 确认 server_expose 和 client_to_client provision/ack/reconcile 行为不变（现有测试应继续通过）。
4. 确认 capability gate 对 nil capabilities 的老 client 正确拒绝 unified provision（现有测试 `unified_tunnel_api_test.go` 已有覆盖）。

### `e2e_test.go`

不改动。`ProxyConfigs` 字段类型不变。

## Test Plan

### Unit and integration tests

见上方 Detailed File Changes 中的测试清单。

### System E2E

继续执行现有：

```bash
make test-system-e2e-nginx
make test-system-e2e-caddy
```

新增 compatibility E2E：

- 构建当前二进制和 `v0.1.8` 二进制或镜像。
- 覆盖 old-server/new-client：v0.1.8 server 创建 TCP/UDP/HTTP managed tunnel，new client 接收 flat `ProxyProvisionRequest`，数据面正常。
- 覆盖 new-server/old-client：new server 创建 legacy TCP/UDP/HTTP managed tunnel，v0.1.8 client 接收 flat `ProxyProvisionRequest`，数据面正常；new server 尝试创建 unified tunnel（server_expose / c2c），capability gate 拒绝 v0.1.8 client。
- 覆盖 mixed client_to_client participants：new client + old client 组合被 capability gate 阻止。
- 覆盖 old tunnel created by old server, then restored by new server：旧 DB 中 TCP/UDP/HTTP tunnel 在新 server 上恢复，数据面正常。

System E2E 是 server/client/runtime/data-path/restart 的主证明。Playwright 只证明 UI workflow，不作为跨版本兼容主证明。

### Minimum verification before merge

```bash
go test -tags dev ./internal/client ./internal/server ./pkg/protocol
make test-system-e2e-nginx
make test-system-e2e-caddy
```

如果改到前端或 UI 文案，再额外执行：

```bash
cd web && bun run build
make test-playwright-e2e-smoke
```

## Out of Scope

- 不做 v1/v2 API 写路径统一。
- 不做 P2P data transport policy。
- 不做 secret store。
- 不做 SOCKS5 UDP ASSOCIATE。
- 不做 `runtime_state active/exposed` 数据迁移。
- 不做 tunnel storage schema 重建。
- 不做 target 侧带宽限制（`clientTargetRuntime` 保存 `bandwidthSettings` 但不在 relay 中应用）。
- 不做 `ProxyCreateRequest` / `ProxyProvisionRequest` 别名拆分（保留 `= ProxyNewRequest` type alias）。
- 不做 `StoredTunnel` 嵌入 `ProxyNewRequest` 的解耦。
- 不做 `ProxyConfig.ToProxyNewRequest()` 的移除或重构。
- 不做 client dual-dispatch 的清理或简化。
- 不做 `ProxyConfigs` 字段类型变更。

## Acceptance Criteria

- unified TCP/UDP target runtime 不再依赖 `ProxyNewRequest`。
- unified SOCKS5 target runtime 不依赖 `ProxyNewRequest`（已满足，本次不改动）。
- unified ingress runtime 不依赖 `ProxyNewRequest`（已满足，本次不改动）。
- `proxyRequestFromTunnelSpec` 被删除。
- legacy `MsgTypeProxyProvision` flat payload 兼容路径仍可用（dual-dispatch fallback + `c.proxies` + `proxyForDataStreamHeader`）。
- 新旧版本兼容矩阵有可执行测试覆盖。
- 旧 TCP/UDP/HTTP tunnel 恢复和数据面行为不变。
- 没有新增 migration。
- `ProxyNewRequest` 未新增 endpoint-specific 字段。

# P2P data transport policy and placeholders

## Status

Open

## Severity

High

## Why it matters

client_to_client 数据通道未来应支持 `server_relay_only`、`direct_preferred`、`direct_only`。控制通道仍必须经 server，下述策略只针对数据通道。P2P 是 transport/data-channel selector 能力，不是 TCP/UDP/HTTP/SOCKS5 或未来 endpoint type 的类型内能力。

P2P 占位字段、direct policy 拒绝、UI unavailable 文案和未来 P2P 实现必须放在同一个 issue 里处理；拆成“P2P 实现”和“P2P placeholder 清理”会制造重复待办。

## Current evidence

存储模型和 DTO 已有 `transport_policy`、`actual_transport`、`p2p_state` 等字段，`DataStreamHeader` 也已有 `transport` 字段，但 P2P 发送/接收实现尚未形成完整闭环。当前 `/api/tunnels` 创建阶段会拒绝非 `server_relay_only`，错误码为 `direct_transport_unavailable`。前端会把 direct/P2P 文案标为 unavailable；这些字段目前是 future-only 能力边界，不代表 P2P 数据面已经可用。

主要代码位置：

- `pkg/protocol/types.go` 的 transport/P2P 字段
- `internal/server/migrations/005_unified_tunnel_storage.sql`
- `internal/server/client_relay.go`
- `internal/server/unified_tunnel_reconcile.go`
- `pkg/protocol/stream_header.go`
- `internal/server/data.go`
- `internal/client/client.go`
- `web/src/lib/tunnel-model.ts`
- client 数据通道和 stream 打开路径

## Recommended direction

先抽象统一 data-channel/transport selector：上层 tunnel runtime 只表达从 ingress 到 target 打开数据流，底层根据 `transport_policy` 选择 `server_relay` 或 `peer_direct`。如果短期不实现 P2P，则继续把 direct policy 拒绝路径、UI unavailable 文案和 future-only 字段注释当作同一套保护边界维护，避免读代码者误判功能已可用。

当前 `/ws/data + yamux` 路径应作为 `server_relay` transport 被封装；P2P 实现应新增 `peer_direct` transport，并在同一套 selector/state machine 中处理候选收集、握手、fallback、direct_only 失败语义、TURN/relay 统计与 UI 展示。

## Why separate

当前实现仍限定 `server_relay_only`。P2P 是跨 server/client/protocol 的大设计，不能作为 endpoint 类型附带修改，也不能复制到每个隧道类型里。TCP/UDP/HTTP/SOCKS5 以及未来 endpoint type 应复用同一套数据通道选择逻辑。

## Validation needed

- relay only / preferred / only 三种策略行为明确。
- direct 失败时 fallback 或 error 符合策略。
- 控制通道始终经 server。
- 数据面统计能区分 transport。
- 同一套 transport selector 能服务 TCP/UDP/HTTP/SOCKS5 与未来 endpoint type，不能为每个类型重复实现 P2P。
- 文档与 UI 不暗示 P2P 已可用；未实现路径不可被用户配置触发。

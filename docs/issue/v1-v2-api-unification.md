# v1/v2 API 写路径统一

## Status

Partially fixed

## Severity

Low

## Why it matters

legacy v1 `/api/clients/{id}/tunnels` 与 unified v2 `/api/tunnels` 仍是两套 mutation 入口。统一 provisioning/runtime 侧已经不再依赖 legacy flat payload，但 legacy v1 API 和前端 fallback 还在。

## Current evidence

已完成：

- unified runtime/provision 已从 `TunnelSpec` endpoint 字段取语义，不再通过 `proxyRequestFromTunnelSpec` 降级成 legacy flat payload。
- server/client 都有 guard test 防止 unified runtime 重新依赖 `ProxyNewRequest`。

仍未完成：

- legacy v1 `/api/clients/{id}/tunnels` mutation 路由仍存在。
- `handleCreateTunnel` / update / stop / resume / delete 仍由 `ProxyNewRequest` 和 legacy tunnel manager 路径驱动。
- 前端创建 tunnel 时仍保留 `/api/tunnels` 失败后的 legacy fallback，用于旧 server 兼容。

主要代码位置：

- legacy v1 client tunnel API：`internal/server/admin_api.go` 及相关 tunnel manager 路径
- legacy mutation handlers：`internal/server/tunnel_api.go`
- unified v2 API：`internal/server/unified_tunnel_api.go`
- provisioning/ack 路径：`internal/server/tunnel_ready.go`
- frontend fallback：`web/src/hooks/use-tunnel-mutations.ts`

## Recommended direction

不要再把它当成“runtime/provision 未修复”的问题。剩余决策只是 legacy v1 mutation API 要不要继续保留：

- 如果还要兼容旧 server/旧管理入口，保留 v1，并明确它只支持 legacy TCP/UDP/HTTP 能力。
- 如果不再需要，删除前端 fallback 和 v1 mutation 路由，再用测试确认旧数据读取、停止、删除等兼容边界不受影响。

SOCKS5 和后续 endpoint 类型默认只支持 v2 `/api/tunnels` 创建；v1 若收到不可表达的类型，应返回清晰错误，而不是扩展 `ProxyNewRequest`。

## Why separate

完整删除 v1 mutation 会触及旧 API、管理面兼容、offline managed tunnel 和 upgrade/rollback 行为；但如果只收紧前端 fallback 或文档边界，风险较低。

## Validation needed

- v1/v2 创建同类 tunnel 结果一致。
- 错误码一致。
- revision 与 provisioning 行为一致。

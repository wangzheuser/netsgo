# tunnel_resource_locks 硬化

## Status

Open for optional DB constraint hardening

## Severity

Low

## Why it matters

资源锁冲突检测已经承担端口/host 互斥，但 `tunnel_resource_locks` 表缺少 FK 和 `resource_kind` CHECK。崩溃、旧 bug 或手工写库仍可能留下孤儿锁或非法 kind。

这不是当前功能缺口。正常 API 路径已经做了互斥检查和删除清理；剩余风险主要来自手工写库、历史脏数据或崩溃后不一致，所以优先级低。

## Current evidence

已完成：

- SOCKS5 listen 与普通 TCP listen 复用同一个 TCP resource key。
- server/client ingress 资源冲突在创建/更新前检查。
- hard delete 会删除对应 resource lock。

仍未完成：

- `tunnel_resource_locks` 当前包含 `resource_key`、`tunnel_id`、`resource_kind`、`client_id`、`created_at`，但未声明 FK。
- `resource_kind` 没有 DB CHECK。
- 没有针对脏数据迁移的明确策略：失败、清理、还是从 `tunnels` 重建。

主要代码位置：

- `internal/server/migrations/005_unified_tunnel_storage.sql`
- `internal/server/store.go` 的 resource lock 生成与写入逻辑
- `internal/server/storage_schema_test.go`
- `internal/server/unified_storage_test.go`

## Recommended direction

可选地做 DB constraint hardening。迁移必须先明确脏数据策略：迁移前检测并失败，或从 `tunnels` 表重建 locks。不要盲目 copy 旧 locks 到带约束的新表。

## Validation needed

- orphan lock 处理符合设计。
- unknown resource_kind 处理符合设计。
- cascade delete 生效。
- 资源锁可从 tunnels 重建且结果一致。

# 智能表情包 MCP（Supabase）

项目已绑定 Supabase Project Ref：`cqoevridrpdgqjyiksok`。

推送 `supabase/`、`tools/` 或部署工作流到 `main` 后，GitHub Actions 会：

1. 连接 Supabase 项目；
2. 执行数据库 migration，创建或更新 `sticker_catalog`；
3. 部署 `sticker-mcp` Edge Function；
4. 验证控制组图片和函数健康端点。

## 首次部署只需添加两个 Secrets

打开仓库：`Settings` → `Secrets and variables` → `Actions` → `New repository secret`。

- `SUPABASE_ACCESS_TOKEN`：在 Supabase Account → Access Tokens 创建专用 token。
- `SUPABASE_DB_PASSWORD`：该 Supabase 项目的数据库密码；不是 Supabase 登录密码。

不要把上述值写进源码、Issue、截图或聊天。Secrets 添加完成后，在仓库 `Actions` 页运行 **Deploy Sticker MCP**，或让我再提交一次无敏感信息的变更来触发。

## 部署地址

- 健康检查：`https://cqoevridrpdgqjyiksok.supabase.co/functions/v1/sticker-mcp`
- MCP：`https://cqoevridrpdgqjyiksok.supabase.co/functions/v1/sticker-mcp/mcp`
- 控制组图片：`https://cqoevridrpdgqjyiksok.supabase.co/storage/v1/object/public/stickers/funny/control.png`

`supabase/config.toml` 已将 `sticker-mcp` 的 `verify_jwt` 设置为 `false`，用于允许 ChatGPT 直接连接 MCP 端点。

## 批量导入

`tools/import_batch.py` 可批量上传图片并写入目录表。它使用 `SUPABASE_SERVICE_ROLE_KEY`，该 key 只应在本机临时环境变量或受保护的 CI Secret 中使用，绝不能提交到公开仓库。

## 直接上传自动同步

部署 `20260825010000_sync_storage_stickers.sql` 后，直接在 Supabase Dashboard
把 JPG、JPEG、PNG、GIF 或 WebP 上传到公开 Storage bucket `stickers` 即可：

1. Storage trigger 会立即在 `sticker_catalog` 创建稳定的 `st_auto_*` 记录；
2. 新记录先处于 `pending` 且不会混入搜索结果；
3. `search_stickers`/`inspect_pending_sticker` 会把待识别图片交给模型看图；
4. 模型调用 `save_sticker_metadata` 写入中文 OCR、画面描述、语义和标签后，记录变为 `ready` 并立刻可检索；
5. 覆盖同一路径会保留已整理的语义，删除 Storage 图片会自动停用目录记录。

文件名只需使用 Supabase 接受的小写英文、数字和路径字符；检索依赖目录表中的中文语义，不依赖文件名。单张图片上限为 12 MB。

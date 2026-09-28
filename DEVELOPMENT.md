# DEVELOPMENT.md — 开发笔记

本文件记录本仓库在维护过程中积累的、从代码本身不容易看出来的经验与约定。格式不做要求，但要求：读的人（包括后续的 AI 助手）不需要猜测上下文就能照做，且不会产生歧义。

本文件随仓库提交，长期维护。新踩到的坑、验证命令的变化、容易被误改的约定，都补到对应小节。

---

## 1. 语言基座：本项目只讲简体中文

这是本 fork 的既定决策，不是临时状态。

**前端**

- `web/src/i18n/locales/zh.json` 是唯一语言文件，同时充当**键基准**：键是英文源串（`t('Add metadata')`），值是中文文案。新增文案时只加这一份，不改调用点写法。
- 界面语言码固定为 `zhCN`（**不是**合法 BCP 47 标签）。任何进入 `Intl.*`、`toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` 或公共格式化函数的地方，必须先过 `toIntlLocale()`（`web/src/i18n/languages.ts`），它会返回 `zh-CN`；非法标签返回 `undefined`，交由运行环境默认值处理。lint 规则 `project/intl-locale` 是 error，禁止 disable。
- 没有语言切换器、没有语言偏好设置项、没有浏览器语言检测、没有 `i18next-browser-languagedetector`。`web/src/i18n/config.ts` 只注册 `zhCN` 一个 resource。
- `web/src/i18n/config.ts` 的 `init` 被 `if (!i18n.isInitialized)` 包住：生产环境它是唯一初始化点；测试环境由 `web/src/test-setup.ts` 先初始化，config 不再覆盖。**不要去掉这个 guard**，否则测试基座会被生产 resource 覆盖。
- `index.html` 的 `<html lang>` 是 `zh-CN`。

**后端**

- `i18n/locales/zh-CN.yaml` 是唯一消息文件，`i18n.LangZhCN = "zh-CN"` 是唯一语言常量，`i18n.T(c, key, args...)` 里的 `c` 只用于保持调用点统一，**不再参与语言选择**。
- 已删除：`middleware/i18n.go`（Accept-Language 协商）、`i18n.ParseAcceptLanguage` / `SupportedLanguages` / `IsSupported` / `GetLangFromContext` / `SetUserLangLoader`、`model.GetUserLanguage`、`dto.UserSetting.Language` 字段、`PUT /api/user/self {language}` 分支。
- `constant.ContextKeyLanguage` 仍存在，只服务于插件路由：`router/plugin-router.go` 把它固定写成 `i18n.LangZhCN`。插件路由测试断言这个键存在且为 `zh-CN`。
- `common/init.go` 的启动横幅不再声称支持多语言。

**故意保留的“多语言”**

- 插件与市场数据里的 `{ en, zh, zh-TW }` 文案是**数据契约**，不是界面语言支持：`web/src/lib/localized-text.ts`（`localeFallbackKeys`）和 `web/src/features/task-plugins/lib/plugin-changelog.ts`（`changelogLocale`）继续按 BCP 47 解析这些字段，`zhCN` 下优先 `zh`，再回退 `en`。**不要**把这些映射当作语言功能删掉。
- `constant.ChannelTypeNewAPI`（type 60，上游 kind `new_api`）是上游网关的协议标识，与语言无关，也不要改名。

---

## 2. 前端测试基座：为什么 bundle 是空的

`web/src/test-setup.ts`：

```ts
beforeAll: i18next.init({ lng: 'zhCN', fallbackLng: 'zhCN', nsSeparator: false,
                          resources: { zhCN: { translation: {} } } })
beforeEach: i18next.removeResourceBundle('zhCN', 'translation')
            i18next.addResourceBundle('zhCN', 'translation', {}, false, true)
```

要点：

1. **空 bundle = 键身份**。约 2000 条断言用 `t()` 的英文键定位元素（`getByRole('button', { name: 'Add metadata' })`）。空 bundle 让 `t('Add metadata')` 原样返回键，这些断言继续有效，同时语言仍然是发布的 `zhCN`。
2. **`addResourceBundle` 是合并语义，不是替换**。想清空 bundle 必须 `removeResourceBundle` 再 `addResourceBundle(..., {})`；只 `addResourceBundle(..., {})` 会保留旧键，表现为「某个用例加载过 `zh.json` 后，后面的用例突然找不到英文键」。`beforeEach` 里的那两行就是为此存在的，不要删。
3. **要断言真实中文文案的用例自己加载 bundle**：

   ```ts
   i18n.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
   ```

   `beforeEach`（setup 文件先注册）保证下一个用例又回到空 bundle，因此不需要在每个用例里手工清理。
4. 也有的测试文件用 `import zh from '@/i18n/locales/zh.json'` 后以 `lng: 'zh'` 起私有实例（`createInstance()`），它们与全局基座无关，可以照旧。
5. **`{ en, zh }` 数据与 `Intl` 输出受当前语言影响**：`resolveLocalizedText`（`@/lib/localized-text`）等 `{ en, zh }` 数据在 `zhCN` 下优先取 `zh`；星期、`2秒`、日期格式取自 `zh-CN`。这些断言写中文。只有当字段**只有 `en`**（或只有 `zh`）时才回退到那一种语言——这是仍有价值的老数据回退契约，测试要保留。（原先的主要消费者 `usageSchema.description` / `unitLabel` 已随任务插件一起删除。）

---

## 3. 常用验证命令与期望

在 `web/` 下：

| 命令 | 说明 |
| --- | --- |
| `bun run typecheck` | `tsgo -b`，必须 0 错误 |
| `bunx oxlint -c .oxlintrc.json <改动文件>` | 改动文件 0 error；warning 单独评估 |
| `bunx oxfmt --check <改动文件>` | 在 `web/` 下显式传路径**有效**，只检查列出的文件（实测传 6 个文件时输出 `Finished in 1110ms on 6 files`）。`bun run format:check` 不带路径会整库检查，当前因 20 个**既有**未格式化文件而失败；只要它们与本次改动文件**无交集**即可，不要去格式化它们 |
| `bun run test` | 全量 166 个文件，本机默认并行约 4 分钟 |
| `bunx vitest run --maxWorkers=8` | 全量串行度更高（约 4 分钟，20 核机器上 8 worker）；**需要一次稳定全绿时用这个**，见下 |
| `bunx vitest run <路径...>` | 定向验证，定位失败用这个 |
| `bun run build` | 生产构建，产物写入 `web/dist`（被 Go 侧 embed） |
| `bun run i18n:sync` | 校验 `zh.json` 与代码里的键是否一致，报告在 `web/src/i18n/locales/_reports/`（该目录被 gitignore） |

在仓库根：

| 命令 | 说明 |
| --- | --- |
| `go vet . ./i18n/... ./middleware/... ./controller/... ./model/... ./router/...` | 根模块类型检查（含测试文件），应为 0；**不要用 `./...`**，见下 |
| `go build -o %TEMP%\pg-api-check.exe .` | 验证主包可构建且嵌入新 `dist` |
| `go test ./i18n/... ./controller/... ./middleware/... ./model/... ./router/...` | 后端定向测试 |
| `cd relaykit && GOWORK=off go build ./...` | `relaykit` 必须能独立构建（改动 relaykit 时必做） |

已知不构成问题的现象：

- 在仓库根执行 `go vet ./...` / `go build ./...` 会走进 `web/node_modules`，报 `no Go files in .../@lit/reactive-element/development` 或 `open web\node_modules\@base-ui\react\drawer\virtual-keyboard-provider: The system cannot find the path specified`（Windows 路径长度）。这是 `./...` 扫进前端依赖的结果，与代码无关；按上表列出显式包路径。
- `gofmt -l` 在本仓库会对大量**未改动**文件报差异（本仓库的导入分组风格与 gofmt 期望不同）。判断是否引入问题，用 `gofmt -d <改动文件>` 看 hunk 是否落在自己改的区域。
- `bunx vitest run --reporter=basic` 会因 reporter 不存在而空跑，用默认 reporter。
- `cmd /c "bun run test > ..\_x.log 2>&1"` 这类重定向在本机不稳（日志文件可能不生成），失败排查直接看终端输出更可靠。
- 全量跑时 `channel-configuration`、`visual-billing-editor`、`viewer` 偶发超时（vitest `testTimeout: 20000`）：默认并行度在 20 核机器上会开满 20 个 worker，这几个重型 jsdom 用例在有竞争时可能超过 20s。三者单独 `bunx vitest run <文件>` 通过即视为环境抖动；要一次稳定全绿，用 `bunx vitest run --maxWorkers=8`（实测 166 文件 / 2091 用例全通过）。
- 在 Windows 上跑 `go test ./controller/...` 会出现大量 `--- FAIL`，失败原因是 `testing.go:1617: TempDir RemoveAll cleanup: unlinkat ...\audit.db: The process cannot access the file because it is being used by another process.`（SQLite 仍持有审计库句柄，`t.TempDir()` 清理失败），用例本身没有断言失败。用 `go test ./controller/ -run <用例名> -v` 看是否为该原因；这不是回归。

---

## 4. 本机工具环境的坑

- **不要用 PowerShell 写含中文或引号的文件内容**：`“ ”`、（）、引号会被 shell 解析破坏，`Get-Content` 读中文还会乱码。改文件用文件编辑工具，或写一次性 Node 脚本（`node apply-edits.mjs`）再删除脚本。
- `git grep` 的 pattern 里带反斜杠或引号在 PowerShell 下容易解析失败（`fatal: unable to resolve revision: ...`），换成不含引号的简单子串，或改用 grep 类工具。
- 提交信息里不要放双引号：PowerShell 会把 `\"` 当字符串结束，`git commit -m "..."` 会把消息碎片当成 pathspec（报 `fatal: Invalid path '/en'`）。用 here-string（`@'...'@`）传消息体。
- 前端包管理统一用 `bun`。
- 评测/构建会锁住 `web/dist`；先构建再跑需要读 dist 的检查。`main.go` 用 `//go:embed web/dist/index.html`，所以 `go vet .` / `go build .` 在 `web/dist` 不存在（例如尚未构建，或 rsbuild 正在重建、目标目录被清空的瞬间）会直接报 `pattern web/dist/index.html: no matching files found`——先跑完 `bun run build`，再跑 Go 侧检查；反之两者不要并行。

---

## 5. 后续加文案的流程

**前端**：在调用点写 `t('English source key')`，把键与中文值加到 `web/src/i18n/locales/zh.json`（如用 `static-keys.ts` 提取，同步登记），跑 `bun run i18n:sync` 确认没有缺失键。不需要（也不允许）新增其它语言文件。

**后端**：在 `i18n/keys.go` 加 `Msg*` 常量，在 `i18n/locales/zh-CN.yaml` 加对应中文值，调用处继续用 `common.ApiErrorI18n(c, i18n.MsgXxx)` / `i18n.T(c, ...)`；`c` 参数保留，但语言是固定的。

**测试**：按键或角色定位元素；需要断言真实文案时按第 2 节加载 bundle；插件数据/`Intl` 输出按第 2 节第 5 条写中文期望。

---

## 6. 相关变更历史

- 2026-09-28：**修复「游乐场」在高级自定义渠道（type 58 / VLLM / SGLang）下必然 503 `无可用渠道`**。现象：设备 19:04:22 的请求 `202609281104223407016002515fbcfIBSUGf1X` 在 `/pg/chat/completions` 上 1.5ms 返回 503 `分组 测试 下模型 deepseek-v4.1-flash 无可用渠道（distributor）`，而同一渠道走 `/v1/chat/completions`（直连下游 Agent）正常。根因：`/pg/chat/completions` 只是 `/v1/chat/completions` 的内部别名（`relay/common/relay_info.go` 一直把 `info.RequestURLPath` 从 `/pg` 改写成 `/v1`），但两处「按请求路径做渠道决策」的代码读的是原始 URL，而高级自定义渠道的 `advanced_routes` 只会声明 `/v1/...`：一是 `middleware/distributor.go` 的 `FilterRequestPath` 用 `c.Request.URL.Path` 过滤候选渠道，`/pg/chat/completions` 匹配不上任何路由，于是所有高级自定义渠道在游乐场里都被滤掉（连 default 分组那个确实声明了 chat 路由的渠道也一样）；二是 `relay/channel/advancedcustom/adaptor.go` 的 `incomingRequestPath()` 同样优先取 `c.Request.URL.Path`，即使选出了渠道，`resolve()` 也会报 `advanced custom channel does not support request path /pg/chat/completions for model ...`。该过滤器由上游 `eb48396d5` 引入，`upstream/main` 这两处写法相同，属同源缺陷而非本 fork 引入。**修复**：`relay/constant` 新增 `PlaygroundPathPrefix` 与 `PublicRequestPath()`（`/pg/...` → `/v1/...`，其余原样返回；`Path2RelayMode` 改用它，去掉重复的别名字面量），`middleware/distributor.go` 的路径过滤器与 `advancedcustom` 的 `incomingRequestPath()` 都改经它归一化。**故意不动** `relay/common/relay_info.go` 中「按路由 `pass_through_body_enabled` 提升渠道级透传」的那段（仍按原始路径判断）：游乐场请求体带路由字段 `group`，一旦走透传会把它原样发给上游，保持转换路径（解析后重新序列化）会把 `group` 丢掉，更安全。**设备上还有第二个与代码无关的原因**：`测试` 分组的唯一渠道 `All Tokens`（id 2，type 58）只声明了 `/v1/responses` 与 `/v1/models`，没有 chat 路由，因此这个「分组 + 模型」在 `/v1/chat/completions` 上也一样 503——游乐场修复后与 API 行为一致；要让它可用，需在该渠道补一条 chat 路由（上游只支持 Responses 时用转换器 `openai_chat_completions_to_openai_responses` 指向 `/v1/responses`）。另外 `/api/user/models` 是按渠道 `models` 字段列模型的、与路由无关，所以仍会列出这个无法承载 chat 的模型。**回归测试**：`middleware/distributor_playground_path_test.go`（游乐场路径必须命中已声明的 chat 路由、`/v1` 路径行为不变、只声明 responses 路由时仍拒绝）与 `relay/channel/advancedcustom/adaptor_test.go` 新增 `TestAdaptorResolvesPlaygroundPathAgainstPublicRoutes`（同样三条用例，断言解析出的上游路径）。**验证**：`go build ./middleware/... ./relay/... ./controller/...` 与改动包的 `go vet` 干净；`go test ./middleware/ ./relay/constant/ ./relay/channel/advancedcustom/ ./relay/common/` 通过；把设备库副本接进真实 `Distribute()`，`default` + `deepseek/deepseek-v4.1-flash` + `/pg/chat/completions` 修复前选不到渠道、修复后 200 且选中渠道 1、配置路由命中 `/v1/chat/completions`，`测试` + `deepseek-v4.1-flash` 在 `/pg` 与 `/v1` 上均为 503（配置原因）。**遗留**：上游两处仍按原始路径判断，同步后会回归；`service/channel_affinity.go` 的规则路径（`rule.PathRegex`）仍看到真实 `/pg` 路径（默认关闭的会话粘性，不影响本次故障；日志 `request_path` 本就该记录真实路径）；本次改动不含 SQL / 模型 / 迁移，未跑 MySQL（本机无实例）。**注**：设备在 09-28 19:03:29 的这次启动里已跑上本仓库的构建（`pg-api v0.0.0 started`，同轮丢弃已退役的订阅表与任务表），因此本次现象直接对应本仓库代码。

- 2026-09-28：**修复轻量设备上周期性 503 `No available channel` 与偶发 500 `Database error`**。设备日志（09-25 起的三天、单进程 46k+ 行）里 44 簇共 2648 行 `No available channel for model ... under group default (distributor)` 的 503，全部紧跟在一次耗时 ≥5s 的渠道缓存重建之后、并在下一次（≤1s）重建时结束；4111 次 <5s 的重建没有一次伴随故障。根因在 `model/channel_cache.go` 的 `InitChannelCache()`：`DB.Find(&channels)` 与 `DB.Find(&abilities)` 的错误被丢弃，随后无论成败都用刚构建的快照覆盖 `group2model2channels` / `channelsIDM` / `channel2advancedCustomConfig`，于是「读失败」被发布成「空路由表」，在该实例 60s 的 `SyncChannelCache` 周期内所有模型都拿不到渠道。设备上的 SQLite 实际处于 rollback journal + 驱动默认 5000ms busy timeout（`_pragma` 参数没生效），任何并发写者都会把这两条读卡到超时。**修复 A（缓存故障安全）**：`InitChannelCache()` 改为返回 `error`，两个 load 任一失败时用 `common.SysError` 记录并保留上一份缓存，不再发布半成品；`SyncChannelCache` 失败后隔 5s 重试一次，而不是等满一个周期。既有 25 处调用点是语句调用，无需改动；只有读失败才保留缓存，读成功但确实为空仍会替换，正常行为不变。**修复 B（DSN pragma 保全）**：`common/init.go` 的 `SQLITE_PATH` 会整体替换 `common/database.go` 里的默认 DSN，把 `_pragma=busy_timeout(30000)`、`_pragma=journal_mode(WAL)`、`_txlock=immediate` 三个必需参数一起丢掉（三个参数各自的作用见 `SQLitePath` 上方注释），于是设备即使跑着 WAL 版代码也会回落到 5000ms/回滚日志；新增 `common/database.go` 的 `withSQLitePragmas()` 按 marker 补齐缺失项，管理员显式写过的项保持原样（旧写法 `_busy_timeout=30000` 不算数，纯 Go 驱动会忽略它）。同一个 5s 读超时也是那次 500 的来源：`TokenAuth` → `GetTokenByKey` 读 `tokens` 表超时 → `model.ErrDatabase` → `middleware/auth.go` 映射成 500 `Database error`（当天 3 小时日志里 43 次，每次 4.7–5.4s）。**回归测试**：`model/channel_cache_test.go`（channels / abilities 任一 load 失败都必须保住旧路由表，另有「读成功仍然替换」的正向对照）、`common/database_test.go`（DSN 补齐的表驱动用例，以及用真实连接读回 `PRAGMA busy_timeout` / `journal_mode` 的用例）。**验证**：SQLite 上把设备库副本置于写者独占锁下，裸 DSN 时 `InitChannelCache()` 5.2s 失败并保住旧缓存（修复前是 10.4s 失败并清空路由表）；用裸 `SQLITE_PATH` 启动真实二进制后库文件由 `delete` 变为 `wal` 且 `/api/status` 200；临时 PostgreSQL 18.6 集群上启动+迁移连续两次无异常，缓存成功、失败（`failed to load channels for channel cache, keeping previous cache`）、5s 重试、恢复四条日志齐全；`go test ./model/ ./service/ ./pkg/perf_metrics/` 配 PG DSN 通过，`./controller/` 的 PG 分支（`TestAuditDatabaseMatrix/postgres` 的 upgrade=false/true、`TestPreConsumePolicyDatabaseMatrix/postgres` 等）全部通过。**已知缺口**：本机没有 MySQL 实例，MySQL 未验证；上游 `upstream/main` 的 `model/channel_cache.go` 同样丢弃这两个错误，从上游同步时会被带回，需要按本节再修一次；设备上运行的构建（横幅 `New API v1.0.0-rc.40-lite`）不是本仓库当前代码（本仓库启动行是 `pg-api <version> started`），升级到本提交后才会由本 fork 自动补齐 pragma。

- 2026-09-28：**移除「任务插件」与任务/视频能力**（轻量设备的主要内存占用来源）。后端删除 JavaScript 任务插件运行时 `pkg/jsplugin/**`（Grafana Sobek 沙盒、注册表、协议引擎、图标与 fixture）、`plugins/`（含 `plugins/tasks/*/plugin.js` 预设与两个 oxlint/oxfmt 配置）以及 `relay/channel/task/**`（`jsplugin` 适配器与 `taskcommon`）；删除全部任务接口 `controller/{task,task_plugin,task_plugin_debug,plugin_protocol,plugin_protocol_image,plugin_protocol_limiter}.go`、`relay/{plugin_protocol,relay_task}.go`、`router/{task-router,task-plugin-protocol-router,plugin-router}.go`、`service/{task,task_billing,task_polling,task_artifact_access,task_artifact_store,task_plugin_audit,task_plugin_view}.go`、`middleware/{task_plugin,task_plugin_model,task_artifact_access}.go`、`model/{task,task_plugin,task_model_alias}.go`、`setting/{task_plugin,task_pricing_setting}`、`dto/{task,task_plugin,plugin_protocol,suno,video}.go`、`types/task_artifact.go`；连带删除 `/v1/video/generations`、`/v1/videos/:id/remix` 与 `/api/plugin/task*` 路由、`RelayFormatTask` / `RelayFormatMjProxy` 与 `TaskAdaptor` 接口、`relay/constant` 的整套 `RelayModeMidjourney*` / `RelayModeVideo*` 常量、`constant/{task,midjourney}.go` 与相关 `env.go` 开关（`UPDATE_TASK`、`TASK_*`、`TaskPluginProtocol*`、`TaskPricePatches`）、`common.{DrawingEnabled,TaskEnabled}` 及其设置项，以及用量日志的「绘制 / 任务」两个 section、系统设置的「绘制」小节、侧栏的 `midjourney` / `task` 模块开关。同一轮把已无引用的 Midjourney 能力一并删除（`service/midjourney.go`、`relay/mjproxy_handler.go`、`constant/midjourney.go`、`middleware` 的 `mj-api-secret` 回退等）。**认证行为有变化**：`TokenAuth` 不再接受 `mj-api-secret` 请求头，也不再把 `Authorization: midjourney-proxy` 当作凭据；`middleware/auth_test.go` 新增回归用例锁定这一行为。**数据库迁移**：`model/main.go` 删除 `Midjourney` / `Task` / `TaskPlugin` 的 AutoMigrate，改为 `dropTaskTables()`（`HasTable` 判断后 `DropTable`，幂等），`tasks` / `midjourneys` / `task_plugins` 三张表及其实例上的索引会在首次启动时删除（历史任务行随之丢失，这是有意为之）。前端删除 `web/src/features/task-plugins/**`（52 个文件）与 `/task-plugins` 路由、`drawing-settings-section.tsx`、模型定价的任务用量/任务定价编辑器与其测试分支、渠道表单的插件扩展字段与「插件市场」选项、用量日志的绘制/任务 section，并在 `web/src/features/channels/constants.ts` 新增 `CHANNEL_TYPE_DECOMMISSIONED = {2,5,36,50,52,54,55}`（MjProxy 绘图渠道与 SunoAPI/Kling/Vidu/Seedance/Sora 等视频厂商），只阻止新建、不影响编辑既有渠道。依赖侧 `go mod tidy` 去掉 `github.com/grafana/sobek`（JS 运行时，唯一消费者就是任务插件）及其三个传递依赖，`THIRD-PARTY-LICENSES.md` 同步删除该行；`zh.json` 清理 336 个因此失效的键。文档同步更新 `AGENTS.md`（删除「JavaScript task plugins (mandatory)」强制段落与插件目录约定）、`README.md`、`constant/README.md`、`docs/openapi/{api,relay}.json`（删除 `/api/mj`、`/api/task`、`/v1/videos*`、`/kling/**`、`/jimeng/`、`/v1/video/generations*` 与对应 schema/tag）。**保留项**：通用后台作业系统 `system_task`（`log_cleanup` / `channel_test` / `model_update`）与 `/api/system-task/*` 不变；`ChannelTypeMidjourney` 等渠道类型常量、`relaykit` 的 `EndpointTypeOpenAIVideo`、`pkg/billingexpr` 的 `UsageFacts` / `TaskUsageBilling` 作为可复用的通用表面保留，渠道类型仅作数据库中已有的标识值使用。**从上游同步时上述文件会被重新引入，需要按本节再次删除**；三张任务表在下次启动时也会被再次创建再删除。**数据库验证缺口**：本机没有可用的 MySQL 实例，迁移只在 SQLite 与 PostgreSQL 上验证过（订阅那轮同样如此），MySQL 端未验证。 **同一轮收尾**：`model/option.go` 新增退役配置键集合 `retiredOptionKeys`（`theme.frontend`、`TaskPublicAddress`、`TaskPluginEnabled`、`billing_setting.plugin_billing_expr`）与 `IsRetiredOptionKey()`——这些键的行继续留在 `options` 表里（不代管理员删数据），但不再进入 `common.OptionMap`，`GET /api/option/` 也不再返回，重新加载时同样过滤。据此删除已无任何消费者的 `TaskPublicAddress` 设置：后端 `system_setting.TaskPublicAddress` 变量与 `model/option.go` 的默认值/分支，前端系统信息表单字段与两份 schema、`general/task-public-address.ts` 校验器及其单测，以及 3 个只服务该字段的 `zh.json` 键，另外清理 13 个任务插件遗留的孤儿键（插件市场、自定义插件开关与插件元数据文案）和 1 条 `static-keys.ts` 登记项；收尾后 `bun run i18n:sync` 仍为 0 缺失 / 0 多余 / 0 未翻译。同时订正随本次移除而失效的文档与注释：`pkg/billingexpr/expr.md` 的「Task Usage Expressions」一节改写为现状说明（`u()` 仅作解析兼容保留、没有生产者填充用量事实、`SmokeTestExpr` 拒绝含字面量 `u()` 键的表达式、快照里的 `TaskUsageBilling`/`UsageFacts` 字段保留但无写入方），并订正该文件里过期的前端文件路径与两个 `billing_setting.*` 选项名；`.agents/rules/billing.md` 去掉 `relaycommon.MaxTaskDurationSeconds`、任务 `metadata`、Kling `FinalUnitDeduction`、alibaba 任务插件与「任务插件回报 `image_count`」等失效引用；`relay/channel/ali/adaptor.go` 的图片拒绝文案不再指向已删除的插件；`relay/convert_request_error_test.go` 对旧拒绝文案的断言改为按短语断言（该用例的 RelayInfo 没有 `ChannelMeta`，错误里不出现模型名），`service/channel_select.go`（`NoAvailableChannel` 注释）、`relay/channel/ali/adaptor_test.go`、`relay/helper/openai_image_request_test.go`、`controller/model_management_test.go` 四处仍把任务插件当作现存机制的注释也已订正。 最后两处任务残留也一并清除：渠道「跳过异步任务轮询延迟」开关（`disable_task_polling_sleep`）只有已删除的任务轮询循环会读取，现从 `relaykit/dto.ChannelOtherSettings`、渠道表单（schema、默认值、解析、提交、设置序列化、配置块字段与状态、错误字段表、表单值类型）以及 2 个 `zh.json` 文案中整体删除，已有渠道 `setting` JSON 里的该键只是被忽略；`constant.ContextKeyOriginTasks` 上下文键同步删除（任务能力删除后已无任何读写方）。`dto.PinSourceOriginTask` / `PinRankOriginTask` 与 `service/channel_select.go` 的 `origin_task_channel_disabled` 分支**保留**：已无生产代码会产生该来源的 pin，但它是唯一的第二个 pin 来源，也是 pin 优先级、覆盖与固定错误码契约的测试夹具，删掉它反而要削弱四个测试文件。
- 2026-09-27：移除「订阅」能力，只保留按 Token（用量）计费。后端删除 `model/subscription.go`、`controller/subscription.go`、`controller/subscription_payment_{stripe,creem,epay,waffo_pancake}.go`、`service/subscription_reset_task.go` 及三个订阅测试文件；四家支付渠道（Stripe / Creem / Epay / Waffo Pancake）的订阅下单分支、订阅 webhook 分支与 Pancake 套餐商品接口一并删除，钱包充值链路不变。计费侧收敛为「钱包」这一唯一资金来源：`service/billing_session.go` 只持有 `WalletFunding`，删除 `FundingSource` 接口与 `SubscriptionFunding`、`BillingSource` / `BillingPreference` 概念、`UserSetting.billing_preference`、`common.NormalizeBillingPreference`、消费日志的 `billing_source` / `billing_preference` 字段、任务计费的订阅分支，以及 `pkg/billingexpr/expr.md` 里「订阅不走预扣豁免」的说明。数据库迁移：`model/main.go` 删除四张订阅表的 AutoMigrate，改为 `dropSubscriptionTables()`（启动时 `HasTable` 判断后 `DropTable`，幂等），由 `migrateDB()` 调用；`subscription_pre_consume_records`、`user_subscriptions`、`subscription_orders`、`subscription_plans` 及其实例上的索引会在首次启动时删除。前端删除 `web/src/features/subscriptions/**`、`/subscriptions` 路由与侧栏入口、钱包页套餐卡与套餐面板布局、用户列表「管理订阅」动作、用量日志的计费来源图标/订阅明细段、维护页侧栏模块开关，并清理 `zh.json` 中 126 个失效键（123 个是本次改动产生的孤儿键，另有 3 个此前就已失效的订阅文案），`static-keys.ts` 同步瘦身；旧的 `/console/subscription` 地址回退到 `/dashboard`（`legacy-route` 里有回归用例）。**从上游同步时这些文件会被重新引入，需要按本节再次删除**；四张订阅表在下次启动时也会被再次创建再删除。
- 2026-09-27：清理与「不接受 issue / PR」治理相冲突的上游元数据。错误页 `web/src/features/errors/general-error.tsx` 去掉指向本仓库 `/issues` 的「Report an issue」按钮和「到 GitHub Issues 反馈」提示（连带删除这两个 `zh.json` 键），新增 `web/src/features/errors/__tests__/general-error.test.tsx` 保护错误页的状态码、文案、两个应用内动作、minimal 形态以及「不出现任何外部反馈入口」。重写 `.github/SECURITY.md`：去掉上游邮箱、GitHub advisory 通道与 48 小时响应承诺，明确本 fork 没有披露流程、上游漏洞按上游政策上报。重写 `.github/CODE_OF_CONDUCT.md`：本 fork 没有社区空间，不适用社区行为准则。删除上游占位配置 `.github/FUNDING.yml`。README 中「缺陷与功能建议」「欢迎贡献」「问题反馈」等入口改为个人自用 fork 的真实做法，上游文档与社区链接统一标注为「上游」。**注意 `.github/workflows/sync-release-to-gitcode.yml`**：上游把 Release 镜像到 GitCode 的流程，由仓库变量 `vars.GITCODE_REPOSITORY` 控制，本 fork 未配置该变量所以不会执行，保留未动。
- 2026-09-27：产品显示名统一为 **PG API**，仓库名、二进制名、镜像名、容器/服务名、Go 模块路径等技术标识继续用 `pg-api`。改动点：`common.SystemName` 默认值、`printHelp()` 横幅首行（`Usage: pg-api ...` 保留，那是可执行文件名）、前端 `DEFAULT_SYSTEM_NAME`、`system-brand.tsx` / `footer.tsx` 的品牌回退值、`web/index.html` 标题、`assets/logo.tsx` 的 SVG title、聊天链接 `name=` 参数、渠道表单里两处渠道文案及其 `zh.json` 键（顺带删掉了同文案的 `New API` 死键）、Electron 窗口标题/托盘提示/右键菜单/崩溃日志与报错文案。注意两点：**`SystemName` 是数据库选项**，已有实例若保存过「系统名称」，界面仍显示库里存的值（改一次设置即可）；**Electron `electron/package.json` 的 `productName` 保持 `pg-api`**，因为它决定 `app.getPath('userData')`，改名会让桌面版数据目录从 `%APPDATA%/pg-api` 漂移、旧数据看似丢失。根目录 README 收敛为简体中文单份并作为默认 `README.md`（删除 `README.en.md` / `README.fr.md` / `README.ja.md` / `README.zh_CN.md` / `README.zh_TW.md`，去掉语言切换块，修正其中"支持七种界面语言"的过期描述）。Windows 单文件构建（两步，先前端后 Go，因为 `web/dist` 被 embed）：`cd web && bun run build`，再在仓库根 `CGO_ENABLED=0 go build -ldflags "-s -w -X 'github.com/zhourenke/pg-api/common.Version=$VERSION'" -o "pg-api-$VERSION.exe" .`，其中 `$VERSION = git describe --tags --match 'v[0-9]*'`。
- 2026-09-27：移除版本号与更新检查界面（本 fork 自用，不需要检查上游 Release）。删除页头 Logo 旁的版本号控件（`SystemUpdateAction presentation='version'`，窄屏退化为图标）与维护页「系统维护」小节；删除 `web/src/features/system-update/**`（浏览器直连 `api.github.com/repos/zhourenke/pg-api/releases` 取最新 Release、`parseSystemVersion` 版本比较、忽略版本列表、localStorage 快照）与 `web/src/features/system-settings/maintenance/update-checker-section.tsx`；清理 31 个只服务该功能的 `zh.json` 键。`/api/status` 仍返回 `version` 与 `start_time`，但前端已无消费者。**从上游同步时这些文件会被重新引入，需要按本节再次删除。**
- 2026-09-26：界面语言收敛为简体中文。前端删除 `en` / `zh-TW` / `fr` / `ja` / `ru` / `vi` 六个语言文件、语言切换器、语言偏好卡片、登录时的语言应用逻辑与 `i18next-browser-languagedetector` 依赖；后端删除多语言协商与用户语言偏好，只留 `zh-CN`；测试基座语言由 `en` 改为 `zhCN`；`common/init.go` 移除多语言横幅。

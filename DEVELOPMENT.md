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
5. **插件数据与 `Intl` 输出受当前语言影响**：`usageSchema.description` / `unitLabel`、内置渠道说明等 `{ en, zh }` 数据在 `zhCN` 下取 `zh`；星期、`2秒`、日期格式取自 `zh-CN`。这些断言写中文。只有当字段**只有 `en`**（或只有 `zh`）时才回退到那一种语言——这是仍有价值的老数据回退契约，测试要保留。

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

- 2026-09-27：清理与「不接受 issue / PR」治理相冲突的上游元数据。错误页 `web/src/features/errors/general-error.tsx` 去掉指向本仓库 `/issues` 的「Report an issue」按钮和「到 GitHub Issues 反馈」提示（连带删除这两个 `zh.json` 键），新增 `web/src/features/errors/__tests__/general-error.test.tsx` 保护错误页的状态码、文案、两个应用内动作、minimal 形态以及「不出现任何外部反馈入口」。重写 `.github/SECURITY.md`：去掉上游邮箱、GitHub advisory 通道与 48 小时响应承诺，明确本 fork 没有披露流程、上游漏洞按上游政策上报。重写 `.github/CODE_OF_CONDUCT.md`：本 fork 没有社区空间，不适用社区行为准则。删除上游占位配置 `.github/FUNDING.yml`。README 中「缺陷与功能建议」「欢迎贡献」「问题反馈」等入口改为个人自用 fork 的真实做法，上游文档与社区链接统一标注为「上游」。**注意 `.github/workflows/sync-release-to-gitcode.yml`**：上游把 Release 镜像到 GitCode 的流程，由仓库变量 `vars.GITCODE_REPOSITORY` 控制，本 fork 未配置该变量所以不会执行，保留未动。
- 2026-09-27：产品显示名统一为 **PG API**，仓库名、二进制名、镜像名、容器/服务名、Go 模块路径等技术标识继续用 `pg-api`。改动点：`common.SystemName` 默认值、`printHelp()` 横幅首行（`Usage: pg-api ...` 保留，那是可执行文件名）、前端 `DEFAULT_SYSTEM_NAME`、`system-brand.tsx` / `footer.tsx` 的品牌回退值、`web/index.html` 标题、`assets/logo.tsx` 的 SVG title、聊天链接 `name=` 参数、渠道表单里两处渠道文案及其 `zh.json` 键（顺带删掉了同文案的 `New API` 死键）、Electron 窗口标题/托盘提示/右键菜单/崩溃日志与报错文案。注意两点：**`SystemName` 是数据库选项**，已有实例若保存过「系统名称」，界面仍显示库里存的值（改一次设置即可）；**Electron `electron/package.json` 的 `productName` 保持 `pg-api`**，因为它决定 `app.getPath('userData')`，改名会让桌面版数据目录从 `%APPDATA%/pg-api` 漂移、旧数据看似丢失。根目录 README 收敛为简体中文单份并作为默认 `README.md`（删除 `README.en.md` / `README.fr.md` / `README.ja.md` / `README.zh_CN.md` / `README.zh_TW.md`，去掉语言切换块，修正其中"支持七种界面语言"的过期描述）。Windows 单文件构建（两步，先前端后 Go，因为 `web/dist` 被 embed）：`cd web && bun run build`，再在仓库根 `CGO_ENABLED=0 go build -ldflags "-s -w -X 'github.com/zhourenke/pg-api/common.Version=$VERSION'" -o "pg-api-$VERSION.exe" .`，其中 `$VERSION = git describe --tags --match 'v[0-9]*'`。
- 2026-09-27：移除版本号与更新检查界面（本 fork 自用，不需要检查上游 Release）。删除页头 Logo 旁的版本号控件（`SystemUpdateAction presentation='version'`，窄屏退化为图标）与维护页「系统维护」小节；删除 `web/src/features/system-update/**`（浏览器直连 `api.github.com/repos/zhourenke/pg-api/releases` 取最新 Release、`parseSystemVersion` 版本比较、忽略版本列表、localStorage 快照）与 `web/src/features/system-settings/maintenance/update-checker-section.tsx`；清理 31 个只服务该功能的 `zh.json` 键。`/api/status` 仍返回 `version` 与 `start_time`，但前端已无消费者。**从上游同步时这些文件会被重新引入，需要按本节再次删除。**
- 2026-09-26：界面语言收敛为简体中文。前端删除 `en` / `zh-TW` / `fr` / `ja` / `ru` / `vi` 六个语言文件、语言切换器、语言偏好卡片、登录时的语言应用逻辑与 `i18next-browser-languagedetector` 依赖；后端删除多语言协商与用户语言偏好，只留 `zh-CN`；测试基座语言由 `en` 改为 `zhCN`；`common/init.go` 移除多语言横幅。

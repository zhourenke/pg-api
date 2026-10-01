# Billing Expression System (billingexpr)

## Design Philosophy

**One expression, one truth.** A single expression string completely defines a model's billing logic — pricing, tier conditions, cache/image/audio differentiation, time-based discounts, request-aware multipliers — all in one line. No scattered configuration, no implicit rules, no magic numbers.

The expression is the billing contract between the administrator and the system. What you write is what gets executed. The system's job is to evaluate it faithfully, not to interpret it.

### Core Principles

1. **Expression is self-contained** — The expression string alone determines billing. No external ratio tables, no implicit completion multipliers, no hidden conversion factors. Given the same token counts and request context, the same expression always produces the same cost.

2. **Variables are opt-in** — `p` (prompt) and `c` (completion) are the base. Cache (`cr`, `cc`, `cc1h`), image (`img`), and audio (`ai`, `ao`) variables are optional. If omitted, those tokens are included in `p`/`c` and priced at their rate. The system automatically detects which variables the expression uses (via AST introspection) and adjusts token normalization accordingly.

3. **Prices are real prices** — Token coefficients are actual $/1M tokens prices as published by providers. `p * 2.5` means $2.50 per 1M prompt tokens; `fixed(0.01)` means $0.01 per request. No ratio conversion or `/2` convention is required.

4. **Upstream-agnostic** — The expression doesn't need to know whether the upstream API is OpenAI-format (prompt_tokens includes cache) or Claude-format (input_tokens excludes cache). The system normalizes token counts before evaluation based on the upstream response format.

5. **Version-aware** — Expressions carry a version tag (`v1:`, default when omitted). The version controls the compile environment, token normalization, and quota conversion formula, enabling future evolution without breaking existing expressions.

---

## Expression Language

Powered by [expr-lang/expr](https://github.com/expr-lang/expr). Expressions are compiled, cached, and evaluated against a runtime environment.

### Token Variables

**输入侧变量：**

| 变量 | 含义 |
|------|------|
| `p` | 输入 token 数（**计价用**）。**自动排除**表达式中单独计价的子类别（见下方说明） |
| `len` | 输入上下文总长度（**条件判断用**）。不受自动排除影响，始终反映完整输入长度。非 Claude：等于原始 `prompt_tokens`；Claude：等于文本输入 + 缓存读取 + 缓存创建 |
| `cr` | 缓存命中（读取）token 数 |
| `cc` | 缓存创建 token 数（Claude 5分钟 TTL / 通用） |
| `cc1h` | 缓存创建 token 数 — 1小时 TTL（Claude 专用） |
| `img` | 图片输入 token 数 |
| `img_cr` | 图片缓存读取 token 数；只有表达式显式引用且上游提供有效缓存模态明细时才单独拆分 |
| `ai` | 音频输入 token 数 |

**输出侧变量：**

| 变量 | 含义 |
|------|------|
| `c` | 输出 token 数。**自动排除**表达式中单独计价的子类别（见下方说明） |
| `img_o` | 图片输出 token 数 |
| `ao` | 音频输出 token 数 |

#### `p` 和 `c` 的自动排除机制

`p` 和 `c` 是"兜底变量"——它们代表**所有没有被表达式单独定价的 token**。系统会根据表达式实际使用了哪些变量，自动从 `p` / `c` 中减去对应的子类别 token，避免重复计费。

**规则：如果表达式使用了某个子类别变量，对应的 token 就从 `p` 或 `c` 中扣除；如果没使用，那些 token 就留在 `p` 或 `c` 里按基础价格计费。**

> **重要：`len` 不受自动排除影响。** `len` 始终代表完整的输入上下文长度，不管表达式是否单独对缓存/图片/音频定价。因此**阶梯条件应使用 `len` 而非 `p`**，以避免缓存命中导致 `p` 降低而误判档位。

举例说明（假设上游返回的原始数据：prompt_tokens=1000，其中包含 200 cache read、100 image）：

| 表达式 | `p` 的值 | 说明 |
|--------|---------|------|
| `p * 3 + c * 15` | 1000 | 没用 `cr`/`img`，所以缓存和图片都包含在 `p` 里，全按 $3 计费 |
| `p * 3 + c * 15 + cr * 0.3` | 800 | 用了 `cr`，缓存 200 从 `p` 中扣除，按 $0.3 单独计费；图片仍在 `p` 里按 $3 计费 |
| `p * 3 + c * 15 + cr * 0.3 + img * 2` | 700 | 用了 `cr` 和 `img`，都从 `p` 中扣除，各自按自己的价格计费 |

输出侧同理（假设 completion_tokens=500，其中包含 100 audio output）：

| 表达式 | `c` 的值 | 说明 |
|--------|---------|------|
| `p * 3 + c * 15` | 500 | 没用 `ao`，音频输出包含在 `c` 里按 $15 计费 |
| `p * 3 + c * 15 + ao * 50` | 400 | 用了 `ao`，音频 100 从 `c` 中扣除按 $50 计费 |

#### 图片缓存与兼容性

OpenAI 兼容图片接口可报告
`usage.input_tokens_details.cached_tokens_details.{text_tokens,image_tokens,audio_tokens}`。
统一 DTO 保留各字段的缺失与显式零值；复制、用量合并及计费转换不得丢失这些信息。
当前公开 Images API 文档未明确缓存模态字段，兼容结构的合成测试不能替代真实上游缓存回包验证。

当表达式使用 `img_cr` 且明细有效时，`img_cr` 从 `cr` 和 `img` 中同时移出，
再按表达式引用的变量从 `p` 中扣除各互不重叠的类别。`len` 保持原始输入总长度。
例如总输入 1000、图片输入 600、缓存总量 300、图片缓存 200：
`p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30` 对应
`p=300, cr=100, img=400, img_cr=200`；输出 100 时费用为 $0.008225。

缺少图片缓存明细时，`img_cr=0`，缓存总量继续进入 `cr`，沿用原有通用缓存计费，
不推测图片缓存比例。不引用 `img_cr` 的既有表达式保持原有归一化行为。
负数、超过总量或无法形成有效输入集合的明细会记录诊断并回退原有逻辑。
Anthropic 的独立缓存计数语义不采用这一 OpenAI 图片拆分。

图片缓存表达式的消费日志保存 `image_cache_tokens` 与 `billing_tokens`，后者由结算结果携带，
通过公共日志注入记录实际参与结算的计价用量，覆盖文本、audio 和 realtime 入口。
求值失败回退预扣时不伪造实际用量；固定价格和未引用 `img_cr` 的表达式不新增这些字段。
文本/图片日志的 `cache_tokens` 继续保留上游缓存总量。Images 的 `output_tokens` 是图片输出，
内置图片价格使用 `c`，无需上游额外报告 `output_tokens_details.image_tokens`。

### 旧定价（倍率 / 按次）的读取与预览

旧倍率与旧按次价格仍可运行，管理界面把它们标记为弃用，新建定价默认使用表达式。
本 fork **不发布内置价格**（`.agents/rules/billing.md` 第 7 条），所以未配置价格的模型没有任何价格可用：
计费入口以 `modelPriceNotConfiguredError` 拒绝，只有用户开启 `AcceptUnsetRatioModel` 时才按 ratio 0 转发。

**旧定价到表达式的转换已整体移除**（提交 `f963bd8f8`）：不再有 `POST /api/option/model_pricing/convert`，
也没有草稿转换、转换前的冲突诊断与左右对照预览。被删掉的转换规则（旧倍率与按次、音频分支、
图片与 DALL·E 尺寸质量的具体生成方式）可在 `git show f963bd8f8^:pkg/billingexpr/expr.md` 查到。

仍在用的是**只读的生效定价解析与预览**：`POST /api/option/model_pricing/preview` 接收
`{model_name, pricing}`（`pricing` 是完整草稿，缺键按运行时默认值解析），返回生效定价、只读
`billing_details` 与 `cache_write_mode`（`none` / `standard` / `claude_ttl`），不写数据库；
保存仍使用 `PATCH /api/option/model_pricing` 及 `expected_version` 冲突检查。未设置与显式 0 必须区分。

`billing_details` 只用于展示：它给出实际音频单价（Gemini 原生输入音频价与兼容 chat 的
AudioRatio/AudioCompletionRatio 路径冲突时只标记冲突，不静默改写其中一条）、图片按次计数的标记、
DALL·E 的尺寸/质量规则，以及音频分支是否与文本分支并存。Gemini 音频在文本价为零时仍可单独计费，
因此音频价不能只用倍率表示。`cache_write_mode` 同样只用于展示与迁移：名称包含 `claude`（不区分大小写）
时是 `claude_ttl`（沿用旧引擎的双 TTL 规则），否则按草稿是否配置了 `CreateCacheRatio` 得到
`standard` 或 `none`；通用引擎兜底不算「已配置缓存写入价格」。元信息不保存、不参与表达式执行。

### Image Quantity

`image_count` 是独立于 token 的计费数量。省略上下文时默认 1；提供的数量必须是 1 到
`dto.MaxImageN`（128）的整数。固定价格语法允许它作为乘数，仍禁止用 token 乘固定价格。
图片入口只解析一次 provider 计费标量并随请求携带。数量来自顶层 `n`（`n=0` 兼容为 1）；
`parameters.n` 仍在入口校验范围，但不再覆盖计费数量。每次渠道重试或参数覆盖之后，再校验最终上游数量并在发送前补足预留，
图片钱包预留使用原子余额检查，不能通过增加数量形成欠费后继续提交。
`estimated_image_count` 保存本次发送前的数量；JSON/multipart 图片参数上下文只保留计费需要的标量，不保留图片或提示词内容。
结算使用独立的实际数量，不修改被冻结的 `param("n")`。正常结束
的 SSE 可以减少数量，客户端提前断开不能减少应收数量。最终消费日志记录 `image_count`。
阿里百炼图片模型（万相、Qwen-Image、Z-Image）曾由 alibaba 任务插件通过 `openai_image` 宿主协议承接，
该插件已随任务插件系统一并移除：ali 渠道的图片请求由适配器直接拒绝，这些模型不再有承接方。
`image_count` 因此只来自请求数量与上游响应中实际计数的图片，不再有插件上报的用量事实。

> **注意：** 自动扣除针对 GPT/OpenAI 格式的 API（prompt_tokens 包含子类别）。Claude 格式的 API 不重复扣除缓存；未独立计价的缓存读取加回输入。系统根据上游返回格式自动处理。

### Built-in Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `tier` | `tier(name, value) → float64` | Records which pricing tier matched; must wrap the cost expression |
| `fixed` | `fixed(amount) → float64` | A USD price per request, used only as the complete price in `tier(name, fixed(amount))` |
| `param` | `param(path) → any` | Reads a JSON path from the request body (uses gjson) |
| `header` | `header(key) → string` | Reads a request header value |
| `has` | `has(source, substr) → bool` | Substring check |
| `hour` | `hour(tz) → int` | Current hour in timezone (0-23) |
| `minute` | `minute(tz) → int` | Current minute (0-59) |
| `weekday` | `weekday(tz) → int` | Day of week (0=Sunday, 6=Saturday) |
| `month` | `month(tz) → int` | Month (1-12) |
| `day` | `day(tz) → int` | Day of month (1-31) |
| `max` | `max(a, b) → float64` | Math max |
| `min` | `min(a, b) → float64` | Math min |
| `abs` | `abs(x) → float64` | Absolute value |
| `ceil` | `ceil(x) → float64` | Ceiling |
| `floor` | `floor(x) → float64` | Floor |

### Expression Examples

```
# Simple flat pricing
tier("base", p * 2.5 + c * 15 + cr * 0.25)

# Conditional per-request pricing, with token pricing for the fallback
len <= 32000
  ? tier("short", fixed(0.01))
  : tier("long", p * 2 + c * 8)

# Multi-tier (Claude Sonnet style) — use len for tier conditions
len <= 200000
  ? tier("standard", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)
  : tier("long_context", p * 6 + c * 22.5 + cr * 0.6 + cc * 7.5 + cc1h * 12)

# Image model (no separate cache/audio pricing — those tokens stay in p/c)
tier("base", p * 2 + c * 8 + img * 2.5)

# Multimodal with audio
tier("base", p * 0.43 + c * 3.06 + img * 0.78 + ai * 3.81 + ao * 15.11)
```

### Fixed Request Prices

`tier("request", fixed(0.01))` replaces all token charges in the selected leaf
with a $0.01 base price for one successful HTTP/SSE request. Other leaves may
still use token pricing. Group ratios and request multipliers continue to apply;
existing tool surcharges are calculated separately and added as before. A stream
does not incur a fixed fee per chunk. Realtime and task usage expressions reject
`fixed()` before upstream submission or reservation.

The amount must be a finite, non-negative numeric literal whose v1 scaled value
is finite. Explicit `fixed(0)` is valid and stays free. Expressions using `fixed`
must consist of a conditional pricing tree and the standard request multiplier
factors described below, with each leaf wrapped in `tier()`. Adding fixed and
token charges in one leaf, adding multiple tiers together, or multiplying a
fixed price by tokens is rejected. Validation examines the original AST,
including branches that optimization or short-circuiting would skip. Existing
expressions without `fixed()` retain their original grammar and behavior.

`fixed(amount)` returns `amount * 1,000,000` internally, preserving v1's existing
quota conversion and rounding. Pre-consume matches conditions using estimates;
settlement reevaluates against actual or existing locally estimated usage and
reconciles any change of branch through the normal billing session. Missing
upstream usage retains the existing estimation path; an actual request-priced
branch can charge even with zero tokens. Failures retain the normal refund
policy. Settlement evaluation errors retain the reservation and its estimated
billing unit.

Evaluation results expose `billing_unit` (`token` or `request`) and, for a
request-priced leaf, `fixed_price` in USD before multipliers. Pre-consume snapshots
carry `estimated_billing_unit` and `estimated_fixed_price`; consume logs append
the actual values to `other`. An explicit zero price is present in these fields.
Older snapshots and logs need no migration. The expression remains the sole
pricing configuration.

### Request Rules (appended after `|||`)

Request-conditional multipliers are appended to the expression after a `|||` separator:

```
tier("base", p * 5 + c * 25)|||when(header("anthropic-beta") has "fast-mode") * 6
```

These factors are stored as ordinary multiplication in the final expression (for example, `(tier(...)) * (condition ? 6 : 1)`) and run in the same billing program.

### Request Rule Tracing

At compile time, the engine instruments ternary factors with this exact shape:

```
<request-probe condition> ? <numeric literal> : 1
```

The condition must reference at least one request probe (`param`, `header`, `hour`, `minute`, `weekday`, `month`, or `day`). Both branches must be numeric literals and the fallback must equal `1`. Other conditionals, including `(condition ? 2 : 1.5)`, are evaluated normally but are not traced. Integer-only factors use an integer-preserving trace callback, so instrumentation does not change expressions that require an integer operand (for example, `%`). The internal trace callback names are reserved and cannot be used in stored expressions.

The compiled cache stores the canonical condition and multiplier for every instrumented node. Each run starts with the full detected rule list marked as unmatched; callbacks mark rules that actually evaluate true. Rules skipped by normal expression short-circuiting remain unmatched. This keeps the expression's numeric result unchanged and avoids reparsing it on each request.

Settlement copies the actual run's traces into the consume log as:

```json
{
  "request_rules": [
    { "cond": "param(\"service_tier\") == \"fast\"", "multiplier": 2, "matched": true }
  ]
}
```

The usage-log UI treats `request_rules` as the authoritative rule list and renders directly from it. It parses `cond` only to produce a friendly label and falls back to the canonical condition text when that parser does not recognize the condition. Pricing pages without log context continue to parse the stored expression for display.

---

## Task Usage Expressions

Task plugins used to expose provider-specific billing facts through
`meta.usageSchema`. Expressions read those facts with `u("key")`, per-model
overrides lived in `billing_setting.plugin_billing_expr`, and settlement used
`expression output in USD * QuotaPerUnit * groupRatio`. The task plugin system
was removed, so nothing produces those facts any more.

What survived in the engine, and why:

- `u("<key>")` still compiles and reads `RequestInput.Usage`. No production
  caller populates that map, so the function returns nil and cannot price
  anything; it is kept only so the expression language stays parse-compatible.
- `BillingSnapshot.TaskUsageBilling` and `UsageFacts` remain, and
  `settle.go` still honours `TaskUsageBilling` (dollar-per-request quota
  conversion and a fixed-price rejection). No code sets the field, so it is
  false for every snapshot the host builds.
- Usage-key expressions can no longer be saved. `SmokeTestExpr` rejects any
  expression whose literal `u()` keys are non-empty with
  `expression references usage keys [...] but usage facts are not supported`.
  An expression stored while plugins existed is not migrated: it cannot be
  re-saved, and evaluating it fails, which keeps the pre-consumed charge.

`image_count` is not a usage fact. It is a first-class variable derived from
the request quantity and from the images counted in the upstream response (see
**Image Quantity** above).

---

## Architecture

### Data Flow

```
Frontend Editor → Storage → Pre-consume → Settlement → Log Display
```

### 1. Frontend Editor

**File**: `web/src/features/system-settings/models/tiered-pricing-editor.tsx`

Two editing modes:
- **Visual mode**: Fill in prices per variable, conditions per tier. Generates expression via `generateExprFromVisualConfig()`.
- **Raw mode**: Edit the expression string directly. Includes preset templates for common models.

The editor outputs a billing expression string and an optional request rule expression string. These are combined via `combineBillingExpr(billingExpr, requestRuleExpr)` before storage.

### 2. Storage

**File**: `setting/billing_setting/tiered_billing.go`

Two option rows stored in the `options` DB table:
- `billing_setting.billing_mode`: `{ "model-name": "tiered_expr" }` — activates tiered billing for a model
- `billing_setting.billing_expr`: `{ "model-name": "tier(\"base\", p * 2.5 + c * 15)" }` — the expression

On save, the expression is validated:
1. Compiled via `billingexpr.CompileFromCache()` — syntax check
2. Smoke-tested with sample token vectors — ensures non-negative results

### 3. Pre-consume (Quota Estimation)

**File**: `relay/helper/price.go` → `modelPriceHelperTiered()`

When a request arrives and the model uses `tiered_expr` billing:
1. Loads expression from `billing_setting.GetBillingExpr()`
2. Builds `RequestInput` (headers + body) for `param()` / `header()` functions
3. Runs the expression with locally estimated input tokens (`P` and `Len`) and zero output tokens (`C=0`). Client output limits do not affect the reservation. If request token estimation is disabled, the estimated input is zero.
4. Converts output to quota: `rawCost / 1,000,000 * QuotaPerUnit`. For token-priced leaves, multiplies this reservation by `quota_setting.pre_consume_multiplier` (default 1; any finite positive decimal). The multiplier does not change context-length tier selection, actual settlement, or request-priced leaves. The snapshot freezes the multiplier for image quantity retries; group retries reuse the multiplied reservation. Older snapshots with no multiplier retain a factor of 1.
5. Creates `BillingSnapshot` and stores it on `RelayInfo`. Expression and request state stay frozen for settlement. An auto-group retry refreshes group-dependent fields from the selected group before the next upstream attempt. If a free initial group skipped pre-consume and the retry selects a paid group, the billing session is created before that attempt. If an existing session moves to a more expensive group, its reservation is raised to that group's estimate before sending; cheaper groups are refunded only after actual usage is settled.

Wallet trust bypass uses `quota_setting.trust_quota_usd` (default 10 USD; 0 disables bypass). Both the wallet and any limited API token must exceed the threshold. The wallet must still cover the estimated reservation before bypass is considered. Legacy token-ratio pricing also reserves estimated input cost times the multiplier, without the former `PreConsumedQuota` floor or output-token estimate.

### 4. Settlement (Actual Billing)

**Files**: `service/tiered_settle.go`, `pkg/billingexpr/settle.go`

After the upstream response returns with actual token usage:

1. `BuildTieredTokenParams(usage, isClaudeUsageSemantic, usedVars)`:
   - Reads actual token counts from `dto.Usage`
   - For GPT-format APIs (prompt_tokens includes everything): subtracts sub-categories from P/C **only when** the expression uses their variables (detected via AST introspection of the compiled expression)
   - For Claude-format APIs: cache reads omitted from the expression are added to input; separately priced cache remains separate

2. `TryTieredSettle(relayInfo, params)`:
   - Uses the captured `BillingSnapshot`, whose group-dependent fields have been refreshed from the final selected group
   - Re-runs the expression with actual token counts
   - Converts via `quotaConversion()` (version-dispatched)
   - Returns actual quota

### 5. Log Display

**Files**: `service/log_info_generate.go`, `web/src/features/usage-logs/lib/format.ts`

Backend: `InjectTieredBillingInfo()` adds `billing_mode`, `expr_b64` (base64 expression), `matched_tier`, and the structured `request_rules` trace list to the log's `other` JSON.

Frontend: Detects `billing_mode === "tiered_expr"`, decodes `expr_b64`, parses tiers via shared `parseTiersFromExpr()`, and renders request multipliers from `request_rules` when present. Without log traces, it falls back to parsing the stored expression.

---

## Key Design Decisions

### Token Normalization via AST Introspection

Different upstream APIs report `prompt_tokens` differently:
- **OpenAI/GPT**: `prompt_tokens` = total (text + cache + image + audio)
- **Claude**: `input_tokens` = text only (cache reported separately)

The system normalizes `p` to mean "tokens not separately priced" by subtracting sub-categories **only when the expression references them**. This is determined by walking the compiled AST to find `IdentifierNode` references — zero runtime cost after first compilation (cached).

Example: `p * 2.5 + c * 15 + cr * 0.25`
- Expression uses `cr` → cache read tokens subtracted from `p`
- Expression doesn't use `img` → image tokens stay in `p`, priced at $2.50

### `len` — Context Length Variable

`len` represents the total input context length, designed for **tier condition evaluation** (e.g. `len <= 200000 ? ...`). Unlike `p`, `len` is never reduced by sub-category exclusion.

**Computation rules:**
- **Non-Claude (GPT/OpenAI format)**: `len = prompt_tokens` (the raw total from the upstream response)
- **Claude format**: `len = input_tokens + cache_read_tokens + cache_creation_tokens` (since Claude's `input_tokens` is text-only, cache must be added back to reflect full context length)

This ensures that heavy cache usage doesn't cause the tier condition to incorrectly evaluate to a lower tier. For example, if a request has 300K total context but 250K is cached, `p` with cache subtracted would be only 50K (standard tier), while `len` correctly reports 300K (long-context tier).

### Quota Conversion

Expression coefficients are $/1M tokens. Conversion to internal quota:

```
quota = exprOutput / 1,000,000 * QuotaPerUnit * groupRatio
```

This matches the per-call billing pattern: `quota = modelPrice * QuotaPerUnit * groupRatio`.

### Expression Versioning

Expressions can carry a version prefix: `v1:tier(...)`. No prefix = v1.

Version controls:
- Compile environment (available variables and functions)
- Token normalization logic
- Quota conversion formula

This enables future evolution without breaking existing expressions.

---

## File Map

| Layer | Files |
|-------|-------|
| Expression engine | `pkg/billingexpr/compile.go`, `run.go`, `settle.go`, `round.go`, `types.go` |
| Storage | `setting/billing_setting/tiered_billing.go` |
| Pre-consume | `relay/helper/price.go`, `relay/helper/billing_expr_request.go` |
| Settlement | `service/tiered_settle.go`, `service/quota.go` |
| Log injection | `service/log_info_generate.go` |
| Frontend editor | `web/src/features/system-settings/models/tiered-pricing-editor.tsx`, `web/src/features/pricing/lib/tier-expr.ts`, `web/src/features/pricing/lib/billing-expr.ts` |
| Frontend display | `web/src/features/pricing/components/dynamic-pricing-breakdown.tsx` |
| Model detail | `web/src/features/model-pricing/model-pricing-panel.tsx` |
| Log display | `web/src/features/usage-logs/lib/format.ts`, `web/src/features/usage-logs/components/dialogs/details-dialog.tsx` |

# 渠道额外设置说明

渠道的两个 JSON 字段存放「不属于渠道基本属性」的配置。界面上的表单会按分节写回这两个字段，手工编辑渠道记录或写脚本时也可以直接写这两个 JSON。

| 数据库列 | 结构体 | 内容 |
| --- | --- | --- |
| `setting` | `dto.ChannelSettings`（`relaykit/dto/channel_settings.go`） | 影响本次请求如何被处理、如何向上游发送的设置 |
| `settings` | `dto.ChannelOtherSettings`（同文件） | 只影响特定渠道类型或管理功能的设置，按渠道类型分别生效 |

两个字段都是可空 JSON：**缺键等同于该项为 `0` / `false` / 空串**，所以只有非默认值有保存的必要（`proxy` 例外，它没有 `omitempty`）。键名统一是下划线小写，和表单里的字段名一致。

## 一、`setting`：请求处理

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `force_format` | bool | 把上游返回强制转成 OpenAI 流式格式。只对 OpenAI 类型的渠道（类型 1）显示 |
| `thinking_to_content` | bool | 把 `reasoning_content` 转成 `<think>` 标签拼进 `content` 后再返回 |
| `proxy` | string | 该渠道出站请求使用的代理，详见第二节 |
| `pass_through_body_enabled` | bool | 原样透传上游请求体：绕过模型重定向、参数覆盖与格式转换。开启前界面会要求二次确认 |
| `responses_websocket_enabled` | bool | 允许该渠道使用 Responses WebSocket 通道；只有支持的类型才显示这个开关 |
| `system_prompt` | string | 该渠道的默认系统提示词。客户端没带系统提示词时把它插到最前面；**客户端自己带了系统提示词时默认不生效**，要生效得再打开下一项 |
| `system_prompt_override` | bool | 客户端已经带了系统提示词时，仍把渠道的提示词**拼在它前面**（界面上的「System Prompt Concatenation」，两者以换行分隔） |
| `http_protocol` | string | 出站 HTTP 版本协商。`""` 与 `auto` 等价（默认，可用时协商 HTTP/2），`http1` 强制 HTTP/1.1 |
| `http2_connection_shards` | int | 把 HTTP/2 流量分散到 1~8 条独立连接。`0`/缺省等同 `1`；`http_protocol` 为 `http1` 时被忽略 |

保存时 `ValidateHTTPTransport` 会校验 `http_protocol` 只能是 `auto` / `http1`（大小写与首尾空格先归一）、`http2_connection_shards` 必须在 0~8 之间，且 `http1` 与大于 1 的分片数不能同时出现。

## 二、`setting`：字段透传

这些开关控制「客户端传了、上游不一定认」的字段是否放行。**它们全部是「默认过滤、显式开启才透传」**，且按渠道类型分别显示——OpenAI 系与 Claude 系各管自己那一组。

| 键 | 适用 | 说明 |
| --- | --- | --- |
| `allow_service_tier` | OpenAI / Claude | 放行 `service_tier`（默认过滤，避免产生额外计费） |
| `allow_inference_geo` | OpenAI / Claude | 放行 `inference_geo`（默认过滤，满足数据驻留合规；仅 Claude） |
| `disable_store` | OpenAI | 禁用 `store` 透传（默认允许透传；禁用后 Codex 可能无法使用） |
| `allow_safety_identifier` | OpenAI | 放行 `safety_identifier`（默认过滤以保护用户隐私） |
| `allow_include_obfuscation` | OpenAI | 放行 `stream_options.include_obfuscation`（默认过滤，避免关闭流混淆保护） |
| `allow_speed` | Claude | 放行 `speed`（默认过滤，避免意外切换推理速度模式） |
| `claude_beta_query` | Claude | 强制在 `/v1/messages` 上追加 `?beta=true`；客户端自己传了 `beta=true` 时同样成立 |

## 三、`setting`：代理

`proxy` 支持 `http`、`https`、`socks5` 与 `socks5h` 四种协议，保存时必须包含协议与主机；路径只允许空或根路径 `/`，不允许 query 与 fragment。SOCKS 代理未写端口时运行时用 `1080`。

代理连接使用 30 秒 TCP 拨号超时与 30 秒 KeepAlive，TLS 握手超时 10 秒。这些超时同样适用于没有配置渠道代理的中转请求。

**升级兼容性**：旧版本会忽略代理地址里的 path、query 与 fragment。为避免升级后中断已有渠道流量，运行时会继续剥离这些遗留后缀，并对同一代理地址每个进程记录一次不含凭证与后缀的警告。该兼容逻辑不改写数据库；再次保存渠道时必须按上面的严格规则修正代理地址。

## 四、`settings`：按渠道类型生效

| 键 | 适用 | 说明 |
| --- | --- | --- |
| `azure_responses_version` | Azure | Azure Responses 接口使用的 API 版本 |
| `vertex_key_type` | Vertex AI | `json`（服务账号）或 `api_key` |
| `openrouter_enterprise` | OpenRouter | 该渠道是否为企业账号（指针类型，用来区分「未设置」与「显式为 false」） |
| `ollama_openai_chat` | Ollama | 把聊天补全改走 OpenAI 兼容的 `/v1/chat/completions`；不设置时仍用原生 `/api/chat` |
| `tool_loss_policy` | 全部 | 请求阶段工具转换丢失的处理策略：空串（默认 `allow`）、`allow`、`safe`、`strict` |
| `advanced_custom` | 高级自定义（类型 58）、VLLM、SGLang | 自定义路由表，见下 |
| `upstream_model_update_check_enabled` | 可拉取模型的类型 | 是否检测上游模型更新 |
| `upstream_model_update_auto_sync_enabled` | 同上 | 检测到可新增模型时是否自动同步 |
| `upstream_model_update_last_check_time` | 同上 | 上次检测时间（运行时写入） |
| `upstream_model_update_last_detected_models` | 同上 | 上次检测到的可加入模型（运行时写入） |
| `upstream_model_update_last_removed_models` | 同上 | 上次检测到的可删除模型（运行时写入） |
| `upstream_model_update_ignored_models` | 同上 | 手动忽略、不再提示的模型 |

`advanced_custom` 是 `{"advanced_routes": [...]}`，每条路由包含 `incoming_path`（本网关暴露的路径，支持 `{model}` 占位符与 Gemini 的 `:generateContent` 写法）、`upstream_path`（完整 URL 或以 `/` 开头的路径）、`converter`（协议转换器，空串等同 `none`）、`models`（可选，支持 `re:` 前缀的正则）、`auth`（`none` / `header` / `query`）与 `pass_through_body_enabled`。保存时会校验路径形状、同路径下的模型是否重叠、转换器与入站路径是否匹配、以及 `pass_through_body_enabled` 只在 `converter` 为 `none` 时允许。

**`GetOtherSettings()` 会为预置的 advanced custom 渠道类型覆盖 `advanced_custom`**：VLLM 与 SGLang 在 `common/advanced_custom_presets.go` 里有代码预置，预置存在时以预置为准，数据库里存的值不生效（预置的保存校验也会拒绝这两个类型改路由表）；类型 58 没有预置，它的路由表来自数据库、在界面上可编辑。

## 五、JSON 示例

OpenAI 类型渠道，开启强制格式化、思考内容转换，并走一个 SOCKS 代理：

```json
{
    "force_format": true,
    "thinking_to_content": true,
    "proxy": "socks5://proxy.example:1080"
}
```

Claude 类型渠道，放行 `speed` 并强制 `?beta=true`：

```json
{
    "allow_speed": true,
    "claude_beta_query": true
}
```

## 六、界面位置

渠道编辑弹窗按「连接 / 路由 / 请求 / 其他」分节，上面这些字段分别落在：

- **请求 → 请求处理**：`force_format`、`thinking_to_content`、`pass_through_body_enabled`、`responses_websocket_enabled`、`ollama_openai_chat`、`system_prompt`、`system_prompt_override`
- **请求 → 字段透传**：`allow_service_tier`、`disable_store`、`allow_safety_identifier`、`allow_include_obfuscation`、`allow_inference_geo`、`allow_speed`、`claude_beta_query`
- **其他 → 额外设置**：`proxy`、`http_protocol`、`http2_connection_shards`
- **其他 → 上游模型检测**：`upstream_model_update_*`

分节的归属写在 `web/src/features/channels/lib/channel-configuration.ts` 的 `CONFIGURATION_BLOCKS`，它是界面显示与否、以及「已配置」状态判定的唯一来源；新增字段时先改那里，再改 `dto.ChannelSettings` / `dto.ChannelOtherSettings`。

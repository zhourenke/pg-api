package common

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/zhourenke/pg-api/common"
	relayconstant "github.com/zhourenke/pg-api/relay/constant"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

var reservedBillableToolNames = map[string]struct{}{
	dto.BuildInToolWebSearchPreview: {},
	dto.BuildInToolWebSearch:        {},
	dto.BuildInToolFileSearch:       {},
	dto.BuildInToolGoogleSearch:     {},
	dto.BuildInToolImageGeneration:  {},
}

// CountBillableToolCall is the single entry point for per-call tool billing counts.
// Built-in call types always count; custom function/tool_use names only count when priced.
func (info *RelayInfo) CountBillableToolCall(itemType string, functionName string) {
	if info == nil {
		return
	}
	if info.ResponsesUsageInfo == nil {
		info.ResponsesUsageInfo = &ResponsesUsageInfo{
			BuiltInTools: make(map[string]*BuildInToolInfo),
		}
	}
	if info.ResponsesUsageInfo.BuiltInTools == nil {
		info.ResponsesUsageInfo.BuiltInTools = make(map[string]*BuildInToolInfo)
	}

	switch itemType {
	case dto.BuildInCallWebSearchCall:
		info.incrementBillableToolCall(resolveWebSearchToolName(info.ResponsesUsageInfo.BuiltInTools))
	case dto.BuildInCallFileSearchCall:
		info.incrementBillableToolCall(dto.BuildInToolFileSearch)
	case dto.BuildInCallFunctionCall, dto.BuildInCallToolUse:
		if functionName == "" {
			return
		}
		if _, reserved := reservedBillableToolNames[functionName]; reserved {
			return
		}
		if operation_setting.GetToolPriceForModel(functionName, info.GetBillingModelName()) <= 0 {
			return
		}
		info.incrementBillableToolCall(functionName)
	}
}

// IsSearchPreviewModel reports whether the model name alone charges one built-in
// web search call per request. Responses requests are excluded: they are charged
// from declared tools and counted tool-call items instead.
func (info *RelayInfo) IsSearchPreviewModel() bool {
	if info == nil || info.RelayMode == relayconstant.RelayModeResponses {
		return false
	}
	return strings.HasSuffix(info.GetBillingModelName(), "search-preview")
}

// DeclaredBillableToolNames lists the built-in billable tool names this request
// can be charged for, resolving them exactly as settlement does for the
// request's own relay path, so a request-time price gate and settlement agree on
// which operator price applies. Custom function declarations are excluded: they
// are billed only when priced and only when actually called. A cross-format
// retarget can settle a declaration under another name (a Responses web-search
// tool served by a Gemini channel settles as google_search); the channel is not
// chosen yet when this gate runs, so that case is out of its reach.
func (info *RelayInfo) DeclaredBillableToolNames() []string {
	if info == nil {
		return nil
	}

	names := make(map[string]struct{}, 3)
	if usage := info.ResponsesUsageInfo; usage != nil {
		for toolName := range usage.BuiltInTools {
			switch {
			case toolName == dto.BuildInToolFileSearch, toolName == dto.BuildInToolImageGeneration:
				names[toolName] = struct{}{}
			case strings.HasPrefix(toolName, dto.BuildInToolWebSearch):
				// Web-search declarations are charged under the resolved
				// web_search/web_search_preview name, not the declared spelling.
				names[resolveWebSearchToolName(usage.BuiltInTools)] = struct{}{}
			}
		}
	}
	if info.IsSearchPreviewModel() {
		names[dto.BuildInToolWebSearchPreview] = struct{}{}
	}
	if request, ok := info.Request.(*dto.ClaudeRequest); ok && request != nil && claudeRequestDeclaresWebSearch(request.Tools) {
		names[dto.BuildInToolWebSearch] = struct{}{}
	}
	if request, ok := info.Request.(*dto.GeminiChatRequest); ok && request != nil && geminiRequestDeclaresWebSearch(request.Tools) {
		names[dto.BuildInToolGoogleSearch] = struct{}{}
	}

	if len(names) == 0 {
		return nil
	}
	declared := make([]string, 0, len(names))
	for name := range names {
		declared = append(declared, name)
	}
	sort.Strings(declared)
	return declared
}

// geminiHostedWebSearchKeys are the Gemini tool keys the conversion layer
// classifies as hosted web search. Each of them can ground a response with web
// search queries, which settlement charges as one google_search call.
var geminiHostedWebSearchKeys = [...]string{"googleSearch", "googleSearchRetrieval", "enterpriseWebSearch"}

// claudeRequestDeclaresWebSearch reports whether a Claude request declares a
// hosted web-search tool. Claude spellings are versioned, e.g.
// web_search_20250305, so only the family prefix is stable.
func claudeRequestDeclaresWebSearch(tools any) bool {
	if tools == nil {
		return false
	}
	raw, err := common.Marshal(tools)
	if err != nil || common.GetJsonType(raw) != "array" {
		return false
	}
	for _, tool := range gjson.ParseBytes(raw).Array() {
		if strings.HasPrefix(tool.Get("type").String(), dto.BuildInToolWebSearch) {
			return true
		}
	}
	return false
}

// geminiRequestDeclaresWebSearch reports whether a Gemini request declares a
// hosted web-search tool.
func geminiRequestDeclaresWebSearch(tools json.RawMessage) bool {
	if len(tools) == 0 || common.GetJsonType(tools) != "array" {
		return false
	}
	for _, tool := range gjson.ParseBytes(tools).Array() {
		for _, key := range geminiHostedWebSearchKeys {
			if value := tool.Get(key); value.Exists() && value.Type != gjson.Null {
				return true
			}
		}
	}
	return false
}

func resolveWebSearchToolName(tools map[string]*BuildInToolInfo) string {
	if _, ok := tools[dto.BuildInToolWebSearchPreview]; ok {
		return dto.BuildInToolWebSearchPreview
	}
	if _, ok := tools[dto.BuildInToolWebSearch]; ok {
		return dto.BuildInToolWebSearch
	}
	return dto.BuildInToolWebSearchPreview
}

func (info *RelayInfo) incrementBillableToolCall(name string) {
	if existing, ok := info.ResponsesUsageInfo.BuiltInTools[name]; ok && existing != nil {
		existing.CallCount++
		return
	}
	info.ResponsesUsageInfo.BuiltInTools[name] = &BuildInToolInfo{
		ToolName:  name,
		CallCount: 1,
	}
}

// ImageGenerationCallCounter counts completed Responses image_generation_call
// outputs with stream-safe identity deduplication.
type ImageGenerationCallCounter struct {
	seen  map[string]struct{}
	count int
}

// Observe records one completed final image output when billable.
// outputIndex may be nil; when set and nonnegative it participates in dedup.
func (c *ImageGenerationCallCounter) Observe(item *dto.ResponsesOutput, outputIndex *int) {
	if c == nil || item == nil {
		return
	}
	if item.Type != dto.ResponsesOutputTypeImageGenerationCall {
		return
	}
	if strings.TrimSpace(item.Result) == "" {
		return
	}
	switch strings.ToLower(strings.TrimSpace(item.Status)) {
	case "failed", "cancelled", "canceled", "incomplete", "partial":
		return
	}

	aliases := make([]string, 0, 4)
	if item.ID != "" {
		aliases = append(aliases, "id:"+item.ID)
	}
	if item.CallId != "" {
		aliases = append(aliases, "call:"+item.CallId)
	}
	if outputIndex != nil && *outputIndex >= 0 {
		aliases = append(aliases, fmt.Sprintf("index:%d", *outputIndex))
	}
	sum := sha256.Sum256([]byte(item.Result))
	aliases = append(aliases, "result:"+hex.EncodeToString(sum[:]))

	if c.seen == nil {
		c.seen = make(map[string]struct{})
	}
	for _, alias := range aliases {
		if _, ok := c.seen[alias]; ok {
			return
		}
	}
	for _, alias := range aliases {
		c.seen[alias] = struct{}{}
	}
	c.count++
}

// Reset clears pending observations (used when a terminal response fails).
func (c *ImageGenerationCallCounter) Reset() {
	if c == nil {
		return
	}
	c.seen = nil
	c.count = 0
}

// Count returns the deduplicated completed image output count before commit capping.
func (c *ImageGenerationCallCounter) Count() int {
	if c == nil {
		return 0
	}
	return c.count
}

// Commit writes the capped completed-output count into RelayInfo once.
// Request tool declarations alone must not become billable calls.
func (c *ImageGenerationCallCounter) Commit(info *RelayInfo) {
	if info == nil {
		return
	}
	if info.ResponsesUsageInfo == nil {
		info.ResponsesUsageInfo = &ResponsesUsageInfo{
			BuiltInTools: make(map[string]*BuildInToolInfo),
		}
	}
	if info.ResponsesUsageInfo.BuiltInTools == nil {
		info.ResponsesUsageInfo.BuiltInTools = make(map[string]*BuildInToolInfo)
	}

	count := 0
	if c != nil {
		count = c.count
	}
	if count > dto.MaxImageN {
		count = dto.MaxImageN
	}

	if existing, ok := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration]; ok && existing != nil {
		existing.CallCount = count
		return
	}
	info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration] = &BuildInToolInfo{
		ToolName:  dto.BuildInToolImageGeneration,
		CallCount: count,
	}
}

// IsNonBillableResponsesStatus reports terminal response statuses that must not
// bill pending image_generation observations.
func IsNonBillableResponsesStatus(status []byte) bool {
	if len(status) == 0 {
		return false
	}
	var s string
	if err := common.Unmarshal(status, &s); err != nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "failed", "cancelled", "canceled", "incomplete":
		return true
	default:
		return false
	}
}

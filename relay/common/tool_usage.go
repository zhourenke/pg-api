package common

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
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

// SetUpstreamHostedToolTypes records the hosted tool types the request converter
// wrote into the upstream request for this attempt. Converters report every
// hosted tool they wrote, including tools this gateway cannot charge, so the
// billing side decides which of them carry a price.
func (info *RelayInfo) SetUpstreamHostedToolTypes(hostedToolTypes []string) {
	if info == nil {
		return
	}
	info.upstreamHostedToolTypes = slices.Clone(hostedToolTypes)
}

// UpstreamBillableToolNames lists the built-in billable tool price identities
// this attempt can actually be charged for. When a converter rewrote the request
// body for the selected channel, the identities come from the hosted tool types
// that converter wrote upstream: a tool the target format cannot represent is
// dropped before the upstream ever sees it and therefore cannot be charged, so
// demanding a price for it would refuse a request that was never billable.
// Without a conversion the client's own format is the upstream namespace, and
// the client's declarations are the answer.
//
// Callers run this after the request has been converted, because the upstream
// format is decided per attempt by the selected channel.
func (info *RelayInfo) UpstreamBillableToolNames() []string {
	if info == nil {
		return nil
	}
	if info.upstreamHostedToolTypes == nil {
		return info.declaredBillableToolNames()
	}
	return billableToolNamesForUpstreamToolTypes(info.upstreamHostedToolTypes)
}

// billableToolNamesForUpstreamToolTypes maps the hosted tool spellings written
// into the upstream request to the price identities settlement charges for them.
// Only tools this gateway counts can be charged: web search (Claude's
// web_search, Gemini's googleSearch family, or a Responses web_search*
// spelling), file_search and image_generation. Everything else a converter may
// write (MCP, code execution, URL context, opaque native tools) is deliberately
// not listed, because settlement has no counter that could ever charge it.
func billableToolNamesForUpstreamToolTypes(hostedToolTypes []string) []string {
	names := make(map[string]struct{}, len(hostedToolTypes))
	var webSearchSpellings []string
	for _, hostedType := range hostedToolTypes {
		switch {
		case hostedType == dto.BuildInToolGoogleSearch, slices.Contains(geminiHostedWebSearchKeys[:], hostedType):
			names[dto.BuildInToolGoogleSearch] = struct{}{}
		case hostedType == dto.BuildInToolFileSearch, hostedType == dto.BuildInToolImageGeneration:
			names[hostedType] = struct{}{}
		case strings.HasPrefix(hostedType, dto.BuildInToolWebSearch):
			webSearchSpellings = append(webSearchSpellings, hostedType)
		}
	}
	if len(webSearchSpellings) > 0 {
		// Reuse settlement's own resolution rather than restating it: it prefers
		// web_search_preview when the declared spellings offer one, falls back to
		// web_search, and treats a versioned spelling as web_search_preview. A
		// declared spelling and an observed one must not resolve to two prices.
		// Only key presence matters here, so nil entries are fine.
		declared := make(map[string]*BuildInToolInfo, len(webSearchSpellings))
		for _, spelling := range webSearchSpellings {
			declared[spelling] = nil
		}
		names[resolveWebSearchToolName(declared)] = struct{}{}
	}
	return sortedToolNames(names)
}

// declaredBillableToolNames lists the built-in billable tool names the client's
// own request format charges under, resolving them exactly as settlement does
// for that format. This is the answer only while no converter rewrote the body:
// a cross-format retarget can settle a declaration under a different name (a
// Responses web-search tool served by a Gemini channel settles as google_search),
// and then UpstreamBillableToolNames uses the converted request instead.
// Custom function declarations are excluded: they are billed only when priced
// and only when actually called.
func (info *RelayInfo) declaredBillableToolNames() []string {
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
	return sortedToolNames(names)
}

func sortedToolNames(names map[string]struct{}) []string {
	if len(names) == 0 {
		return nil
	}
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	return sorted
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

// resolveWebSearchToolName resolves one price identity for a set of web-search
// tool spellings. Only key presence matters, so nil values are fine. A versioned
// spelling such as web_search_2025_08_26 has no price of its own and resolves to
// web_search_preview, the name the operator UI documents.
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

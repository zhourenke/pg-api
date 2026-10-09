package common

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

func TestCountBillableToolCallWebSearchPrefersDeclaredWebSearch(t *testing.T) {
	info := &RelayInfo{
		OriginModelName: "gpt-5.1",
		ResponsesUsageInfo: &ResponsesUsageInfo{
			BuiltInTools: map[string]*BuildInToolInfo{
				dto.BuildInToolWebSearch: {ToolName: dto.BuildInToolWebSearch, CallCount: 0},
			},
		},
	}

	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearch)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearch].CallCount)
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearchPreview)
}

func TestCountBillableToolCallWebSearchDefaultsToPreview(t *testing.T) {
	info := &RelayInfo{OriginModelName: "gpt-5.1"}

	info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	require.NotNil(t, info.ResponsesUsageInfo)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearchPreview)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
}

func TestCountBillableToolCallFunctionCallRequiresPrice(t *testing.T) {
	operation_setting.SetToolPriceForTest("my_priced_fn", 5.0)
	t.Cleanup(func() {
		operation_setting.DeleteToolPriceForTest("my_priced_fn")
	})

	info := &RelayInfo{OriginModelName: "gpt-5.1"}
	info.CountBillableToolCall(dto.BuildInCallFunctionCall, "my_priced_fn")
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, "my_priced_fn")
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools["my_priced_fn"].CallCount)

	info.CountBillableToolCall(dto.BuildInCallFunctionCall, "unpriced_fn")
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, "unpriced_fn")
}

func TestCountBillableToolCallFunctionCallSkipsReservedNames(t *testing.T) {
	info := &RelayInfo{OriginModelName: "gpt-5.1"}

	info.CountBillableToolCall(dto.BuildInCallFunctionCall, dto.BuildInToolWebSearchPreview)
	info.CountBillableToolCall(dto.BuildInCallFunctionCall, dto.BuildInToolFileSearch)
	info.CountBillableToolCall(dto.BuildInCallFunctionCall, dto.BuildInToolGoogleSearch)
	info.CountBillableToolCall(dto.BuildInCallFunctionCall, dto.BuildInToolImageGeneration)

	if info.ResponsesUsageInfo != nil {
		assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolWebSearchPreview)
		assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolFileSearch)
		assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolGoogleSearch)
		assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	}
}

func TestImageGenerationCallCounterCompletedOutputs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		observe   func(c *ImageGenerationCallCounter)
		wantCount int
	}{
		{
			name: "one final result",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "completed",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 1,
		},
		{
			name: "two distinct finals",
			observe: func(c *ImageGenerationCallCounter) {
				idx0, idx1 := 0, 1
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Result: "base64-a",
				}, &idx0)
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_2",
					Result: "base64-b",
				}, &idx1)
			},
			wantCount: 2,
		},
		{
			name: "empty result",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Result: "   ",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "failed status",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "failed",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "incomplete status",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "incomplete",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "cancelled status",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "cancelled",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "canceled status",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "canceled",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "partial status",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "partial",
					Result: "partial-bytes",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "id dedup",
			observe: func(c *ImageGenerationCallCounter) {
				idx0, idx1 := 0, 1
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					CallId: "call_a",
					Result: "base64-a",
				}, &idx0)
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					CallId: "call_b",
					Result: "base64-b",
				}, &idx1)
			},
			wantCount: 1,
		},
		{
			name: "index dedup",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Result: "base64-a",
				}, &idx)
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_2",
					Result: "base64-b",
				}, &idx)
			},
			wantCount: 1,
		},
		{
			name: "result hash dedup",
			observe: func(c *ImageGenerationCallCounter) {
				idx0, idx1 := 0, 1
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					Result: "same-bytes",
				}, &idx0)
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					Result: "same-bytes",
				}, &idx1)
			},
			wantCount: 1,
		},
		{
			name: "output_item.done plus completed dedup",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				item := &dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					CallId: "call_1",
					Status: "completed",
					Result: "base64-a",
				}
				c.Observe(item, &idx)
				c.Observe(item, &idx)
			},
			wantCount: 1,
		},
		{
			name: "output_item.done plus incomplete equals zero",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "completed",
					Result: "base64-a",
				}, &idx)
				c.Reset()
			},
			wantCount: 0,
		},
		{
			name: "partial event equals zero",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   "image_generation_call.partial_image",
					ID:     "img_1",
					Result: "partial-bytes",
				}, &idx)
			},
			wantCount: 0,
		},
		{
			name: "in_progress with final result counts",
			observe: func(c *ImageGenerationCallCounter) {
				idx := 0
				c.Observe(&dto.ResponsesOutput{
					Type:   dto.ResponsesOutputTypeImageGenerationCall,
					ID:     "img_1",
					Status: "in_progress",
					Result: "base64-a",
				}, &idx)
			},
			wantCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			counter := &ImageGenerationCallCounter{}
			tt.observe(counter)
			assert.Equal(t, tt.wantCount, counter.Count())
		})
	}
}

func TestImageGenerationCallCounterCommitCapsAtMaxImageN(t *testing.T) {
	t.Parallel()

	counter := &ImageGenerationCallCounter{}
	for i := range dto.MaxImageN + 3 {
		idx := i
		counter.Observe(&dto.ResponsesOutput{
			Type:   dto.ResponsesOutputTypeImageGenerationCall,
			ID:     "img_" + strings.Repeat("a", i+1),
			Result: "result-" + strings.Repeat("b", i+1),
		}, &idx)
	}
	require.Equal(t, dto.MaxImageN+3, counter.Count())

	info := &RelayInfo{}
	counter.Commit(info)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	assert.Equal(t, dto.MaxImageN, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestImageGenerationCallCounterCommitDoesNotBillDeclarationsAlone(t *testing.T) {
	t.Parallel()

	info := &RelayInfo{
		ResponsesUsageInfo: &ResponsesUsageInfo{
			BuiltInTools: map[string]*BuildInToolInfo{
				dto.BuildInToolImageGeneration: {
					ToolName:  dto.BuildInToolImageGeneration,
					CallCount: 0,
				},
			},
		},
	}
	(&ImageGenerationCallCounter{}).Commit(info)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestIsNonBillableResponsesStatus(t *testing.T) {
	t.Parallel()

	assert.True(t, IsNonBillableResponsesStatus([]byte(`"failed"`)))
	assert.True(t, IsNonBillableResponsesStatus([]byte(`"incomplete"`)))
	assert.True(t, IsNonBillableResponsesStatus([]byte(`"cancelled"`)))
	assert.True(t, IsNonBillableResponsesStatus([]byte(`"canceled"`)))
	assert.False(t, IsNonBillableResponsesStatus([]byte(`"completed"`)))
	assert.False(t, IsNonBillableResponsesStatus(nil))
}

// The identity set a request is gated and settled with must not move when the
// response is counted. Counting writes counted call items into BuiltInTools, so
// reading declarations back out of that map would adopt whatever the upstream
// reported - including a search the client never asked for.
func TestUpstreamBillableToolNamesIgnoresCountedCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)

	declaredSearch := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.1",
		Input: json.RawMessage(`"search"`),
		Tools: json.RawMessage(`[{"type":"web_search_preview"}]`),
	}
	noTools := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.1",
		Input: json.RawMessage(`"search"`),
	}

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	declared, err := GenRelayInfo(ctx, types.RelayFormatOpenAIResponses, declaredSearch, nil)
	require.NoError(t, err)
	assert.Equal(t, []string{dto.BuildInToolWebSearchPreview}, declared.UpstreamBillableToolNames())
	declared.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	assert.Equal(t, []string{dto.BuildInToolWebSearchPreview}, declared.UpstreamBillableToolNames(),
		"counting a declared call must not change the identity set")
	assert.Empty(t, declared.UndeclaredBillableToolCalls([]string{dto.BuildInToolWebSearchPreview}))

	undeclared, err := GenRelayInfo(ctx, types.RelayFormatOpenAIResponses, noTools, nil)
	require.NoError(t, err)
	assert.Empty(t, undeclared.UpstreamBillableToolNames())
	// The upstream reported a search call the client never declared; without the
	// declaration snapshot the counted entry would have declared itself.
	undeclared.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
	assert.Empty(t, undeclared.UpstreamBillableToolNames(),
		"an observed call must not declare itself")
	assert.Equal(t, []string{dto.BuildInToolWebSearchPreview},
		undeclared.UndeclaredBillableToolCalls([]string{dto.BuildInToolWebSearchPreview}))
}

// A Chat Completions web search reports no call detail, so it is charged as one
// fixed call per request: from the client's own declaration, or from the dialect
// field a conversion wrote for a chat upstream. A request whose upstream is not
// chat completions is settled from counted items instead.
func TestChatWebSearchWithoutCallCount(t *testing.T) {
	t.Parallel()

	converted := &RelayInfo{RelayFormat: types.RelayFormatClaude}
	converted.SetUpstreamHostedToolTypes([]string{dto.BuildInToolWebSearchOptions})
	converted.AppendRequestConversion(types.RelayFormatOpenAI)

	tests := []struct {
		name      string
		info      *RelayInfo
		want      bool
		wantNames []string
	}{
		{
			name: "declared by the client",
			info: &RelayInfo{
				RelayFormat: types.RelayFormatOpenAI,
				Request:     &dto.GeneralOpenAIRequest{Model: "gpt-4o", WebSearchOptions: &dto.WebSearchOptions{}},
			},
			want:      true,
			wantNames: []string{dto.BuildInToolWebSearchPreview},
		},
		{
			name:      "written by a conversion for a chat upstream",
			info:      converted,
			want:      true,
			wantNames: []string{dto.BuildInToolWebSearchPreview},
		},
		{
			name: "a chat declaration bridged to a responses upstream",
			info: &RelayInfo{
				RelayFormat:             types.RelayFormatOpenAI,
				FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
				Request:                 &dto.GeneralOpenAIRequest{Model: "gpt-4o", WebSearchOptions: &dto.WebSearchOptions{}},
			},
			want:      false,
			wantNames: nil,
		},
		{
			name: "no web search at all",
			info: &RelayInfo{
				RelayFormat: types.RelayFormatOpenAI,
				Request:     &dto.GeneralOpenAIRequest{Model: "gpt-4o"},
			},
			want:      false,
			wantNames: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, tt.info.ChatWebSearchWithoutCallCount())
			assert.Equal(t, tt.wantNames, tt.info.UpstreamBillableToolNames())
		})
	}
}

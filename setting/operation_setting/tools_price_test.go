package operation_setting

import (
	"maps"
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func preserveToolPrices(t *testing.T) {
	t.Helper()
	original := make(map[string]float64, len(toolPriceSetting.Prices))
	maps.Copy(original, toolPriceSetting.Prices)
	t.Cleanup(func() {
		toolPriceSetting.Prices = original
		RebuildToolPriceIndex()
	})
}

// The index is built from operator configuration only: an unconfigured tool is
// free, including the tools the fork used to ship a hardcoded price for.
func TestToolPriceUnconfiguredToolsAreFree(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{}
	RebuildToolPriceIndex()

	for _, name := range []string{"web_search", "web_search_preview", "file_search", "google_search", "image_generation"} {
		assert.Equal(t, 0.0, GetToolPrice(name), name)
	}
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4o-2024-11-20"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4.1-mini"))
}

func TestToolPriceOperatorOverridePrecedenceAndExplicitZero(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{
		"image_generation":                 0,
		"web_search":                       12,
		"web_search_preview":               0,
		"web_search_preview:gpt-4o*":       30,
		"web_search_preview:gpt-4o-mini*":  0,
		"web_search_preview:custom-model*": 7,
	}

	RebuildToolPriceIndex()

	assert.Equal(t, 0.0, GetToolPrice("image_generation"))
	assert.Equal(t, 12.0, GetToolPrice("web_search"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "o1"))
	assert.Equal(t, 30.0, GetToolPriceForModel("web_search_preview", "gpt-4o"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4o-mini"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4.1"))
	assert.Equal(t, 7.0, GetToolPriceForModel("web_search_preview", "custom-model-v2"))

	// Removing a model-prefix override falls back to the tool default, and
	// removing the tool default leaves the tool free.
	delete(toolPriceSetting.Prices, "web_search_preview:gpt-4o*")
	RebuildToolPriceIndex()
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4o"))

	delete(toolPriceSetting.Prices, "web_search")
	RebuildToolPriceIndex()
	assert.Equal(t, 0.0, GetToolPrice("web_search"))
}

func TestToolPriceCustomFunctionHasNoHardcodedFallback(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{}
	RebuildToolPriceIndex()

	assert.Equal(t, 0.0, GetToolPrice("lookup_customer"))

	toolPriceSetting.Prices["lookup_customer"] = 5
	RebuildToolPriceIndex()
	assert.Equal(t, 5.0, GetToolPrice("lookup_customer"))

	toolPriceSetting.Prices["lookup_customer"] = 0
	RebuildToolPriceIndex()
	assert.Equal(t, 0.0, GetToolPrice("lookup_customer"))
}

func TestValidateToolPricesJSON(t *testing.T) {
	valid := []string{
		`{}`,
		`{"web_search":0}`,
		`{"web_search":10,"custom_fn":2.5}`,
	}
	for _, value := range valid {
		assert.NoError(t, ValidateToolPricesJSON(value), value)
	}

	invalid := []string{
		`null`,
		`[]`,
		`{"web_search":null}`,
		`{"web_search":true}`,
		`{"web_search":"0"}`,
		`{"web_search":-1}`,
		`{"web_search":1e999}`,
		`{"web_search":`,
	}
	for _, value := range invalid {
		assert.Error(t, ValidateToolPricesJSON(value), value)
	}
}

func TestLoadToolPricesFromJSONStringReplacesMapAndKeepsValidSiblings(t *testing.T) {
	preserveToolPrices(t)

	LoadToolPricesFromJSONString(`{
		"web_search": 0,
		"custom_fn": 3,
		"file_search": null,
		"google_search": -1,
		"image_generation": "0"
	}`)

	require.Len(t, toolPriceSetting.Prices, 2)
	assert.Equal(t, 0.0, toolPriceSetting.Prices["web_search"])
	assert.Equal(t, 3.0, toolPriceSetting.Prices["custom_fn"])
	assert.Equal(t, 0.0, GetToolPrice("web_search"))
	assert.Equal(t, 3.0, GetToolPrice("custom_fn"))
	// Rejected entries are dropped, not replaced by a shipped default.
	assert.Equal(t, 0.0, GetToolPrice("file_search"))
	assert.Equal(t, 0.0, GetToolPrice("google_search"))
	assert.Equal(t, 0.0, GetToolPrice("image_generation"))

	LoadToolPricesFromJSONString(`{"image_generation":0}`)
	require.Len(t, toolPriceSetting.Prices, 1)
	assert.NotContains(t, toolPriceSetting.Prices, "web_search")
	assert.NotContains(t, toolPriceSetting.Prices, "custom_fn")
	assert.Equal(t, 0.0, GetToolPrice("web_search"))
	assert.Equal(t, 0.0, GetToolPrice("custom_fn"))
	assert.Equal(t, 0.0, GetToolPrice("image_generation"))
}

func TestRebuildToolPriceIndexIgnoresInvalidDirectValues(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{
		"web_search":       -1,
		"file_search":      math.Inf(1),
		"image_generation": math.NaN(),
		"custom_fn":        math.NaN(),
	}
	RebuildToolPriceIndex()

	for _, name := range []string{"web_search", "file_search", "image_generation", "custom_fn"} {
		assert.Equal(t, 0.0, GetToolPrice(name), name)
	}
}

// Tools follow the same policy as models: "unset" means no operator rule
// matched, so a configured numeric zero is a deliberate free rule rather than a
// missing one, and self-use mode keeps an unpriced tool usable.
func TestToolPricingUnsetRequiresAMatchingRule(t *testing.T) {
	preserveToolPrices(t)
	oldSelfUse := SelfUseModeEnabled
	t.Cleanup(func() { SelfUseModeEnabled = oldSelfUse })

	toolPriceSetting.Prices = map[string]float64{
		"web_search_preview":         0,
		"web_search_preview:gpt-4o*": 30,
		"image_generation":           5,
	}
	RebuildToolPriceIndex()

	assert.True(t, HasToolPriceForModel("web_search_preview", "o1"))
	assert.True(t, HasToolPriceForModel("web_search_preview", "gpt-4o-mini"))
	assert.True(t, HasToolPriceForModel("image_generation", "any-model"))
	assert.False(t, HasToolPriceForModel("web_search", "any-model"))
	assert.False(t, HasToolPriceForModel("google_search", "gemini-2.5-flash"))

	SelfUseModeEnabled = false
	assert.True(t, IsToolPricingUnset("web_search", "any-model"))
	assert.True(t, IsToolPricingUnset("google_search", "gemini-2.5-flash"))
	assert.False(t, IsToolPricingUnset("web_search_preview", "gpt-4o"), "a configured zero must not read as missing")
	assert.False(t, IsToolPricingUnset("image_generation", "any-model"))

	SelfUseModeEnabled = true
	assert.False(t, IsToolPricingUnset("web_search", "any-model"), "self-use mode keeps unpriced tools usable")
}

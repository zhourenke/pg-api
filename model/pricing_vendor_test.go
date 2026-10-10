package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relaykit/dto"
)

// catalogByModel rebuilds the public catalog from the current test tables.
func catalogByModel(t *testing.T) map[string]Pricing {
	t.Helper()
	InitChannelCache()
	byModel := make(map[string]Pricing)
	for _, pricing := range GetPricing() {
		byModel[pricing.ModelName] = pricing
	}
	return byModel
}

// displayVendorNames reads the vendor list the catalog publishes alongside it.
func displayVendorNames(t *testing.T) map[int]string {
	t.Helper()
	names := make(map[int]string)
	for _, vendor := range GetVendors() {
		names[vendor.ID] = vendor.Name
	}
	return names
}

func TestPricingModelWithoutVendorFallsBackToNameDefault(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 501, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 501, "gemini-2.5-flash")
	require.NoError(t, DB.Create(&Model{
		ModelName: "gemini-2.5-flash",
		Status:    1,
		NameRule:  NameRuleExact,
	}).Error)

	vendorID := catalogByModel(t)["gemini-2.5-flash"].VendorID

	require.NotZero(t, vendorID)
	assert.Equal(t, "Google", displayVendorNames(t)[vendorID])

	var stored Model
	require.NoError(t, DB.First(&stored, "model_name = ?", "gemini-2.5-flash").Error)
	assert.Zero(t, stored.VendorID, "the name fallback is display-only and never rewrites the record")
}

func TestPricingModelVendorWinsOverNameDefault(t *testing.T) {
	resetPricingEndpointTestTables(t)
	vendor := &Vendor{Name: "Custom Vendor", Status: 1}
	require.NoError(t, DB.Create(vendor).Error)
	insertPricingEndpointChannel(t, 502, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 502, "gemini-2.5-flash")
	require.NoError(t, DB.Create(&Model{
		ModelName: "gemini-2.5-flash",
		VendorID:  vendor.Id,
		Status:    1,
		NameRule:  NameRuleExact,
	}).Error)

	catalog := catalogByModel(t)

	assert.Equal(t, vendor.Id, catalog["gemini-2.5-flash"].VendorID)
	assert.Equal(t, "Custom Vendor", displayVendorNames(t)[catalog["gemini-2.5-flash"].VendorID])
}

func TestPricingSharedMetadataRuleResolvesVendorPerModelName(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 503, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 503, "gemini-flash-lite")
	insertPricingEndpointAbility(t, 503, "qwen-flash-lite")
	require.NoError(t, DB.Create(&Model{
		ModelName: "flash",
		NameRule:  NameRuleContains,
		Status:    1,
	}).Error)

	catalog := catalogByModel(t)
	names := displayVendorNames(t)

	assert.Equal(t, "Google", names[catalog["gemini-flash-lite"].VendorID])
	assert.Equal(t, "阿里巴巴", names[catalog["qwen-flash-lite"].VendorID])
}

func TestPricingModelWithoutMetadataRecordKeepsDisplayOnlyVendor(t *testing.T) {
	resetPricingEndpointTestTables(t)
	insertPricingEndpointChannel(t, 504, constant.ChannelTypeOpenAI, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 504, "gemini-3.8-flash-PPV")

	catalog := catalogByModel(t)

	assert.Equal(t, "Google", displayVendorNames(t)[catalog["gemini-3.8-flash-PPV"].VendorID])

	var count int64
	require.NoError(t, DB.Model(&Model{}).Count(&count).Error)
	assert.Zero(t, count, "reading the catalog must not create a metadata record")
}

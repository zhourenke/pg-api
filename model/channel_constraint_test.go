package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/dto"
	kitdto "github.com/zhourenke/pg-api/relaykit/dto"
)

func TestFilterCandidateIDs(t *testing.T) {
	ordinary := &Channel{Id: 900003, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled}
	matchingCustom := &Channel{Id: 900010, Type: constant.ChannelTypeAdvancedCustom, Status: common.ChannelStatusEnabled}
	matchingCustom.SetOtherSettings(kitdto.ChannelOtherSettings{
		AdvancedCustom: &kitdto.AdvancedCustomConfig{
			Routes: []kitdto.AdvancedCustomRoute{{
				IncomingPath: "/v1/chat/completions",
				Models:       []string{"gpt-4"},
			}},
		},
	})
	otherCustom := &Channel{Id: 900011, Type: constant.ChannelTypeAdvancedCustom, Status: common.ChannelStatusEnabled}
	otherCustom.SetOtherSettings(kitdto.ChannelOtherSettings{
		AdvancedCustom: &kitdto.AdvancedCustomConfig{
			Routes: []kitdto.AdvancedCustomRoute{{
				IncomingPath: "/v1/responses",
				Models:       []string{"gpt-4"},
			}},
		},
	})

	pathFilter := dto.ChannelFilter{Kind: dto.FilterRequestPath, RequestPath: "/v1/chat/completions"}
	emptyPathFilter := dto.ChannelFilter{Kind: dto.FilterRequestPath, RequestPath: ""}

	tests := []struct {
		name      string
		ids       []int
		modelName string
		filters   []dto.ChannelFilter
		wantKept  []int
		wantEmpty dto.ChannelFilterKind
	}{
		{
			name:      "empty request path is a passthrough including missing ids",
			ids:       []int{900003, 900010, 999999},
			modelName: "gpt-4",
			filters:   []dto.ChannelFilter{emptyPathFilter},
			wantKept:  []int{900003, 900010, 999999},
		},
		{
			name:      "request path keeps missing cache entry for consistency",
			ids:       []int{900003, 999999},
			modelName: "gpt-4",
			filters:   []dto.ChannelFilter{pathFilter},
			wantKept:  []int{900003, 999999},
		},
		{
			name:      "request path keeps matching type-58 and ordinary",
			ids:       []int{900003, 900010, 900011},
			modelName: "gpt-4",
			filters:   []dto.ChannelFilter{pathFilter},
			wantKept:  []int{900003, 900010},
		},
		{
			name:      "request path empties when only unmatched type-58 remains",
			ids:       []int{900011},
			modelName: "gpt-4",
			filters:   []dto.ChannelFilter{pathFilter},
			wantKept:  []int{},
			wantEmpty: dto.FilterRequestPath,
		},
		{
			name:      "no filters keeps every cached id",
			ids:       []int{900003, 900010, 900011},
			modelName: "gpt-4",
			filters:   nil,
			wantKept:  []int{900003, 900010, 900011},
		},
	}

	channelSyncLock.Lock()
	previous := channelsIDM
	channelsIDM = map[int]*Channel{
		900003: ordinary,
		900010: matchingCustom,
		900011: otherCustom,
	}
	t.Cleanup(func() {
		channelsIDM = previous
		channelSyncLock.Unlock()
	})

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			kept, emptiedBy := filterCandidateIDs(testCase.ids, testCase.modelName, testCase.filters)
			if testCase.wantKept == nil {
				assert.Nil(t, kept)
			} else {
				assert.Equal(t, testCase.wantKept, kept)
			}
			assert.Equal(t, testCase.wantEmpty, emptiedBy)
		})
	}
}

func TestFilterCandidateIDsPrefersCapableChannelWithoutExcludingTheRest(t *testing.T) {
	// openai converts every format; mistral converts none of the seven.
	capable := &Channel{Id: 900020, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled}
	incapable := &Channel{Id: 900021, Type: constant.ChannelTypeMistral, Status: common.ChannelStatusEnabled}
	preference := dto.ChannelFilter{Kind: dto.FilterCapability, RequiredFormat: constant.CapabilityClaude, Soft: true}

	channelSyncLock.Lock()
	previous := channelsIDM
	channelsIDM = map[int]*Channel{900020: capable, 900021: incapable}
	t.Cleanup(func() {
		channelsIDM = previous
		channelSyncLock.Unlock()
	})

	// With a capable candidate present the preference narrows to it.
	kept, emptiedBy := filterCandidateIDs([]int{900021, 900020}, "m", []dto.ChannelFilter{preference})
	assert.Equal(t, []int{900020}, kept)
	assert.Equal(t, dto.ChannelFilterKind(""), emptiedBy)

	// When only the incapable channel exists the preference is dropped: the
	// request still reaches the channel and gets the explicit refusal instead of
	// a "no available channel" error.
	kept, emptiedBy = filterCandidateIDs([]int{900021}, "m", []dto.ChannelFilter{preference})
	assert.Equal(t, []int{900021}, kept)
	assert.Equal(t, dto.ChannelFilterKind(""), emptiedBy)

	// A hard filter of the same kind keeps its requirement semantics.
	hard := preference
	hard.Soft = false
	kept, emptiedBy = filterCandidateIDs([]int{900021}, "m", []dto.ChannelFilter{hard})
	assert.Empty(t, kept)
	assert.Equal(t, dto.FilterCapability, emptiedBy)
}

func TestChannelSatisfiesFiltersIgnoresPreferences(t *testing.T) {
	// A pinned channel must never be rejected by a format preference: pins go
	// through this predicate, not through filterCandidateIDs.
	incapable := &Channel{Id: 900022, Type: constant.ChannelTypeMistral}
	ok, kind := ChannelSatisfiesFilters(incapable, "m", []dto.ChannelFilter{{
		Kind:           dto.FilterCapability,
		RequiredFormat: constant.CapabilityClaude,
		Soft:           true,
	}})
	require.True(t, ok)
	assert.Equal(t, dto.ChannelFilterKind(""), kind)

	// The same filter as a requirement rejects it.
	ok, kind = ChannelSatisfiesFilters(incapable, "m", []dto.ChannelFilter{{
		Kind:           dto.FilterCapability,
		RequiredFormat: constant.CapabilityClaude,
	}})
	assert.False(t, ok)
	assert.Equal(t, dto.FilterCapability, kind)

	// A channel whose capability is declared per channel makes no claim, so the
	// preference cannot exclude it either.
	ok, _ = ChannelSatisfiesFilters(&Channel{Id: 900023, Type: constant.ChannelTypeAdvancedCustom}, "m", []dto.ChannelFilter{{
		Kind:           dto.FilterCapability,
		RequiredFormat: constant.CapabilityClaude,
	}})
	assert.True(t, ok)
}

// Deployments without MEMORY_CACHE_ENABLED select through the database, so the
// format preference has to hold there too and must not depend on a performance
// flag. Abilities are written the way the application writes them, because the
// database path reads the denormalized priority from the ability row.
func TestDatabaseSelectionPrefersCapableChannelWithoutExcludingTheRest(t *testing.T) {
	db := newChannelCacheTestDB(t, "capability.db")
	previousDB := DB
	previousCache := common.MemoryCacheEnabled
	DB = db
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		DB = previousDB
		common.MemoryCacheEnabled = previousCache
	})

	baseURL := "http://127.0.0.1:1"
	higherPriority := int64(10)
	lowerPriority := int64(0)
	unable := &Channel{
		Id: 1, Type: constant.ChannelTypeMistral, Key: "k", Status: common.ChannelStatusEnabled,
		Name: "unable", Group: "default", Models: "capability-model", Priority: &higherPriority, BaseURL: &baseURL,
	}
	able := &Channel{
		Id: 2, Type: constant.ChannelTypeAnthropic, Key: "k", Status: common.ChannelStatusEnabled,
		Name: "able", Group: "default", Models: "capability-model", Priority: &lowerPriority, BaseURL: &baseURL,
	}
	for _, channel := range []*Channel{unable, able} {
		require.NoError(t, db.Create(channel).Error)
		require.NoError(t, channel.AddAbilities(db))
	}

	preference := []dto.ChannelFilter{{Kind: dto.FilterCapability, RequiredFormat: constant.CapabilityClaude, Soft: true}}

	selected, err := GetRandomSatisfiedChannel("default", "capability-model", 0, preference)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, able.Id, selected.Id, "the capable channel must win over the higher-priority channel that cannot convert Claude")

	// With the capable channel gone the preference is dropped, so the request
	// still reaches the unable one instead of failing as "no available channel".
	require.NoError(t, db.Delete(&Ability{}, "channel_id = ?", able.Id).Error)
	require.NoError(t, db.Delete(&Channel{}, able.Id).Error)

	selected, err = GetRandomSatisfiedChannel("default", "capability-model", 0, preference)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, unable.Id, selected.Id)
}

func TestChannelSatisfiesFilters(t *testing.T) {
	ordinary := &Channel{Id: 2, Type: constant.ChannelTypeOpenAI}
	custom := &Channel{Id: 3, Type: constant.ChannelTypeAdvancedCustom}
	custom.SetOtherSettings(kitdto.ChannelOtherSettings{
		AdvancedCustom: &kitdto.AdvancedCustomConfig{
			Routes: []kitdto.AdvancedCustomRoute{{
				IncomingPath: "/v1/chat/completions",
				Models:       []string{"gpt-4"},
			}},
		},
	})

	ok, kind := ChannelSatisfiesFilters(nil, "gpt-4", nil)
	assert.False(t, ok)
	assert.Equal(t, dto.ChannelFilterKind(""), kind)

	ok, kind = ChannelSatisfiesFilters(ordinary, "gpt-4", nil)
	require.True(t, ok)
	assert.Equal(t, dto.ChannelFilterKind(""), kind)

	ok, kind = ChannelSatisfiesFilters(ordinary, "gpt-4", []dto.ChannelFilter{{
		Kind:        dto.FilterRequestPath,
		RequestPath: "/v1/chat/completions",
	}})
	require.True(t, ok)
	assert.Equal(t, dto.ChannelFilterKind(""), kind)

	ok, kind = ChannelSatisfiesFilters(custom, "gpt-4", []dto.ChannelFilter{{
		Kind:        dto.FilterRequestPath,
		RequestPath: "/v1/responses",
	}})
	assert.False(t, ok)
	assert.Equal(t, dto.FilterRequestPath, kind)
}

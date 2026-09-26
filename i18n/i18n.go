package i18n

import (
	"embed"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
	"gopkg.in/yaml.v3"

	"github.com/zhourenke/pg-api/common"
)

// LangZhCN is the only language this fork ships: interface copy and API
// messages are always Simplified Chinese. There is no language negotiation and
// no per-user language setting, so callers never pass a language tag.
const LangZhCN = "zh-CN"

//go:embed locales/*.yaml
var localeFS embed.FS

var (
	bundle    *i18n.Bundle
	localizer *i18n.Localizer
	initOnce  sync.Once
)

// Init loads the embedded translation file and wires common.TranslateMessage.
func Init() error {
	var initErr error
	initOnce.Do(func() {
		bundle = i18n.NewBundle(language.Chinese)
		bundle.RegisterUnmarshalFunc("yaml", yaml.Unmarshal)

		if _, err := bundle.LoadMessageFileFS(localeFS, "locales/zh-CN.yaml"); err != nil {
			initErr = err
			return
		}

		localizer = i18n.NewLocalizer(bundle, LangZhCN)
		common.TranslateMessage = T
	})
	return initErr
}

// T translates a message key. The gin context is kept in the signature so call
// sites stay uniform across ApiErrorI18n/ApiSuccessI18n; the language is fixed.
func T(_ *gin.Context, key string, args ...map[string]any) string {
	if localizer == nil {
		return key
	}

	config := &i18n.LocalizeConfig{
		MessageID: key,
	}

	if len(args) > 0 && args[0] != nil {
		config.TemplateData = args[0]
	}

	msg, err := localizer.Localize(config)
	if err != nil {
		// Return key as fallback if translation not found
		return key
	}
	return msg
}

package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func performRouterRequest(handler http.Handler, method, path string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(""))
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestWebFallbackDoesNotCacheMissingAPIOrAssets(t *testing.T) {
	outer := gin.New()
	SetWebRouter(outer, WebAssets{IndexPage: []byte("dashboard")})
	for _, path := range []string{"/api/user/token/status", "/api/audit/self?p=1", "/v1/missing", "/assets/missing.js"} {
		t.Run(path, func(t *testing.T) {
			response := performRouterRequest(outer, http.MethodGet, path)
			assert.Equal(t, http.StatusNotFound, response.Code)
			assert.Contains(t, response.Body.String(), "Invalid URL")
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
			assert.NotContains(t, response.Header().Get("Cache-Control"), "604800")
		})
	}
	page := performRouterRequest(outer, http.MethodGet, "/security")
	assert.Equal(t, http.StatusOK, page.Code)
	assert.Equal(t, "dashboard", page.Body.String())
	assert.Equal(t, "no-cache", page.Header().Get("Cache-Control"))
}

func TestSecurityRoutesDisableCachingBeforeAuthentication(t *testing.T) {
	outer := gin.New()
	SetApiRouter(outer)
	for _, path := range []string{"/api/user/token/status", "/api/user/token", "/api/audit/self", "/api/audit"} {
		t.Run(path, func(t *testing.T) {
			response := performRouterRequest(outer, http.MethodGet, path)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		})
	}
}

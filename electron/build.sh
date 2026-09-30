#!/bin/bash

set -e

echo "Building pg-api Electron App..."

echo "Step 1: Building frontend..."
cd ../web
bun install --frozen-lockfile
DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat ../VERSION) bun run build
cd ../electron

echo "Step 2: Building Go backend..."
cd ..

# The repository VERSION file is the single source of truth for the version.
# Fail loudly instead of silently shipping a binary whose version is the
# hardcoded v0.0.0 fallback in common/constants.go.
if [ ! -s VERSION ]; then
    echo "VERSION file is missing or empty; cannot determine the build version." >&2
    exit 1
fi
# Only the version number is injected here: common/constants.go keeps the
# hardcoded v0.0.0 default, matching the makefile and Dockerfile flows.
VERSION_VALUE=$(cat VERSION)
LDFLAGS="-s -w -X 'github.com/zhourenke/pg-api/common.Version=$VERSION_VALUE'"
echo "Building version $VERSION_VALUE"

# electron-builder takes the installer and app version from electron/package.json,
# not from VERSION, so a stale value there ships installers whose version disagrees
# with the binary and with the web UI (electron/main.js reports app.getVersion()).
ELECTRON_VERSION=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' electron/package.json | head -n 1)
if [ "$ELECTRON_VERSION" != "$VERSION_VALUE" ]; then
    echo "electron/package.json version ($ELECTRON_VERSION) does not match VERSION ($VERSION_VALUE); bump both together." >&2
    exit 1
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Building for macOS..."
    CGO_ENABLED=1 go build -ldflags="$LDFLAGS" -o pg-api
    cd electron
    npm install
    npm run build:mac
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Building for Linux..."
    CGO_ENABLED=1 go build -ldflags="$LDFLAGS" -o pg-api
    cd electron
    npm install
    npm run build:linux
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    echo "Building for Windows..."
    CGO_ENABLED=1 go build -ldflags="$LDFLAGS" -o pg-api.exe
    cd electron
    npm install
    npm run build:win
else
    echo "Unknown OS, building for current platform..."
    CGO_ENABLED=1 go build -ldflags="$LDFLAGS" -o pg-api
    cd electron
    npm install
    npm run build
fi

echo "Build complete! Check electron/dist/ for output."

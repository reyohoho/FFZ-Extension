#!/bin/bash -e

# Build into a staging area first, then copy to each target directory.
STAGE=dist/_stage

# Clean previous build
rm -rf dist/chrome dist/firefox dist/userscript "$STAGE"

# Stage the shared web assets
mkdir -p "$STAGE/web"

# Clean stale hashed addon manifests from the target
rm -f "$STAGE/web"/addons.*.json
rm -f "$STAGE/web"/addons.json

cp -r client/dist/* "$STAGE/web/"
cp -r addons/dist/* "$STAGE/web/"
cp -rf src/* "$STAGE/"

# Remove some files that we don't want to include
# in our packaged extensions.
rm -rf "$STAGE/web/bom"
rm -rf "$STAGE/web/addons-bom"
rm -f "$STAGE/web/manifest.json"
rm -f "$STAGE/web/addons/manifest.json"

# Pick the newest addons.HASH.json (multiple may exist from prior builds).
latest=$(ls -t "$STAGE/web"/addons.*.json 2>/dev/null | head -1)
if [ -n "$latest" ]; then
  mv "$latest" "$STAGE/web/addons.json"
fi

# Clean up any remaining old hashed addons manifests
rm -f "$STAGE/web"/addons.*.json

# Copy staged output to Chrome and Firefox target directories
cp -r "$STAGE" dist/chrome
cp -r "$STAGE" dist/firefox

# Clean up staging area
rm -rf "$STAGE"

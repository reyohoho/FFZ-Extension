#!/bin/bash
set -ex # echo on, fail on first error

# Load the environment variables
source ffz_env

# Clean previous build artefacts. Webpack's `clean: true` only clears the
# per-entry `dist/addons/` and `dist/` subfolders, but NOT sibling outputs
# like `addons/dist/addons.<hash>.json` produced by WebpackManifestPlugin.
# Leaving stale hashed manifests around causes `scripts/copy-output.js` to
# pick an older one during the `addons.HASH.json` -> `addons.json` rename
# (mtimes become equal after `fs.copyFileSync`, so the sort is unstable).
rm -rf client/dist
rm -rf addons/dist
rm -rf dist

# Build the main client
cd client
pnpm install --frozen-lockfile
pnpm build:ext
cd ..

# Build the add-ons
cd addons
pnpm install --frozen-lockfile
pnpm build:ext
cd ..

# Safety net: strip any stale hashed addon manifests that might have survived
# (e.g. from an interrupted/earlier `pnpm build:ext` inside `addons/`).
# Only the newest one produced by the build above should remain.
if compgen -G "addons/dist/addons.*.json" > /dev/null; then
	# shellcheck disable=SC2012
	newest="$(ls -t addons/dist/addons.*.json | head -n 1)"
	for f in addons/dist/addons.*.json; do
		if [ "$f" != "$newest" ]; then
			rm -f "$f"
		fi
	done
fi

# Copy output to chrome/ and firefox/ target directories
node scripts/copy-output.js

# Update the version in the manifests
node scripts/update-manifest.js

# Generate the userscript
node scripts/build-userscript.js

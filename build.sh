#!/bin/bash
set -e # stop at the first failure
set -x # echo on

# Both source trees pin the pnpm version they were built with via the
# "packageManager" field in their package.json, so corepack (or pnpm's own
# version manager) selects it. Don't stop to ask before downloading it.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

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
pnpm --version
pnpm install --frozen-lockfile
pnpm build:ext
cd ..

# Build the add-ons
cd addons
pnpm --version
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

# Package versioned archives for distribution (Chrome/Firefox builds and
# a source archive required by Mozilla AMO for reproducible validation).
if [ -n "${FFZ_VERSION:-}" ] && [ -n "${FFZ_BUILD:-}" ]; then
	VERSION="${FFZ_VERSION}.${FFZ_BUILD}"
else
	VERSION="$(node -p "require('./client/package.json').version" 2>/dev/null || echo 4.0.0)"
fi

RELEASE_DIR="dist/releases"
mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR"/*.zip

CHROME_ZIP="ffz-chrome-v${VERSION}.zip"
FIREFOX_ZIP="ffz-firefox-v${VERSION}.zip"
SOURCE_ZIP="ffz-source-v${VERSION}.zip"

(cd dist/chrome  && zip -r -9 -X "../releases/${CHROME_ZIP}"  .)
(cd dist/firefox && zip -r -9 -X "../releases/${FIREFOX_ZIP}" .)

# Source archive for Firefox (AMO) validation. Must allow reviewers to
# reproduce the build, so include build scripts, env file and the vendored
# submodule sources while excluding build artefacts, caches and VCS data.
rm -f "${RELEASE_DIR}/${SOURCE_ZIP}"
zip -r -9 -X "${RELEASE_DIR}/${SOURCE_ZIP}" \
	build.sh \
	ffz_env \
	package.json \
	pnpm-lock.yaml \
	README.md \
	.gitignore \
	.gitmodules \
	scripts \
	src \
	client \
	addons \
	-x \
	"*/node_modules/*" \
	"*/dist/*" \
	"*/.git/*" \
	"*/.git" \
	"*/.github/*" \
	"*/.idea/*" \
	"*/.DS_Store" \
	"*/venv/*" \
	"*/__pycache__/*" \
	"*.log"

echo "Built archives in ${RELEASE_DIR}:"
ls -lh "${RELEASE_DIR}"

#!/bin/bash
set -e # stop at the first failure
set -x # echo on

# Both source trees pin the pnpm version they were built with via the
# "packageManager" field in their package.json, so corepack (or pnpm's own
# version manager) selects it. Don't stop to ask before downloading it.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Load the environment variables
source ffz_env

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

# Remove the dist folder if it exists
rm -rf dist

# Copy the output to the dist folder
chmod +x scripts/copy-output.sh
./scripts/copy-output.sh

# Update the version in the manifest
node scripts/update-manifest.js

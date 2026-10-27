#!/bin/bash

# Function to check if a directory is a valid git repository
check_git_repo() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        echo "Error: The directory '$dir' does not exist. Please follow the instructions in README to set up the working sources."
        exit 1
    fi
    if ! git -C "$dir" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        echo "The directory '$dir' does not contain a valid git repository. You likely didn't need to run this command."
        exit 1
    fi
}

# Check to make sure we have git repos.
check_git_repo "client"
check_git_repo "addons"

# Get the version of the main client.
#
# The build number must grow on every push to *either* repository, or the
# Chrome Web Store rejects the upload for reusing a version. It is the number
# of client commits since the commit that last changed package.json (the
# version bump) plus the number of add-ons commits made since that bump.
cd client
VERSION=$(node -p "require('./package.json').version")
CLIENT_COMMIT=$(git rev-parse HEAD)
BUMP_COMMIT=$(git log -1 --pretty=format:%H -- package.json)
LAST_MODIFIED=$(git log -1 --pretty=format:%ct "$BUMP_COMMIT")
CLIENT_BUILD=$(git rev-list --count "$BUMP_COMMIT..HEAD")
CLIENT_LAST=$(git log -1 --pretty=format:%ct)
CLIENT_MESSAGE=$(git log -1 --pretty=format:%B)
cd ..

# Get the version of the add-ons.
cd addons
ADDONS_COMMIT=$(git rev-parse HEAD)
ADDONS_BUILD=$(git rev-list --count --since=@$LAST_MODIFIED HEAD)
ADDONS_LAST=$(git log -1 --pretty=format:%ct)
ADDONS_MESSAGE=$(git log -1 --pretty=format:%B)
cd ..

BUILD=$((CLIENT_BUILD + ADDONS_BUILD))

# Determine which commit message is most recent
if [ "$CLIENT_LAST" -gt "$ADDONS_LAST" ]; then
    LATEST_MESSAGE="$CLIENT_MESSAGE"
else
    LATEST_MESSAGE="$ADDONS_MESSAGE"
fi

# Log the results
echo "Main Client Version: $VERSION"
echo "Commit: $CLIENT_COMMIT"
echo "Version Bumped At: $LAST_MODIFIED (commit $BUMP_COMMIT)"
echo "Client Commits Since: $CLIENT_BUILD"
echo ""
echo "Add-Ons Commit: $ADDONS_COMMIT"
echo "Add-Ons Commits Since: $ADDONS_BUILD"
echo ""
echo "Build Version: $BUILD"
echo ""
echo "Latest Commit Message:"
echo "$LATEST_MESSAGE"

# Export our environmental variables
echo "CLIENT_COMMIT=$CLIENT_COMMIT" >> .env
echo "FFZ_VERSION=$VERSION" >> .env
echo "ADDONS_COMMIT=$ADDONS_COMMIT" >> .env
echo "FFZ_BUILD=$BUILD" >> .env
echo 'LATEST_MESSAGE<<__EOCMHERE__' >> .env
echo "$LATEST_MESSAGE" >> .env
echo "__EOCMHERE__" >> .env

# Export our environmental variables (for the source archive)
echo "export CLIENT_COMMIT=$CLIENT_COMMIT" >> ffz_env
echo "export FFZ_VERSION=$VERSION" >> ffz_env
echo "export ADDONS_COMMIT=$ADDONS_COMMIT" >> ffz_env
echo "export FFZ_BUILD=$BUILD" >> ffz_env
printf 'export LATEST_MESSAGE="%s"\n' "$(echo "$LATEST_MESSAGE" | sed 's/"/\\"/g')" >> ffz_env

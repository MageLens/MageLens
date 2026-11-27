#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

source "$(dirname "$0")/../common.sh"
[[ $# == 2 && ( "$1" == cypress || "$1" == playwright ) ]] || fail "Usage: $0 cypress|playwright IMAGE"
export MAGELENS_RUNNER=$1 TEMPLATE_COVERAGE_PACKAGE=''
image=$2
fingerprint=$(node bin/image-inputs.cjs inputs "runner-$MAGELENS_RUNNER")
release_source=$(node -p 'require("./bin/image-inputs.cjs").repositoryUrl')
mkdir -p .runtime
context=$(mktemp -d "$ROOT/.runtime/runner-context.XXXXXX")
trap 'rm -rf "$context"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$context/bin" "$context/docker" "$context/.runtime/template-package"
cp .dockerignore package.json package-lock.json "$context/"
cp bin/{sync-dependencies.cjs,sync-runner-dependencies} "$context/bin/"
cp -R docker/runner "$context/docker/"
touch "$context/.runtime/template-package/.keep"

cd "$context"
ROOT=$context
source "$ROOT/bin/sync-runner-dependencies"

# Force the modes that reproduce the non-root startup failure even when CI
# checks out the repository with a permissive umask.
chmod 0600 package.json package-lock.json
find docker/runner .runtime/template-package -type f -exec chmod 0600 {} +
find docker/runner .runtime/template-package -type d -exec chmod 0700 {} +
say "Building the $MAGELENS_RUNNER runner from a context with 0600 files and 0700 directories"
docker build --pull --target "$MAGELENS_RUNNER" --file docker/runner/Dockerfile --tag "$image" \
    --label "org.magelens.inputs=$fingerprint" --label "org.opencontainers.image.source=$release_source" \
    --build-arg "RUNNER_IMAGE=$RUNNER_IMAGE" --build-arg "PLAYWRIGHT_RUNNER_IMAGE=$PLAYWRIGHT_RUNNER_IMAGE" \
    --build-arg "CHROME_VERSION=$CHROME_VERSION" --build-arg "CHROME_LINUX_X64_SHA256=$CHROME_LINUX_X64_SHA256" \
    --build-arg "CHROME_LINUX_ARM64_SHA256=$CHROME_LINUX_ARM64_SHA256" .

#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Build the adapter's browser base with the same dependency resolver and Dockerfile
# as installation, without changing the current installation's package selection.
source "$(dirname "$0")/../bin/common"
[[ $# == 3 && ( "$1" == playwright || "$1" == cypress ) && "$3" =~ ^[a-f0-9]{64}$ ]] || fail 'Expected RUNNER IMAGE INPUT_FINGERPRINT.'
export MAGELENS_RUNNER=$1 TEMPLATE_COVERAGE_PACKAGE=''
image=$2
fingerprint=$3
mkdir -p "$ROOT/.runtime"
context=$(mktemp -d "$ROOT/.runtime/branching-runner.XXXXXX")
trap 'rm -rf -- "$context"' EXIT
mkdir -p "$context/bin" "$context/docker" "$context/.runtime/template-package"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.dockerignore" "$context/"
cp "$ROOT/bin/sync-dependencies.cjs" "$context/bin/"
cp -a "$ROOT/docker/runner" "$context/docker/"
touch "$context/.runtime/template-package/.keep"
(
    synchronizer="$ROOT/bin/sync-runner-dependencies"
    ROOT=$context
    source "$synchronizer"
)
docker build --pull --target "$MAGELENS_RUNNER" --file "$context/docker/runner/Dockerfile" --tag "$image" \
    --label "org.magelens.branching-inputs=$fingerprint" \
    --label 'org.opencontainers.image.source=https://github.com/MageLens/MageLens' \
    --build-arg "RUNNER_IMAGE=$RUNNER_IMAGE" --build-arg "PLAYWRIGHT_RUNNER_IMAGE=$PLAYWRIGHT_RUNNER_IMAGE" \
    --build-arg "CHROME_VERSION=$CHROME_VERSION" --build-arg "CHROME_LINUX_X64_SHA256=$CHROME_LINUX_X64_SHA256" \
    --build-arg "CHROME_LINUX_ARM64_SHA256=$CHROME_LINUX_ARM64_SHA256" "$context"

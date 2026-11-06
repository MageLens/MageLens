#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail

fail() {
    printf 'MageLens: %s\n' "$*" >&2
    exit 1
}

shopt -s nullglob dotglob
entries=(*)
(( ${#entries[@]} == 0 )) || fail 'Run the bootstrap command in an empty directory. For an existing checkout, use ./install.sh.'

for command in wget tar; do
    command -v "$command" >/dev/null || fail "Install $command, then rerun the bootstrap command."
done

version=${MAGELENS_VERSION:-}
if [[ -z "$version" ]]; then
    release=$(wget -qO- https://api.github.com/repos/MageLens/MageLens/releases/latest) \
        || fail 'Could not look up the latest release. Retry or set MAGELENS_VERSION to a release tag.'
    version=$(printf '%s\n' "$release" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p')
fi
[[ "$version" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] \
    || fail 'Could not determine a valid release tag. Set MAGELENS_VERSION to a tag such as v1.8.2.'

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
printf 'Downloading MageLens %s...\n' "$version"
wget -qO "$temporary/release.tar.gz" "https://github.com/MageLens/MageLens/archive/refs/tags/$version.tar.gz" \
    || fail "Could not download MageLens $version."
mkdir "$temporary/source"
tar -xzf "$temporary/release.tar.gz" --strip-components=1 --no-same-owner -C "$temporary/source" \
    || fail "Could not extract MageLens $version."
[[ -x "$temporary/source/install.sh" ]] || fail 'The release archive does not contain an executable install.sh.'
cp -a "$temporary/source/." .
rm -rf -- "$temporary"
trap - EXIT

exec ./install.sh "$@"

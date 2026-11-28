#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd -P)
cd "$ROOT"
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ -f .runtime/installed || -f .runtime/install-profile ]] || fail 'No installation found at the old checkout root.'
[[ ! -e .runtime/workflow.lock && ! -e compose/.runtime/workflow.lock ]] || fail 'An install or coverage lock exists. Finish the active workflow before migrating.'
[[ -d compose && ! -L compose && ! -L .runtime && ! -L compose/.runtime ]] || fail 'Expected a local compose/ project directory.'
command -v rsync >/dev/null || fail 'Install rsync to copy the existing installation.'
source compose/bin/compose-project
resolve_compose_project
containers=$(docker ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --format '{{.ID}} {{.Label "com.docker.compose.project.working_dir"}}')
if [[ -n "$containers" ]]; then
    printf 'Compose project %s still has containers (ID and owning directory):\n%s\n' "$COMPOSE_PROJECT_NAME" "$containers" >&2
    fail 'Remove the old checkout containers as described in README.md before copying files.'
fi

# Pin the name resolved at the old root, including legacy directory-derived names.
config=$(mktemp -d)
trap 'rm -rf "$config"' EXIT
umask 077
mkdir "$config/.runtime"
if [[ -f .env ]]; then cp -p .env "$config/.env"; else touch "$config/.env"; fi
(ROOT=$config; save_compose_project)
config_files=(.env .runtime/compose-project-name)
for marker in installed install-profile; do
    if [[ -f .runtime/$marker ]]; then
        cp -p ".runtime/$marker" "$config/.runtime/"
        config_files+=(".runtime/$marker")
    fi
done

paths=()
for path in .runtime env src lib bin compose.versions.yaml rootCA.pem policies.json node_modules \
    coverage .nyc_output assets cli cypress docker docs examples patches playwright; do
    if [[ -e "$path" || -L "$path" ]]; then paths+=("$path"); fi
done
copy_state() {
    rsync "$@" --exclude=/.runtime/installed --exclude=/.runtime/install-profile \
        --exclude=/.runtime/compose-project-name -- "${paths[@]}" "$ROOT/compose/" || return 1
    (cd "$config" && rsync "$@" --relative --no-implied-dirs -- "${config_files[@]}" "$ROOT/compose/")
}

# Overlapping directories can merge. Detect different files, modes and link targets.
if ! conflicts=$(copy_state --recursive --links --checksum --perms --dry-run --existing --itemize-changes | sed '/^\.d/d'); then
    printf '%s\n' "$conflicts" >&2
    fail 'Could not compare the two layouts. Resolve the rsync errors and rerun.'
fi
if [[ -n "$conflicts" ]]; then
    printf 'Resolve conflicting paths in compose/ and rerun:\n%s\n' "$conflicts" >&2
    exit 1
fi
copy_state --archive --hard-links --ignore-existing
printf 'Copied installation to compose/ using Docker project %s. From compose/ run ./bin/start.\n' "$COMPOSE_PROJECT_NAME"

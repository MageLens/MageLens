#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source bin/common
preflight
scratch=$(mktemp -d /tmp/magelens-feasibility.XXXXXX)
project="magelens-probe-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup() {
    result=$?
    trap - EXIT
    docker compose -p "$project" -f "$scratch/compose.yaml" down --volumes --remove-orphans || result=1
    rm -rf "$scratch"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'host-written\n' > "$scratch/input"
cat > "$scratch/compose.yaml" <<'COMPOSE'
services:
  server:
    image: alpine:3.22
    command: [sh, -ec, 'test "$(cat /probe/input)" = host-written; echo container-written > /probe/output; ln -s input /probe/link; mkdir -p /www; echo network-ok > /www/index.html; httpd -f -p 8080 -h /www']
    volumes: [".:/probe"]
    ports: ["127.0.0.1::8080"]
  client:
    image: alpine:3.22
    command: [sh, -ec, 'wget -qO- http://server:8080 | grep network-ok']
COMPOSE
docker compose -p "$project" -f "$scratch/compose.yaml" up -d server
# Wait only for readiness; assertions below are never retried.
for attempt in {1..30}; do [[ ! -f "$scratch/output" ]] || break; sleep 1; done
[[ "$(cat "$scratch/output")" == container-written ]]
[[ -L "$scratch/link" && "$(cat "$scratch/link")" == host-written ]]
docker compose -p "$project" -f "$scratch/compose.yaml" run --rm client
endpoint=$(docker compose -p "$project" -f "$scratch/compose.yaml" port server 8080)
curl --fail --silent "http://$endpoint" | grep network-ok

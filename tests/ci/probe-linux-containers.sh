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
    docker compose -p "$project" -f "$scratch/compose.yaml" logs --no-color || result=1
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
    image: ${PLAYWRIGHT_RUNNER_IMAGE}
    command: [node, -e, 'const fs=require("fs"); if(fs.readFileSync("/probe/input","utf8").trim()!=="host-written") process.exit(1); fs.writeFileSync("/probe/output","container-written"); fs.symlinkSync("input","/probe/link"); require("http").createServer((req,res)=>res.end("network-ok")).listen(8080);']
    volumes: [".:/probe"]
    ports: ["127.0.0.1::8080"]
  client:
    image: ${PLAYWRIGHT_RUNNER_IMAGE}
    command: [node, -e, 'fetch("http://server:8080").then(r=>r.text()).then(t=>{if(t!=="network-ok")process.exit(1)}).catch(()=>process.exit(1))']
COMPOSE
docker compose -p "$project" -f "$scratch/compose.yaml" up -d server
# Wait only for readiness; assertions below are never retried.
for attempt in {1..30}; do [[ ! -f "$scratch/output" ]] || break; sleep 1; done
[[ "$(cat "$scratch/output")" == container-written ]]
[[ -L "$scratch/link" && "$(cat "$scratch/link")" == host-written ]]
docker compose -p "$project" -f "$scratch/compose.yaml" run --rm client
endpoint=$(docker compose -p "$project" -f "$scratch/compose.yaml" port server 8080)
curl --fail --silent "http://$endpoint" | grep network-ok

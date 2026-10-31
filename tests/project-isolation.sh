#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
original_root=$ROOT
scratch=$(mktemp -d /tmp/magelens-isolation.XXXXXX)
prefix="magelens-isolation-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
# Never inherit a project selection from the user's shell.
unset COMPOSE_PROJECT_NAME APPLICATION_DOMAIN
compose() { "$scratch/$1/bin/application-compose" "${@:2}"; }
cleanup() {
    local result=$? cleanup_failed=0
    trap - EXIT
    for checkout in first second; do
        [[ -f "$scratch/$checkout/.runtime/compose-project-name" ]] || continue
        compose "$checkout" down --volumes --remove-orphans || cleanup_failed=1
    done
    if (( cleanup_failed )); then
        printf 'Isolation cleanup failed; temporary checkouts retained at %s\n' "$scratch" >&2
        exit 1
    fi
    rm -rf "$scratch"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for checkout in first second; do
    directory="$scratch/$checkout"
    mkdir -p "$directory/bin" "$directory/.runtime"
    cp "$original_root"/bin/{application-compose,common,compose-project,dependencies} "$directory/bin/"
    cp "$original_root/dependencies.yaml" "$directory/"
    printf 'APPLICATION_DOMAIN=%s.test\n' "$prefix-$checkout" > "$directory/.env"
    cat > "$directory/compose.yaml" <<'COMPOSE'
services:
  probe:
    image: ${PLAYWRIGHT_RUNNER_IMAGE}
    environment:
      PROJECT: ${COMPOSE_PROJECT_NAME}
    command:
      - node
      - -e
      - "require('fs').writeFileSync('/data/project', process.env.PROJECT); require('http').createServer((req,res) => res.end(process.env.PROJECT)).listen(8080)"
    volumes: [data:/data]
    ports: ["127.0.0.1::8080"]
    networks:
      default:
        aliases: ["${APPLICATION_DOMAIN}"]
    healthcheck:
      test: [CMD, node, -e, "require('http').get('http://localhost:8080', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 1s
      timeout: 5s
      retries: 30
volumes:
  data:
COMPOSE
    (
        source "$directory/bin/common"
        source "$directory/bin/compose-project"
        resolve_compose_project "$prefix-$checkout"
        save_compose_project
    )
    compose "$checkout" up -d --wait --wait-timeout 60
    container=$(compose "$checkout" ps -q probe)
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" == "$prefix-$checkout" ]]
    compose "$checkout" exec -T probe node -e 'if (require("fs").readFileSync("/data/project", "utf8") !== process.env.PROJECT) process.exit(1)'
done
[[ "$(compose first port probe 8080)" != "$(compose second port probe 8080)" ]]
second_container=$(compose second ps -q probe)
compose first stop
[[ "$(compose second ps -q probe)" == "$second_container" ]]
compose first down --volumes --remove-orphans
[[ "$(compose second ps -q probe)" == "$second_container" ]]
docker volume inspect "${prefix}-second_data" >/dev/null
compose second exec -T probe node -e 'if (require("fs").readFileSync("/data/project", "utf8") !== process.env.PROJECT) process.exit(1)'
compose second exec -T probe node -e 'require("http").get("http://localhost:8080", r => {let data = ""; r.on("data", c => data += c); r.on("end", () => process.exit(data === process.env.PROJECT ? 0 : 1))}).on("error", () => process.exit(1))'
printf 'PASS: distinct Compose projects, networks, ports and volumes; stopping/removing one preserves the other.\n'

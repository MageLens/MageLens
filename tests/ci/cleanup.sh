#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# Only the resource registered by this job's harness may be removed.
[[ -f "$RUNNER_TEMP/magelens-resource" ]] || exit 0
read -r project scratch < "$RUNNER_TEMP/magelens-resource"
[[ "$project" == magelens-e2e-* && "$scratch" == /tmp/magelens-e2e.* ]]
if [[ -f "$scratch/.runtime/docker-magento/compose/compose.yaml" ]]; then
    (cd "$scratch" && ./bin/application-compose --profile '*' down --volumes --remove-orphans)
fi
if docker volume inspect "${project}_composerdata" >/dev/null 2>&1; then
    docker volume rm "${project}_composerdata"
fi
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]]
[[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]]
rm -rf "$scratch"

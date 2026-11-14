#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."
image=${1:?Expected image}
fingerprint=${2:?Expected input fingerprint}
# An explicit source archive keeps installed applications and private runtime files
# out of the build context, including unreadable files owned by service containers.
tar -cf - package.json package-lock.json branching-baseline.json \
    branching/planner/Dockerfile branching/planner/Cargo.toml branching/planner/Cargo.lock \
    branching/planner/src branching/planner/tests branching/predictor/*.cjs \
    branching/estimation.cjs branching/identity.cjs branching/configs/messages.cjs |
    docker build --file branching/planner/Dockerfile --tag "$image" \
        --label "org.magelens.inputs=$fingerprint" \
        --label 'org.opencontainers.image.source=https://github.com/MageLens/MageLens' -

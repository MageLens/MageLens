#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: tests/ci/predictor-image.sh IMAGE' >&2; exit 1; }
# Works for both the model image and the orchestrator that embeds it.
docker run --rm --network none --memory 64m --memory-swap 64m --entrypoint sha256sum "$1"     /opt/magelens/predictor/model.json |     diff - <(printf '%s  /opt/magelens/predictor/model.json\n' f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3)

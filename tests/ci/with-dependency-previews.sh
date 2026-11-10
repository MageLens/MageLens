#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
node tests/ci/dependency-previews.cjs
if [[ -f .github/dependency-previews.json ]] && node -e 'process.exit(require("./.github/dependency-previews.json").templateCoverage ? 0 : 1)'; then
    export MAGELENS_TEMPLATE_COVERAGE_PACKAGE="$PWD/.runtime/template-coverage.tgz"
fi
exec "$@"

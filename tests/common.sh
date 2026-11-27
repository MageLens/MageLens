#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Load runtime commands from a contributor checkout or an isolated installation.
TESTS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd "$TESTS_ROOT/.." && pwd)
if [[ -f "$REPOSITORY_ROOT/compose/bin/common" ]]; then
    source "$REPOSITORY_ROOT/compose/bin/common"
else
    source "$REPOSITORY_ROOT/bin/common"
fi

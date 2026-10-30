#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
result=0
export MAGELENS_MATRIX_REPORT=${MAGELENS_MATRIX_REPORT:-$PWD/.runtime/e2e/matrix-comparison.json}
mkdir -p "$(dirname "$MAGELENS_MATRIX_REPORT")"
printf '{"passed":false,"status":"running"}\n' > "$MAGELENS_MATRIX_REPORT"
results=$(mktemp -d /tmp/magelens-matrix.XXXXXX)
trap 'rm -rf "$results"' EXIT
reports=()
bash tests/project-isolation.sh || result=1
for platform in magento mageos; do
    for theme in luma hyva; do
        for runner in cypress playwright; do
            output="$results/$platform-$theme-$runner"
            if MAGELENS_E2E_RESULT_FILE="$output" MAGELENS_E2E_PLATFORM="$platform" MAGELENS_E2E_THEME="$theme" MAGELENS_E2E_RUNNER="$runner" bash tests/e2e-isolated.sh; then
                reports+=("$(cat "$output")")
            else result=1; fi
        done
    done
done
if (( result == 0 )); then
    node tests/compare-matrix.cjs "${reports[@]}" || result=1
else
    printf '{"passed":false,"status":"installation-failed"}\n' > "$MAGELENS_MATRIX_REPORT"
fi
exit "$result"

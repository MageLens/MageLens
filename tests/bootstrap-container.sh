#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
scratch=$(mktemp -d /tmp/magelens-bootstrap.XXXXXX)
project="magelens-bootstrap-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
cleanup() {
    (cd "$scratch" && COMPOSE_PROJECT_NAME="$project" ./bin/application-compose down --volumes --remove-orphans) >/dev/null 2>&1 || true
    rm -rf "$scratch"
}
trap cleanup EXIT
mkdir -p "$scratch/bin" "$scratch/src" "$scratch/coverage" "$scratch/.runtime/pcov" "$scratch/.runtime/magento" "$scratch/.runtime/docker-magento"
cp compose.yaml dependencies.yaml "$scratch/"
cp bin/common bin/compose-project bin/dependencies bin/application-compose bin/expose-tools "$scratch/bin/"
cp -a docker patches "$scratch/"
cp -a .runtime/docker-magento/compose "$scratch/.runtime/docker-magento/"
printf 'COMPOSE_PROJECT_NAME=%s\nAPPLICATION_DOMAIN=bootstrap.magelens.test\n' "$project" > "$scratch/.env"
# Short health intervals keep the deliberately broken-container regression bounded.
printf '%s\n' '{"services":{"phpfpm":{"healthcheck":{"interval":"1s","retries":1,"start_period":"0s"}}}}' > "$scratch/.runtime/compose.sources.json"
(
    cd "$scratch"
    # Ignore a caller's project override so cleanup can only touch this test's volumes.
    export COMPOSE_PROJECT_NAME="$project"
    ./bin/expose-tools
    source bin/common
    for phase in fresh resumed unhealthy; do
        previous_container=''
        if [[ "$phase" == unhealthy ]]; then
            previous_container=$(dc ps -a -q phpfpm)
            # The master remains running, but clients can no longer reach its socket.
            dc exec -T -w /tmp phpfpm rm /sock/phpfpm.sock
            for attempt in {1..20}; do
                health=$(docker inspect --format '{{.State.Health.Status}}' "$previous_container")
                [[ "$health" != unhealthy ]] || break
                sleep 1
            done
            [[ "$health" == unhealthy ]] || { echo 'Test FPM did not become unhealthy.' >&2; exit 1; }
        fi
        start_php_for_setup
        if [[ -n "$previous_container" ]]; then
            [[ "$(dc ps -a -q phpfpm)" != "$previous_container" ]] || { echo 'Setup reused the unhealthy container.' >&2; exit 1; }
        fi
        # Use the real upstream CLI wrapper and the same non-root user as auth setup.
        ./bin/clinotty php -r '
            if (posix_geteuid() === 0) exit(1);
            foreach (["/sock", "/var/www/.composer", "/bootstrap"] as $directory) {
                if (fileowner($directory) !== posix_geteuid() || !is_writable($directory)) exit(1);
            }
            if (!@fsockopen("unix:///sock/phpfpm.sock")) exit(1);
        '
        ./bin/clinotty composer config --global cache-dir >/dev/null
        [[ ! -e src/composer.json && ! -e src/app/etc/env.php ]]
        echo "PASS: $phase install starts non-root PHP and the upstream Composer CLI before Magento exists."
        [[ "$phase" != fresh ]] || dc stop -t 10 phpfpm
    done
)

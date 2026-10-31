#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
scratch=$(mktemp -d /tmp/magelens-todo.XXXXXX)
original_root=$ROOT
cleanup() {
    local result=$?
    trap - EXIT
    if [[ -f "$scratch/.runtime/docker-magento/compose/compose.yaml" ]]; then
        (cd "$scratch" && ./bin/application-compose down -v --remove-orphans) || result=1
    fi
    rm -rf "$scratch"
    exit "$result"
}
trap cleanup EXIT
for file in bin docker patches cypress tests assets install.sh compose.yaml dependencies.yaml package.json package-lock.json cypress.config.cjs README.md; do
    cp -a "$file" "$scratch/"
done
# This fixture deliberately contains neither of the original demo directories.
rm -rf "$scratch/cypress/e2e"
mkdir -p "$scratch/cypress/e2e" "$scratch/src/app/code/Vitalii" "$scratch/src/app/design/frontend/Vitalii"
cp -a tests/fixtures/todo/module "$scratch/src/app/code/Vitalii/TodoList"
cp -a tests/fixtures/todo/theme "$scratch/src/app/design/frontend/Vitalii/todo"
mkdir -p "$scratch/src/app/code/Vitalii/TodoList/Test/Cypress"
cp tests/fixtures/todo/*.cy.js "$scratch/src/app/code/Vitalii/TodoList/Test/Cypress/"
printf 'COMPOSE_PROJECT_NAME=magelens-todo-check-%s\nAPPLICATION_DOMAIN=todo.magelens.test\nAPPLICATION_PORT=%s\nAPPLICATION_HTTPS_PORT=%s\nCYPRESS_VIEW_PORT=%s\n' \
    "$$" "${MAGELENS_TEST_PORT:-8099}" "${MAGELENS_TEST_HTTPS_PORT:-8449}" "${MAGELENS_TEST_VIEW_PORT:-6099}" > "$scratch/.env"
cd "$scratch"
./install.sh
./bin/run-coverage
node tests/verify-todo.cjs
node - <<'JS'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const project = JSON.parse(fs.readFileSync('.runtime/project.json'));
assert.deepEqual(project.roots, ['app/code', 'app/design/frontend']);
const php = JSON.parse(fs.readFileSync('coverage/php/merged-lines.json'));
const template = '/var/www/html/app/design/frontend/Vitalii/todo/Magento_Theme/templates/todo-note.phtml';
assert.ok(Object.values(php[template] || {}).includes(1));
const html = JSON.parse(fs.readFileSync('coverage/templates/coverage-summary.json')).templates;
assert.ok(html.some(file => file.path.includes('app/design/frontend/Vitalii/') && file.statementSummary.covered > 0));
console.log('PASS: custom module and theme work without any original demo namespace.');
JS
mkdir -p "$original_root/.runtime/todo-verification"
cp -a coverage "$original_root/.runtime/todo-verification/without-demo"

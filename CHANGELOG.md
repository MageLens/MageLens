# Release notes

## 1.6.1 - 2026-10-31

- Update PIE to 1.5.5, fixing unsafe temporary-file handling of failed build output ([GHSA-4538-pqqf-mv67](https://github.com/php/pie/security/advisories/GHSA-4538-pqqf-mv67)). PCOV remains pinned to 2.1.2.
- Include the Elastic License 2.0 and usage guidance already added to the repository.

After updating, rerun `./install.sh` with your existing platform, theme and runner flags to rebuild the PHP image, then run `./bin/run-coverage`.

## 1.6.0 - 2026-10-30

- Remove legacy non-CSP Hyvä support, its package selection and coverage example. `--hyva` continues to install Hyvä CSP.
- Reject `--nocsp` and saved `hyva-legacy` profiles before changing the environment. Back up the application and database, then migrate customizations to CSP in a separate checkout on the same platform with a different Docker project, domain and ports. Keep the old profile and data unchanged; use the previous MageLens release to manage that installation.
- Reduce the complete E2E matrix to eight combinations: Magento Open Source and Mage-OS, Luma and Hyvä CSP, Cypress and Playwright. Retain shared Alpine coverage, CSP enforcement, source preservation and viewer recovery checks.
- Keep the runner display ready between startup checks and desktop clients, preventing intermittent window-manager startup failures.
- Retry temporary Git and Docker download failures during installation; persistent failures still stop setup.

## 1.5.1 - 2026-10-29

- Update Cypress to 16.2.1 for TLS verification, compressed HTTPS responses and test reliability fixes.
- Update the Docker Magento foundation to 53.2.0, retaining the patched PHP 8.4.27 base.
- Update template coverage to 1.5.3, with Node.js 24 and 26 compatibility checks. MageLens runners continue to use Node.js 24.22.1.
- Prepare Admin login assets before Blog scenarios, avoiding cold asset-generation timeouts on fresh installations.

After updating, rerun `./install.sh` with your platform, theme and runner flags, then `./bin/run-coverage`.

## 1.5.0 - 2026-10-27

- Choose an isolated Docker project during installation with `--project-name NAME`. The saved name is used by installation, coverage and service commands; existing installations reject name changes that would select different application data.
- Measure Hyvä Alpine listeners with PHP-generated event names, including gallery and price updates, at their original PHTML lines.
- Preserve modifier-only listeners such as `@submit.prevent` without unsupported-directive warnings or invented expression coverage.

After updating, rerun `./install.sh` with your platform, theme and runner flags, then `./bin/run-coverage` to regenerate coverage reports. Keep the existing Docker project name when reusing application data.

## 1.4.2 - 2026-10-23

- Update both Cypress and Playwright runners to Node.js 24.22.1, including the October security fixes for Brotli, TLS and DNS.

After updating, rerun `./install.sh` with your platform, theme and runner flags, then `./bin/run-coverage`.

## 1.4.1 - 2026-10-22

- Update PHP to 8.4.27, with its base image selected through `PHP_IMAGE` in `dependencies.yaml`.

After updating, rerun `./install.sh` with your platform, theme and runner flags, then `./bin/run-coverage`.

## 1.4.0 - 2026-10-20

- Install Mage-OS with `./install.sh --mageos`, without Magento Marketplace credentials. Magento Open Source remains the default.
- Combine `--mageos` with Luma, Hyvä CSP or legacy Hyvä, using Cypress or Playwright. Coverage reports and the live viewer work the same way on either platform.
- Retry interrupted Composer package downloads automatically, reusing packages already downloaded.
- Keep page-change animations disabled in both browser suites for consistent navigation, including Mage-OS Admin pages.
- Keep Blog Admin navigation working with Mage-OS's fixed sidebar in Cypress scenarios.
- Check all twelve platform, storefront and browser runner combinations with `npm run test:e2e:matrix`, including source preservation, coverage reports and viewer recovery after restarts.

After updating, rerun `./install.sh` with your platform, theme and runner flags, then `./bin/run-coverage`. For a new Mage-OS environment with Hyvä CSP and Playwright, use `./install.sh --mageos --hyva --playwright` in a separate directory with its own Docker project and ports. Changing an existing installation between Magento and Mage-OS is not supported.

## 1.3.3 - 2026-10-20

- Watch both Cypress and Playwright through the same read-only noVNC viewer. Warm-up and tests run with a visible browser inside Docker, using the same start, stop, and coverage commands.
- Use `./bin/runner COMMAND` for tools in the selected test container, and `npm run coverage` as an optional host-side alias for `./bin/run-coverage`. The existing `npm run cy:coverage` alias still works.
- Configure the viewer with `RUNNER_VIEW_PORT`. Existing `CYPRESS_VIEW_PORT` settings remain supported for either runner.
- Check viewer access and browser recovery after container restarts in all six theme/runner E2E flows.

After updating, rerun `./install.sh` with your existing theme and runner flags (for example, `./install.sh --hyva --playwright`), then run `./bin/run-coverage`. This rebuilds the runner with the shared viewer and preserves existing application data.

## 1.3.2 - 2026-10-18

- PHP coverage now counts executable PHP lines without counting emitted HTML or inline JavaScript as PHP execution.
- PHP source reports display the original files and reject sources changed since collection. Unvisited PHP files remain included.
- The coverage overview and JSON summary identify unsupported template directives and other measurement gaps.
- PHP report labels identify the selected browser runner.

## 1.3.1 - 2026-10-18

- Add `withCoverage(test)` to preserve existing Playwright fixtures while collecting PHP, JavaScript and template coverage.
- Keep external suite selection explicit in the project configuration. The presence of an elgentos directory no longer changes MageLens’s default fixture or path aliases.

## 1.3.0 - 2026-10-18

- Make `--hyva` install the CSP theme with enforced storefront script policy. Use `--hyva --nocsp` for the legacy theme with either runner.
- Support CSP-compatible Blog flows, Alpine bindings and inline template coverage. Keep script policies enabled during Cypress checks.
- Keep instrumented templates functional during unmeasured warm-up in both runners.
- Update template coverage to 1.5.0, linking PHP-rendered JavaScript to child template source files and distinguishing empty, unresolved and unobserved output.
- Verify child-template source attribution, executed functions and uncovered branches in all six Luma/Hyvä CSP/legacy Hyvä and Cypress/Playwright installation checks.

## 1.2.0 — 2026-10-18

- Updated Magento template coverage to 1.3.0. HTML/PHTML bindings, template expressions and inline scripts now share the template report, with script functions and branches mapped to original source lines. PHP executable lines remain in the PHP report.
- JavaScript reports contain whole `.js` files and use statement percentages, with separate application and bundled-library views.
- Added optional vendor coverage roots and explicit JavaScript distribution selection in `coverage.config.json`, including a Hyvä example and checks for required runtime assets.
- Rebuilding Playwright reports no longer counts previously merged hits twice. Stale JavaScript instrumentation is rejected.

After updating, rerun `./install.sh` with your selected theme and runner flags, then `./bin/run-coverage` to regenerate instrumentation and reports. Remove the retired `javascript.inline` option from existing coverage configurations.

## 1.1.0 — 2026-10-17

- Added four exclusive installation modes: Luma/Cypress by default, `--hyva` for Hyvä, `--playwright` for Playwright, or both flags together.
- Each installation includes only its selected runner, browser cache, and tooling. Playwright installations omit the Cypress desktop viewer.
- `./bin/run-coverage` uses the saved runner selection and generates PHP, JavaScript, and template reports with either runner.
- Added execution coverage for regular Hyvä/Alpine directives in PHTML while preserving original PHP source lines.
- `npm run test:e2e:matrix` checks all four combinations in separate temporary installations, including elgentos Playwright guest fixtures and generated coverage reports.
- The bundled Blog supports Hyvä and provides equivalent publishing, moderation, validation, permissions, and storefront scenarios in both browser runners.
- The installation matrix verifies all seven scenarios in every mode and compares coverage for shared application code.
- Updated Magento template coverage to 1.2.0 from npm.

When updating from v1.0.14, replace the MageLens project files and rerun `./install.sh` to refresh dependencies and assets, then run `./bin/run-coverage`. The default remains Luma/Cypress. Add `--hyva`, `--playwright`, or both flags to select another combination, and repeat those flags whenever you rerun the installer.

## 1.0.14 — 2026-10-17

- Updated Cypress to 16.2.0, the Node 24 runner image to 24.22.0, PIE to 1.5.2, and PHP code coverage to 11.0.12.
- Updated Magento template coverage to 1.1.2, preserving Prototype DOM extensions on Admin pages. Retired the Admin form patch while retaining automatic recovery for interrupted older runs.
- Centralized the Cypress coverage adapter, Istanbul libraries, and nyc versions in `dependencies.yaml`, alongside the existing browser dependencies.
- Added `npm run test:e2e` for a clean temporary Magento install, real Cypress execution, and validation of all generated coverage reports, using container-only HTTPS.

When updating from v1.0.13, replace the project files and rerun `./install.sh` to install the updated dependencies and refresh published assets, then run `./bin/run-coverage`.

## 1.0.13 — 2026-10-11

- PHP, JavaScript, and HTML template coverage now excludes directories named `Test` or `Setup` from report totals.

When updating from v1.0.12, replace the project files and run `./bin/run-coverage` directly; rerunning the installer is unnecessary. The next run refreshes the coverage scope and browser instrumentation automatically.

## 1.0.12 — 2026-10-09

- Updated Magento template coverage to 1.1.1 so instrumented Underscore and Magento literal templates render safely while the execution collector is unavailable.
- Cypress reconnects restore a deleted template execution helper in retained documents.

When updating from v1.0.11, replace the project files and rerun `./install.sh` once to install the updated template coverage dependency, then use `./bin/run-coverage` as usual.

## 1.0.11 — 2026-10-06

- JavaScript coverage excludes Cypress specs and support directories from instrumentation and report totals, including stale records from older releases.
- Unvisited application JavaScript still contributes zero-hit coverage, and source integrity checks still include test files.

When updating from v1.0.10, replace the project files and run `./bin/run-coverage` directly; rerunning the installer is unnecessary. The next run rebuilds instrumentation automatically.

## 1.0.10 — 2026-10-06

- Homepage warm-up no longer times out because Magento initialization markers remain after assets have finished loading. Unfinished browser requests and RequireJS modules still block preparation and produce diagnostics.

When updating from v1.0.9, replace the project files and run `./bin/run-coverage` directly; rerunning the installer is unnecessary.

## 1.0.9 — 2026-10-06

- Reinstalling recreates PHP-FPM before Composer setup, allowing recovery from unhealthy containers and stale source mounts.
- Installation failures now show Docker health-check results and PHP socket connection errors alongside container logs.

If installation failed at PHP-FPM startup, replace the project files and rerun `./install.sh`. Existing source, Composer credentials and database volumes are retained.

## 1.0.8 — 2026-10-06

- `./bin/run-coverage` automatically warms the storefront homepage and its dynamic assets before testing, reducing first-run timeouts after installation or an asset refresh.
- Warm-up has bounded timeouts and reports unfinished requests and RequireJS modules when preparation fails.
- Coverage starts afterward in a fresh browser session, with the existing test timeouts and two-command workflow.

When updating from v1.0.7, replace the project files and run `./bin/run-coverage` directly; rerunning the installer is unnecessary.

## 1.0.7 — 2026-09-27

- Demo tests wait for asynchronous storefront and theme templates to render before checking the page.
- An interrupted Admin scenario no longer changes the storefront scenario's expected article count.

When updating from v1.0.6, replace the project files and run `./bin/run-coverage` directly; rerunning the installer is unnecessary.

## 1.0.6 — 2026-09-27

- Coverage runs reuse running services and unchanged browser instrumentation. They no longer restart containers, rewrite Magento configuration, or clear caches and static assets automatically.
- Use `--start`, `--refresh-cache`, `--refresh-assets`, and `--restart-php` when needed. Options can be combined.
- Coverage settings are explicit in `docker/php/env.php.sample` and merged into Magento's `env.php` during installation. HTML/PHTML and browser assets run without minification.
- Cypress uses your configured HTTPS domain. Source edits and selected theme changes are picked up without restarting PHP.

For an existing installation, rerun `./install.sh` once after updating, then use `./bin/run-coverage` as usual.

## 1.0.5 — 2026-09-27

- The Cypress runner recovers after an interrupted container shutdown, including during installation's SSL restart.
- Installation and coverage commands print service logs when a required container fails to start.

## 1.0.4 — 2026-09-27

- The bundled demo now selects its real storefront theme when no theme is configured. Reinstalling preserves your theme choices.
- PHP, JavaScript, and template reports follow the selected local themes and their parents. Inactive themes and `vendor` are excluded.
- Theme-specific demo content no longer prevents using another storefront theme.
- Static assets retain coverage instrumentation across repeated requests, fixing missing JavaScript and template hits.
- Magento's first-use generated classes no longer invalidate an otherwise valid PHP report.
- The storefront CSRF test now checks the rejection redirect without consuming its error message.
- Setup and patch documentation is shorter, and installation archives omit maintainer tests and release automation.

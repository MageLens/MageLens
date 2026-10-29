# Test your installation

Run the fast integration checks with `npm run test:integration`.

For a real Magento Open Source installation and browser run in a new `/tmp` directory:

```bash
MAGELENS_COMPOSER_AUTH_FILE="$HOME/.composer/auth.json" bash tests/e2e-isolated.sh
```

`npm run test:e2e` runs the same check. Docker is required; host PHP, Composer, and Node are not required for the Bash command. Magento Open Source also requires Magento Marketplace credentials. By default, the test reads `auth.json` from `COMPOSER_HOME`, or `$HOME/.composer` when unset. It copies credentials into a temporary Docker volume without printing them.

To test Mage-OS without Marketplace credentials:

```bash
MAGELENS_E2E_PLATFORM=mageos bash tests/e2e-isolated.sh
```

Mage-OS checks install with `--mageos` and do not copy Composer credentials, even when the Magento credential settings are present.

To reuse credentials saved by an existing MageLens installation, set `MAGELENS_COMPOSER_AUTH_VOLUME` instead, for example `MAGELENS_COMPOSER_AUTH_VOLUME=magelens_composerdata bash tests/e2e-isolated.sh`. This takes precedence over the file setting, mounts the existing volume read-only, and copies only `auth.json` into the test's own volume.

By default, the test installs Luma with Cypress using the versions in `dependencies.yaml`, runs the bundled browser suites, and verifies PHP, JavaScript, and template coverage reports. It also checks that reports belong to the current run, original source files are unchanged, and test data is cleaned up. The installer uses `--container-only` to generate HTTPS inside Docker; it does not edit host DNS or certificate trust.

Each invocation has its own Compose project, image tags, database, credentials, and source. Ports default to **18080**, **18443**, and **16080**. Override `MAGELENS_TEST_PORT`, `MAGELENS_TEST_HTTPS_PORT`, and `MAGELENS_TEST_VIEW_PORT` when those ports are occupied or when running tests concurrently.

Reports, screenshots, and logs are retained under `.runtime/e2e/<project>/`, including `coverage/index.html`. Containers, named volumes, and temporary source are removed on success, failure, or a handled interruption. A failed Docker cleanup retains the temporary workspace and reports its location. Built images and Docker build cache remain available for subsequent runs. Forced process termination may require manual cleanup of that test's project.

For debugging, `MAGELENS_E2E_KEEP_ON_FAILURE=1` retains a failed test's workspace and running services. The failure output includes its location and Compose cleanup command; remove that temporary directory after stopping its services and volumes.

These E2E checks validate fresh installations. The integration suite also checks upgrades of existing installations and recovery of patches left by interrupted runs.

## Both platforms, all storefronts and runners

Run the matrix using the published dependency versions in `dependencies.yaml`:

```bash
MAGELENS_COMPOSER_AUTH_VOLUME=magelens_composerdata npm run test:e2e:matrix
```

The matrix creates **twelve independent installations**: Magento Open Source and Mage-OS, each with Luma, Hyvä CSP and legacy Hyvä, using Cypress and Playwright. Each uses `--project-name` and the published coverage packages from npm, then runs subsequent commands using the saved name. Checks verify the installed platform and pinned version, active theme, selected runner, absence of the other runner's packages and tooling, and coverage generation with `./bin/run-coverage`. Reports are saved at `.runtime/e2e/<project>/<runner>/coverage/index.html`; your existing application stays untouched. `coverage/installation.json` identifies each report's platform, version, theme and runner.

The matrix also runs `bash tests/project-isolation.sh`: two lightweight checkouts use distinct project names, domains and dynamically assigned ports. Stopping and removing one project's services and volumes must leave the other project's service and data available.

Every combination also checks the shared `./bin/runner` command, the read-only viewer over HTTPS, and browser/desktop recovery after graceful and forced container stops. Both runners execute headed in Docker; host browsers and a host graphical desktop are not required. To run just the restart checks against a built runner image, use `bash tests/runner-container.sh IMAGE`.

Both runners disable page-change animations during scenarios and fail on uncaught application errors.

Cypress installations also verify Node-side certificate and hostname validation, script injection into HTTPS `x-gzip` responses, and separate screenshot artifacts from two concurrent runs. Their logs and screenshots are retained in `coverage/cypress-runtime/`.

All twelve combinations check input updates, loops, navigation, and form submissions against the installed platform. Coverage checks require executed PHP, JavaScript, and template lines, along with uncovered branches and unvisited templates. Hyvä checks also cover Alpine model updates, PHP-generated event names, conditional listeners, modifier-only form prevention and unclicked event handlers. CSP runs include the original vendor theme templates and require the gallery, price and cancellation-modal directives to have no unsupported-directive warnings. Each combination runs the same seven acceptance scenarios: five Blog scenarios covering publishing, moderation, image handling, validation, permissions, and storefront interaction, plus two coverage probes. Inline PHTML scripts must execute normally and appear only in template coverage, with called functions, unused functions and both branch outcomes reported. PHP-rendered child scripts must link to their original template and keep unused child functions and branches uncovered. Original source files and PHP line numbers must remain unchanged. Patch cleanup is checked against the original framework files on both platforms.

Hyvä tests use the installer-selected default theme, with package versions pinned in [hyva-packages.json](../docker/php/hyva-packages.json). Playwright tests include the elgentos guest fixture. CSP runs require an enforcing script policy and verify that unauthorized inline scripts and dynamic code are blocked. Legacy Hyvä runs use `--hyva --nocsp`. Licensed Hyvä Checkout and the full upstream elgentos checkout suite are outside this installation matrix.

The matrix also compares covered and uncovered lines in the shared Blog PHP and Admin JavaScript across all twelve installations. Within each platform and theme, Cypress and Playwright must produce the same Blog PHP and JavaScript line coverage and template statement coverage. The comparison is saved to `.runtime/e2e/matrix-comparison.json`. Missing or duplicate combinations fail the comparison. Overall percentages can differ between Luma and Hyvä because their storefront implementations differ and inactive application files remain uncovered.

To test one combination, set `MAGELENS_E2E_PLATFORM=magento` or `mageos`, `MAGELENS_E2E_THEME=luma`, `hyva` or `hyva-legacy`, and `MAGELENS_E2E_RUNNER=cypress` or `playwright`. For example, Mage-OS with Hyvä CSP and Playwright:

```bash
MAGELENS_E2E_PLATFORM=mageos MAGELENS_E2E_THEME=hyva MAGELENS_E2E_RUNNER=playwright \
bash tests/e2e-isolated.sh
```

Omitting these settings selects Magento Open Source/Luma/Cypress. The full matrix always checks all twelve combinations, regardless of individual selection settings.

## Test a local template coverage package

To test unpublished library changes, pack a sibling `magento-template-coverage` checkout and supply the resulting tarball:

```bash
(cd ../magento-template-coverage && npm pack --ignore-scripts --pack-destination /tmp)
MAGELENS_TEMPLATE_COVERAGE_PACKAGE=/tmp/vitaliiboiko-magento-template-coverage-1.5.2.tgz \
MAGELENS_COMPOSER_AUTH_VOLUME=magelens_composerdata npm run test:e2e:matrix
```

Adjust the tarball filename in `MAGELENS_TEMPLATE_COVERAGE_PACKAGE` to match the file created in `/tmp` if its version differs from the example. This override applies to the temporary test installations; omit it to use the npm version in `dependencies.yaml`.

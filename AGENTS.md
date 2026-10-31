<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Use MageLens with a coding agent

MageLens provides a local Magento Open Source or Mage-OS environment with Cypress or Playwright and PHP, JavaScript and template coverage. Use [README.md](README.md) for installation and daily commands, [docs/coverage.md](docs/coverage.md) for scenarios and coverage configuration, and [tests/README.md](tests/README.md) for isolated validation.

Follow the [engineering-discipline skill](.agents/skills/engineering-discipline/SKILL.md) for implementation, documentation updates, testing and releases.

## Choose an installation

Run commands from the repository root. Docker with Compose 2.24.4+, Git, Bash, wget and tar are required. PHP, Composer, Node and browsers run in containers. Magento Open Source requires Marketplace credentials; Mage-OS uses its public Composer repository without them.

| Selection | Installer option |
| --- | --- |
| Magento Open Source | Default |
| Mage-OS | `--mageos` |
| Luma | Default |
| Hyvä CSP | `--hyva` |
| Cypress | Default |
| Playwright | `--playwright` |
| Automated setup without host DNS or certificate changes | `--container-only [domain]` |

Combine options as needed. For Mage-OS with Hyvä CSP and Playwright:

```bash
./install.sh --mageos --hyva --playwright
./bin/run-coverage
```

Before reinstalling an existing environment, read its saved selection in `.runtime/install-profile` and repeat the platform, theme and runner flags. Older profiles containing only a theme and runner use Magento Open Source. Omitting flags selects Magento Open Source/Luma/Cypress. Coverage and service commands automatically use the saved selection.

Legacy non-CSP Hyvä is unsupported. `--nocsp` and saved `hyva-legacy` profiles fail before changes. Back up the application and database, then migrate customizations to CSP in a separate checkout with the same platform and a different Docker project, domain and ports. Keep the old profile and data unchanged; manage that installation with the previous MageLens release.

`--mageos` creates a Mage-OS installation; it does not migrate an existing Magento project. Use a separate directory, Docker project, domain and ports for another platform. Keep an existing `COMPOSE_PROJECT_NAME` unchanged when reusing its database.

Installation updates application setup, dependencies, configuration and services. Normal installation also configures host DNS and local certificate trust. Use isolated E2E checks when validating the tooling without changing the user's environment.

## Work on an application

Application modules belong in `src/app/code/`; local themes belong in `src/app/design/frontend/` or `src/app/design/adminhtml/`. Read any scoped `AGENTS.md` before changing a module. The bundled example is documented in [the Blog README](src/app/code/Application/Blog/README.md).

To use a complete existing project, copy its `composer.json`, `composer.lock`, `bin/magento`, `app/bootstrap.php` and other application files into `src/` before installation. Use `--mageos` for a Mage-OS project. The copied project's Composer lock controls its dependencies. Supply credentials for its private packages separately, without printing or committing them.

For a new local database, omit copied `app/etc/env.php`. For an imported database, point `env.php` at this checkout's local `db` service before running setup. Do not connect setup or test fixtures to a remote shop.

Dependency versions are selected in [dependencies.yaml](dependencies.yaml). `MAGENTO_VERSION` controls Magento Open Source; `MAGEOS_VERSION` controls Mage-OS. Choose compatible PHP through `PHP_IMAGE` and service images through `MARKSHUST_DOCKER_MAGENTO_VERSION`. Back up application data before upgrades. Downgrades and platform changes require a separate checkout and database.

Edit original application files in `src/`, rather than generated files in `.runtime/`. Core and third-party dependencies under `src/vendor/` are installed locally and ignored by Git. Inspect Git status before changing generated or vendor content.

## Run scenarios and inspect coverage

Add Cypress scenarios in `cypress/e2e/` or module `Test/Cypress/` directories. Add Playwright scenarios in `playwright/e2e/` or module `Test/Playwright/` directories, importing `test` and `expect` from `playwright/support.cjs` to enable all three collectors.

| Command | Purpose |
| --- | --- |
| `./bin/run-coverage` | Run the installed browser suite and generate fresh reports |
| `./bin/run-coverage --start` | Start stopped services, then run coverage |
| `./bin/run-coverage --refresh-cache` | Clean caches before collection |
| `./bin/run-coverage --refresh-assets` | Refresh static assets and caches before collection |
| `./bin/run-coverage --restart-php` | Restart PHP before collection |
| `./bin/runner COMMAND` | Run Node, npm or a shell in the selected runner container |
| `bin/magento`, `bin/composer`, `bin/bash` | Work in the application container |
| `./bin/application-compose logs app phpfpm runner` | Inspect application and browser services |
| `./bin/application-compose stop` | Stop this project's services |
| `bin/start` | Start the installed environment |

Both browser runners and their warm-up browsers are visible through the same read-only viewer at `https://<domain>:6080/` by default. `RUNNER_VIEW_PORT` overrides the port; the older `CYPRESS_VIEW_PORT` remains a fallback. Host Node, browsers and a graphical desktop are not required.

Automated browser scenarios disable page-change animations. Uncaught application errors still fail the run.

Open `coverage/index.html` after a successful run. PHP executable lines appear in `coverage/php/`, whole JavaScript file statements in `coverage/js/`, and HTML/PHTML bindings and inline scripts in `coverage/templates/`. DOM presence is reported separately from execution. Read measurement warnings before interpreting template percentages.

Coverage includes application modules and active local themes. Third-party packages require an explicit `vendorRoots` entry in `coverage.config.json`. Inactive themes and directories named `Test`, `Setup`, `node_modules` or `tailwind` are excluded. Eligible unvisited files remain uncovered.

Run installation and coverage one at a time. Do not bypass `.runtime/workflow.lock` or remove it before checking for an active run. Default coverage does not restart services or refresh caches and assets; request those actions through the documented flags.

## Validate changes

For host-side integration checks, install the locked dependencies with `npm ci --ignore-scripts`, then run `npm run test:integration`. Target an existing relevant test first; use the full integration suite for shared orchestration changes. PHP checks live in `tests/*.test.php`; inspect their prerequisites before selecting host or container execution. Use `bash -n`, `node --check` and `php -l` for changed scripts.

For an isolated Mage-OS installation and real browser tests without Marketplace credentials:

```bash
MAGELENS_E2E_PLATFORM=mageos bash tests/e2e-isolated.sh
```

Select `MAGELENS_E2E_THEME=luma|hyva` and `MAGELENS_E2E_RUNNER=cypress|playwright` for a particular combination. The default platform is Magento Open Source. Supply its credentials using `MAGELENS_COMPOSER_AUTH_FILE` or `MAGELENS_COMPOSER_AUTH_VOLUME`, as described in [tests/README.md](tests/README.md).

`npm run test:e2e:matrix` checks all eight combinations: two platforms, two storefronts and two runners. It checks the installed platform/version, the same acceptance scenarios, coverage reports, source preservation, viewer access and browser recovery after graceful and forced stops. It also compares coverage outcomes for shared application code. Use the full matrix for changes affecting shared installation or coverage behavior. The GitHub workflow publishes releases; it does not automatically run this matrix for pull requests.

Isolated checks retain reports and logs under `.runtime/e2e/` and remove only their own temporary Compose projects and volumes. See [tests/README.md](tests/README.md) for port overrides, retained failure environments and testing an unpublished template-coverage package.

## Preserve application data and report integrity

- Keep original source bytes and PHP line numbers unchanged during coverage. Instrument disposable copies and retain source-hash and symlink checks.
- Keep warm-up separate from collection. Fresh run IDs and zero-hit baselines must exclude stale and warm-up execution.
- Preserve fixture, collection and compatibility-patch cleanup after failures or interruptions on both platforms.
- Retain checks for matching run IDs, unchanged source and all tests passing before reports and badges are published. Skipped or pending tests are not a successful run.
- Never print or commit Composer auth, `.env`, installed `env.php`, certificates or credential volumes. Do not prune unrelated Docker resources or remove an existing application's volumes.
- Preserve dependency pins and lockfiles together. Do not publish a release unless requested.
- Exclude generated runtime files, coverage reports and incidental badge changes from unrelated work. Report which validation actually passed and any checks blocked by unavailable services, images, repositories or credentials.

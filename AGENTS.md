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
| `./bin/run-coverage --branching ...` | Opt into the experimental checkpoint workflow; see [branching](docs/branching.md) |
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

Use the pinned Chrome for Testing build for every Cypress and Playwright journey, warm-up and browser recovery check. Do not substitute Electron or bundled Chromium. Record the actual browser name and version in reports; changing the browser requires fresh CI qualification.

Automated browser scenarios disable page-change animations. Uncaught application errors still fail the run.

Open `coverage/index.html` after a successful run. PHP executable lines appear in `coverage/php/`, whole JavaScript file statements in `coverage/js/`, and HTML/PHTML bindings and inline scripts in `coverage/templates/`. DOM presence is reported separately from execution. Read measurement warnings before interpreting template percentages.

Coverage includes application modules and active local themes. Third-party packages require an explicit `vendorRoots` entry in `coverage.config.json`. Inactive themes and directories named `Test`, `Setup`, `node_modules` or `tailwind` are excluded. Eligible unvisited files remain uncovered.

Run installation and coverage one at a time. Do not bypass `.runtime/workflow.lock` or remove it before checking for an active run. Default coverage does not restart services or refresh caches and assets; request those actions through the documented flags.

## Validate changes

For ongoing MageLens 2.0 branching work, create task branches from `branching`
and target pull requests at `branching`. It is the feature integration branch;
merging it into `main` or publishing a release requires a separate instruction.

CI exists to expose real gaps and problems in the user journey: installation, daily commands, storefront and Admin flows, coverage collection, and recovery. Investigate failures and fix their root causes in the product or test harness. Do not add CI-only workarounds that hide defects, bypass real user paths, weaken assertions or coverage, skip required cases, suppress application errors, or retry away functional failures. Runner setup and resource adaptations must preserve those journeys and acceptance checks. If a supported journey cannot run under the allowed infrastructure constraints, report incomplete coverage and the demonstrated blocker.

For host-side integration checks, install the locked dependencies with `npm ci --ignore-scripts`, then run `npm run test:integration`. Target an existing relevant test first; use the full integration suite for shared orchestration changes. PHP checks live in `tests/*.test.php`; inspect their prerequisites before selecting host or container execution. Use `bash -n`, `node --check` and `php -l` for changed scripts.

Run the full E2E matrix and release qualification in GitHub Actions. Focused local browser reproductions, development and debugging are allowed; use isolated resources, bound RAM/disk use and preserve existing applications. Do not run the full CI suite or E2E matrix locally unless explicitly requested. Static and unit/integration checks remain available locally; `npm run test:integration` limits concurrency to two workers to bound memory use.

The CI workflow checks all eight Linux combinations (two platforms, two storefronts and two runners), plus Mage-OS/Luma/Cypress on `windows-latest`. macOS CI is explicitly deferred because the hosted installation is too slow; Apple Silicon also awaits a self-hosted Mac. Do not claim macOS qualification. Actual host feasibility is required; a Linux job cannot stand in for Windows. The final `Required CI gate` requires all nine active cases, 63 acceptance scenarios, every report and the eight-way Linux coverage comparison. Missing, skipped, canceled and incomplete required checks block qualification.

Compare complete coverage outcomes within each theme across platforms, browser runners and operating systems: Luma with Luma and Hyvä CSP with Hyvä CSP. Include every measured application, theme and vendor file, PHP lines, JavaScript statements/functions/branches, template execution, DOM observations, source fingerprints and measurement warnings. Equal headline percentages are insufficient. Normalize only host paths, line endings, ordering, run metadata and repeated-hit frequencies; covered/uncovered outcomes, inventories and totals must match. Investigate discrepancies rather than excluding files or allowing a tolerance. Inspect `coverage/equivalence.json` and `theme-report-comparison.json` alongside the original eight-way comparison before declaring CI complete.

Local development and CI use the same runner Dockerfile and harness. Cypress 16.2.1 is rebuilt from its pinned upstream source with the cookie, document-initialization and response-timeout fixes in `docker/runner/cypress-source/`; do not duplicate it in CI scripts or application code. Each Cypress case must pass the eleven runner regressions (nine cookie/authorization journeys, document initialization and a delayed-response check) and record matching source/patch provenance. Review the patch when updating Cypress; remove the source build after an upstream release passes the retained regressions. Existing installations must rerun installation with their saved selections to rebuild the runner.

The full E2E CI matrix runs only on pull requests, including forks, against the exact merge candidate. The separate branching image builder publishes development images on pushes to `branching`; it does not qualify a release. Merges and release tags do not rerun the matrix. Retrieve the `case-*-attempt-N` and `qualification-N` artifacts; see [tests/README.md](tests/README.md) for setup and diagnostics.

Fix failures and push a new candidate to run CI again. Rerun all jobs on the final candidate: artifacts from different attempts cannot be combined. The manually dispatched release publisher consumes the successful PR qualification and requires the release commit to have the same Git tree as the tested candidate. Identical files after merging do not require another CI run; changed files require a new qualified PR. Do not merge or publish unless requested.

## Preserve application data and report integrity

- Keep original source bytes and PHP line numbers unchanged during coverage. Instrument disposable copies and retain source-hash and symlink checks.
- Keep warm-up separate from collection. Fresh run IDs and zero-hit baselines must exclude stale and warm-up execution.
- Preserve fixture, collection and compatibility-patch cleanup after failures or interruptions on both platforms.
- Retain checks for matching run IDs, unchanged source and all tests passing before reports and badges are published. Skipped or pending tests are not a successful run.
- Never print or commit Composer auth, `.env`, installed `env.php`, certificates or credential volumes. Do not prune unrelated Docker resources or remove an existing application's volumes.
- Preserve dependency pins and lockfiles together. Do not publish a release unless requested.
- Exclude generated runtime files, coverage reports and incidental badge changes from unrelated work. Report which validation actually passed and any checks blocked by unavailable services, images, repositories or credentials.

<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Use MageLens for test-driven development

MageLens provides a local Magento Open Source or Mage-OS environment with Cypress or Playwright and PHP, JavaScript, template and XML configuration coverage. Commands in this guide run from the installed project root, which is `compose/` in a MageLens contributor checkout. Use [README.md](README.md) for installation and daily commands and [docs/coverage.md](docs/coverage.md) for coverage configuration.

## LLM-to-TDD workflow

1. Read the application requirements and any scoped `AGENTS.md`. Add a focused Cypress or Playwright scenario for the intended behavior.
2. Run `./bin/run-coverage` and confirm the new scenario fails for the expected reason before changing application code.
3. Make the smallest application change that makes the test pass. Repeat the focused run, then run the relevant suite.
4. Inspect coverage and measurement warnings. Add assertions and scenarios for meaningful uncovered behavior; coverage percentages alone do not prove correctness.
5. Run the application suite in this project's own CI and retain the test results and reports, including diagnostics from failed runs.

Use Magento developer mode for LLM-to-TDD so code changes are visible during the red/green loop. Use the production deployment workflow for fast runs; follow the commands in [README.md](README.md).

## Choose an installation

Run commands from the installed project root. Docker with Compose 2.24.4+, Git, Bash, wget and tar are required. PHP, Composer, Node and browsers run in containers. Magento Open Source requires Marketplace credentials; Mage-OS uses its public Composer repository without them.

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

Add Cypress scenarios in `cypress/e2e/` or module `Test/Cypress/` directories. Add Playwright scenarios in `playwright/e2e/` or module `Test/Playwright/` directories, importing `test` and `expect` from `playwright/support.cjs` to enable coverage collection.

| Command | Purpose |
| --- | --- |
| `./bin/run-coverage` | Run the installed browser suite and generate fresh reports |
| `./bin/run-coverage --start` | Start stopped services, then run coverage |
| `./bin/run-coverage --refresh-cache` | Clean caches before collection |
| `./bin/run-coverage --refresh-assets` | Refresh static assets and caches before collection |
| `./bin/run-coverage --restart-php` | Restart PHP before collection |
| `./bin/run-coverage --include-machine-report` | Also write the SQLite coverage database |
| `./bin/runner COMMAND` | Run Node, npm or a shell in the selected runner container |
| `bin/magento`, `bin/composer`, `bin/bash` | Work in the application container |
| `./bin/application-compose logs app phpfpm runner` | Inspect application and browser services |
| `./bin/application-compose stop` | Stop this project's services |
| `bin/start` | Start the installed environment |

Both browser runners and their warm-up browsers are visible through the same read-only viewer at `https://<domain>:6080/` by default. `RUNNER_VIEW_PORT` overrides the port; the older `CYPRESS_VIEW_PORT` remains a fallback. Host Node, browsers and a graphical desktop are not required.

Use the pinned Chrome for Testing build for every Cypress and Playwright journey, warm-up and browser recovery check. Do not substitute Electron or bundled Chromium. Record the actual browser name and version in reports; changing the browser requires fresh CI qualification.

Automated browser scenarios disable page-change animations. Uncaught application errors still fail the run.

Open `coverage/index.html` after a successful run. To analyse results, run `./bin/run-coverage --include-machine-report` and query `coverage/report.sqlite` read-only as described in the [coverage-database skill](.agents/skills/coverage-database/SKILL.md) instead of parsing HTML or loading whole exports. PHP executable lines appear in `coverage/php/`, whole JavaScript file statements in `coverage/js/`, and HTML/PHTML bindings and inline scripts in `coverage/templates/`. DOM presence is reported separately from execution. The [XML configuration report](docs/coverage.md#xml-configuration-coverage) in `coverage/xml/` maps observed runtime effects to declarations in the original source tree. Read measurement warnings before interpreting template and XML percentages.

Tests audit the HTML source of selected pages by calling `cy.mageLensValidateHtml()` in Cypress or the `mageLensValidateHtml(page)` fixture in Playwright. Audits are opt-in and listed in the separate Reports section of `coverage/index.html`, with details in `coverage/html-validation/`; a run without calls is shown as not audited. Captures are validated after the tests finish; findings never fail a test or the run. See [HTML validation](docs/coverage.md#html-validation) for the validation target and its limitations.

Coverage includes application modules and active local themes. Third-party packages require an explicit `vendorRoots` entry in `coverage.config.json`. Inactive themes and directories named `Test`, `Setup`, `node_modules` or `tailwind` are excluded. Eligible unvisited files remain uncovered.

Run installation and coverage one at a time. Do not bypass `.runtime/workflow.lock` or remove it before checking for an active run. Default coverage does not restart services or refresh caches and assets; request those actions through the documented flags.

## Preserve application data and report integrity

- Keep original source bytes and PHP line numbers unchanged during coverage. Instrument disposable copies and retain source-hash and symlink checks.
- Keep warm-up separate from collection. Fresh run IDs and zero-hit baselines must exclude stale and warm-up execution.
- Preserve fixture, collection and compatibility-patch cleanup after failures or interruptions on both platforms.
- Retain checks for matching run IDs and unchanged source before reports and badges are generated, and for stopped collection and fixture cleanup before the report is published. Failed tests do not block publication: run the remaining suites, report test outcomes separately from coverage, then exit non-zero. Skipped and pending tests are not counted. An interrupted run publishes nothing.
- Keep every value in the opt-in coverage database equal to what the corresponding report shows: totals, percentages with the report's own rounding, module names as registered in `etc/module.xml`, and collector status. Mark data that was not observed, such as a template inventory without observation records, instead of reporting it as uncovered, and carry measurement warnings into the manifest. Retain the check that compares the database with the reports before publication.
- Never print or commit Composer auth, `.env`, installed `env.php`, certificates or credential volumes. Do not prune unrelated Docker resources or remove an existing application's volumes.
- Preserve dependency pins and lockfiles together.
- Exclude generated runtime files, coverage reports and incidental badge changes from unrelated work. Report which validation actually passed and any checks blocked by unavailable services, images, repositories or credentials.

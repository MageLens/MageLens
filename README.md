<p align="center">
  <img src="assets/magelens.svg" alt="MageLens logo" width="320">
</p>

# MageLens: Magento 2 and Mage-OS E2E code coverage with Docker

**See which PHP, JavaScript and templates your end-to-end tests execute.** MageLens sets up a local Magento Open Source or Mage-OS environment in Docker and collects PHP, JavaScript, and template coverage from a Cypress or Playwright run.

**[Website](https://magelens.dev/)** · [Real-world Magento E2E coverage guide](https://magelens.dev/guides/parallel-magento-e2e-coverage/)

> **[View the live Hyvä demo report →](https://magelens-coverage-demo.wintrywood128.chatgpt.site)** — PHP, JavaScript and template coverage from a Hyvä CSP storefront with 98 passing Playwright tests.

Run the installer, run the tests, and open one report to see which parts of your application executed. PHP, Composer, Node, the selected browser runner, and reporting tools run in containers.

The included [blog module](src/app/code/Application/Blog/README.md) provides an optional demonstration application with equivalent Cypress and Playwright suites for Luma and Hyvä. The badges are updated after each successful coverage run.

<!-- coverage-badges:start -->
Run `./bin/run-coverage` to generate coverage reports and badges for your project.
<!-- coverage-badges:end -->

## Why MageLens?

MageLens grew out of a real-world Magento project with **600+ E2E tests**, where coverage helped uncover forgotten features, broken functionality, and legacy template overrides the tests never exercised.

It makes those gaps visible across PHP, JavaScript and templates, with **low coverage overhead and near-native performance** observed in that project.

## Quick start

Run this inside the empty directory you want to use for MageLens:

```bash
wget -qO- https://github.com/MageLens/MageLens/archive/refs/tags/v1.6.0.tar.gz | tar -xz --strip-components=1 && ./install.sh
```

If you have already cloned or downloaded MageLens, run `./install.sh` from its project directory.

The command above installs Magento Open Source with Luma and Cypress. Add `--mageos` to install Mage-OS instead. Both platforms support every storefront and browser runner combination:

| Magento Open Source | Mage-OS | Storefront | Browser runner |
| --- | --- | --- | --- |
| `./install.sh` | `./install.sh --mageos` | Luma | Cypress |
| `./install.sh --hyva` | `./install.sh --mageos --hyva` | Hyvä CSP | Cypress |
| `./install.sh --playwright` | `./install.sh --mageos --playwright` | Luma | Playwright |
| `./install.sh --hyva --playwright` | `./install.sh --mageos --hyva --playwright` | Hyvä CSP | Playwright |

Each installation includes its selected runner and browser, with the same live viewer for Cypress and Playwright. Both run entirely in Docker. The installer saves the platform, theme and runner; `./bin/run-coverage` uses them automatically. Repeat the same flags when rerunning installation; omitted flags select Magento Open Source/Luma/Cypress.

Automated browser scenarios disable page-change animations for consistent navigation on both platforms.

Mage-OS is downloaded from its public Composer repository without Magento Marketplace keys. Use a separate directory and Docker project for each platform; `--mageos` does not convert an existing Magento installation.

Hyvä replaces the active storefront theme. Magento's bundled Luma/Blank packages remain part of Magento; the installer does not remove core files. Hyvä is downloaded only for `--hyva`.

All eight combinations install their coverage dependencies from npm.

`--hyva` installs `Hyva/default-csp` and enforces its storefront script policy.
The bundled Luma fallback checkout keeps its existing script policy; licensed Hyvä Checkout is a separate product. CSP-aware template coverage
keeps bindings and inline scripts in the template report and whole `.js` files in
the JavaScript report. Cypress preserves script CSP directives and adds its own
nonce; Playwright tests the original policy. See [Cypress CSP behavior](https://docs.cypress.io/app/references/content-security-policy).

Legacy non-CSP Hyvä is no longer supported. `--nocsp` and saved `hyva-legacy` profiles stop with migration guidance before changing the environment. Back up the existing application and database, then migrate customizations to Hyvä CSP in a separate checkout using `--hyva`, the same platform flag, and a different Docker project, domain and ports. Keep the old profile, project name and data unchanged; use the previous MageLens release to manage that installation.

See the [release notes](CHANGELOG.md) for changes in this version.

Then generate coverage reports:

```bash
./bin/run-coverage
```

Coverage runs reuse the running environment and automatically warm the storefront homepage before starting tests in a fresh browser. Cache cleaning, asset refreshes and restarts are [optional arguments](docs/coverage.md#run-lifecycle); use `--start` if services are stopped.

The installer asks for a test domain, defaulting to `magelens.test`, and saves it as `APPLICATION_DOMAIN` in `.env`. It downloads your selected platform, dependencies, and the runner’s browser; allow several minutes. To use an existing project, [copy its source before installing](#copy-a-complete-magento-project).

With the default domain and ports:

| Open | Location |
| --- | --- |
| Magento storefront | https://magelens.test/ |
| Magento Admin | https://magelens.test/admin/ |
| Demonstration blog | https://magelens.test/blog/ |
| Live test runner (Cypress or Playwright) | https://magelens.test:6080/ |
| Combined coverage report, after a successful test run | `coverage/index.html` on your machine |

Fresh installations create the Admin account `application` / `ApplicationOnly123456!`. Demo features and usage are documented in the [blog README](src/app/code/Application/Blog/README.md).

Open the live runner before starting `./bin/run-coverage` to watch either runner's browser through noVNC. The viewer is read-only. Use your selected domain in these URLs if you changed it during setup.

## Requirements

- Docker Engine/Desktop with Compose **2.24.4+**, running Linux containers; Git, Bash, wget, and tar.
- Linux or macOS. Allocate at least **6 GB RAM** to Docker (8 GB recommended) and roughly **15 GB free disk** for the first build.
- Internet access for container images, Composer/npm dependencies, and the selected browser download.
- Magento Marketplace public/private keys for `repo.magento.com` when installing Magento Open Source. Mage-OS does not require them. Copied projects may require credentials for their own private packages.
- Free local ports **80** and **443**, plus **6080** for the live test viewer. Configure `APPLICATION_PORT`, `APPLICATION_HTTPS_PORT`, and `RUNNER_VIEW_PORT` in `.env` to use different ports. Existing `CYPRESS_VIEW_PORT` settings still work for both runners; `RUNNER_VIEW_PORT` takes precedence when set.

Magento Open Source installation uses Mark Shust's `bin/setup-composer-auth`. It reuses Composer credentials from the container or host, or asks for **Username** (public key) and **Password** (private key). Credentials are stored in the local `composerdata` Docker volume. Mage-OS skips this step. To configure Marketplace credentials separately after the PHP service starts, run `bin/setup-composer-auth`.

The installer adds the domain to your hosts file and uses Mark Shust's SSL tools to configure a trusted local HTTPS certificate. These steps request your system password when needed. The application and live viewer bind to `127.0.0.1`.

## Coverage reports

`./bin/run-coverage` runs the project’s selected browser suite and generates three reports:

| Coverage | What it measures | Local report |
| --- | --- | --- |
| PHP | Executable PHP lines in `.php` and `.phtml` files reached by Magento HTTP requests, shown against your original source | `coverage/php/index.html` |
| JavaScript | Statements in whole `.js` files, collected with Istanbul and the selected runner | `coverage/js/index.html` |
| Templates | HTML/PHTML bindings, template expressions and inline scripts, with script functions, branches and DOM presence reported separately | `coverage/templates/index.html` |

PHP coverage excludes emitted HTML and inline JavaScript. Template warnings identify unsupported directives, scripts or PHP-generated output. When a warning is present, the template percentage covers only the parts MageLens can measure.

Open `coverage/index.html` directly in your browser for the combined view. Each successful full run also refreshes the four SVG badges in `coverage/badges/` and the managed badge section in this README. Reports are generated locally and are ignored by Git; the badges can be committed. Archive `coverage/` to share the browsable reports.

Coverage includes PHP executable lines, whole JavaScript files, and HTML/PHTML templates with their bindings and inline scripts under `src/app/code/`, plus selected storefront and Admin themes and their local parents under `src/app/design/`. Composer packages can be included explicitly using `vendorRoots` in [coverage.config.json](coverage.config.json). Directories named `Test`, `Setup`, `node_modules` or `tailwind`, browser specs and support directories are excluded. The theme scope is resolved from Magento on each run; unrelated inactive themes and vendor packages remain excluded. Unexecuted eligible files remain uncovered. JavaScript badges measure statements in whole `.js` files, with separate application/library reports. Inline scripts belong to template coverage, which also lists unsupported and PHP-generated script fragments. See [JavaScript coverage configuration](docs/coverage.md#javascript-coverage).

Read the [coverage guide](docs/coverage.md) for report semantics, collection details, and adding tests and fixtures.

## Magento environment

MageLens extends the Compose services from the selected [Mark Shust Docker Magento](https://github.com/markshust/docker-magento) release with local mounts and coverage tooling. That release selects the PHP build recipe, nginx, MariaDB, OpenSearch, and the cache service. PHP is built on the official base selected by `PHP_IMAGE`. A separate image supplies the selected runner and its live desktop.

The selected platform is installed through Composer. Its modules, framework, and themes live in `src/vendor/magento/` for Magento Open Source or `src/vendor/mage-os/` for Mage-OS; client modules live in `src/app/code/`. Both run in developer mode, generating code and static assets on demand, with page and block caches disabled for coverage collection.

The coverage configuration is explicit in [docker/php/env.php.sample](docker/php/env.php.sample). Installation merges this fragment into `src/app/etc/env.php`, preserving credentials and unrelated settings. HTML/PHTML and browser assets run without minification.

Following Mark Shust's development setup, MageLens installs [DisableTwoFactorAuth](https://github.com/markshust/magento2-module-disabletwofactorauth) as a Composer development dependency and turns off Admin 2FA for this local environment. Your browser tests can sign in with the Admin username and password.

## Dependency versions

Edit **[dependencies.yaml](dependencies.yaml)**, then rerun the installer with your platform, theme and runner flags. For Magento Open Source with Luma/Cypress:

```bash
./install.sh
```

This is the single place to choose the main dependency versions:

| Component | YAML setting |
| --- | --- |
| Magento Open Source | `MAGENTO_VERSION` |
| Mage-OS | `MAGEOS_VERSION` |
| Mark Shust Docker Magento PHP recipe and service images | `MARKSHUST_DOCKER_MAGENTO_VERSION` |
| Official PHP base image | `PHP_IMAGE` |
| [PCOV fork](https://github.com/VitaliyBoyko/pcov) / PIE installer | `PCOV_VERSION` / `PIE_VERSION` |
| Cypress | `CYPRESS_VERSION` |
| Playwright | `PLAYWRIGHT_VERSION` |
| Hyvä CSP theme | `HYVA_VERSION` |
| Cypress JavaScript coverage adapter | `CYPRESS_CODE_COVERAGE_VERSION` |
| Istanbul coverage data / instrumentation | `ISTANBUL_LIB_COVERAGE_VERSION` / `ISTANBUL_LIB_INSTRUMENT_VERSION` |
| Istanbul report CLI (nyc) | `NYC_VERSION` |
| [Magento template coverage](https://github.com/VitaliyBoyko/magento-template-coverage) | `TEMPLATE_COVERAGE_VERSION` |
| Cypress runner's Node and browser system dependencies | `RUNNER_IMAGE` |
| Playwright runner’s Node base image | `PLAYWRIGHT_RUNNER_IMAGE` |

Use exact release versions and keep values quoted. `RUNNER_IMAGE` is an image with a version tag. `PHP_IMAGE` uses `php:X.Y.Z-fpm-bookworm`, optionally pinned with `@sha256:<digest>`. Choose a PHP version supported by both the selected Mark Shust release and your platform. The defaults pair Magento Open Source 2.4.8-p5 and Mage-OS 2.3.0, which share the same Magento foundation.

The PHP image uses PIE 1.5.5 to install PCOV 2.1.2, including the [PIE installer security fix](https://github.com/php/pie/security/advisories/GHSA-4538-pqqf-mv67). After updating MageLens, rerun the installer with your existing platform, theme and runner flags to rebuild the PHP image.

The installer updates `package.json` and `package-lock.json` for your selected runner and coverage tools. You do not need to install Cypress or Playwright separately. Hyvä upgrades also require a matching package list in `docker/php/hyva-packages.json` for the selected `HYVA_VERSION`.

After changing versions, run `./bin/run-coverage` to check your tests and regenerate reports. For automated environments, `./install.sh --container-only [domain]` uses self-signed HTTPS without changing host DNS or certificate trust.

Select Playwright during installation with `./install.sh --playwright`, then use `./bin/run-coverage`. Import `test` and `expect` from `playwright/support.cjs` in project specs under `playwright/e2e/` or module `Test/Playwright/` directories. Cypress remains the default. Both runners produce PHP, JavaScript and template reports with the same source-integrity checks.

For installations created by MageLens, changing `MAGENTO_VERSION` updates Magento Open Source; changing `MAGEOS_VERSION` updates Mage-OS when installed with `--mageos`. Updates preserve client modules, configuration, media, and the database. Installation stops if an update conflicts with local edits. Back up the database before upgrading; application setup can change its schema. Downgrades and switching platforms require a separate checkout and database.

For a copied project, manage Magento dependencies through its own `composer.json` and `composer.lock`. Review the demo's [Cypress patches](patches/cypress/README.md) when changing Magento versions.

## Work with the source

After installation, Magento's full source is available in **`src/`** and bind-mounted into Docker, so your IDE can browse client modules in `app/code/` and core packages in `vendor/`. Custom module and theme namespaces are tracked; Composer dependencies remain ignored.

### Copy custom modules or themes

Copy them into their normal Magento locations, for example `src/app/code/YourVendor/YourModule` or `src/app/design/frontend/YourVendor/your-theme`, then run:

```bash
./install.sh # repeat your --mageos, --hyva and --playwright selections
./bin/run-coverage
```

The installer enables newly discovered modules and preserves explicitly disabled modules. Add Cypress tests under `cypress/e2e/` or a module's `Test/Cypress/` directory; add Playwright tests under `playwright/e2e/` or a module's `Test/Playwright/` directory. See [adding scenarios](docs/coverage.md#use-your-project) for the required Playwright coverage fixture.

Fresh installations select Luma by default and Hyvä CSP with `--hyva`. Installation applies the selected base theme. To select a custom child theme afterward, use **Content → Design → Configuration**; the next coverage run follows your selection.

### Copy a complete Magento project

Before the first installation, place your complete Magento or Mage-OS project in `src/`, including `composer.json`, `composer.lock`, `bin/magento`, and `app/bootstrap.php`. Add `--mageos` when installing a copied Mage-OS project. Remove the bundled example module and theme if you do not want them in your project. MageLens installs dependencies from your `composer.lock` and adds the development 2FA module if it is missing. Provide credentials for any private Composer repositories your project uses.

For a fresh local database, omit the copied `app/etc/env.php`. To use existing data, import your database into the local `db` service and configure `env.php` for the local services before running `./install.sh`. The database host must be `db`.

Rerun `./install.sh` with the same platform, theme and runner flags after module or theme changes to refresh setup and static assets. See the [coverage guide](docs/coverage.md#use-your-project) for adding scenarios and optional test fixtures.

## Everyday commands

Run these from the repository root. The test, viewer, and service commands work the same way with Cypress and Playwright:

```bash
./install.sh                              # install Luma/Cypress; repeat your flags to refresh another mode
./install.sh shop.test                    # configure a different local domain; include your platform/theme/runner flags
./bin/run-coverage                        # full suite, fresh reports, and badges
./bin/run-coverage --start                # start stopped services, then run the full suite
./bin/runner node --version               # use the selected runner's container tools
./bin/runner npm --version
./bin/runner bash                         # shell in the selected runner container
./bin/application-compose logs app phpfpm # inspect nginx and PHP logs
./bin/application-compose logs runner     # inspect browser runner startup
./bin/application-compose stop            # stop this project's services
bin/start                                 # start the installed environment
bin/magento cache:clean
bin/composer --version
bin/bash
bin/status
```

Use `./bin/run-coverage` for tests and reports, and `./bin/runner COMMAND` for commands in the selected runner container. Neither requires host Node, npm, browsers, or a graphical desktop. The live viewer is available at `https://magelens.test:6080/` with either runner.

Installation also makes Mark Shust's Magento tools available in `bin/`. Commands such as `bin/magento`, `bin/composer`, `bin/node`, and `bin/npm` operate on the Magento application in `src/`; use `./bin/runner node` or `./bin/runner npm` for the test workspace. If you already have npm on the host, `npm run coverage` is an optional alias for `./bin/run-coverage`; the older `npm run cy:coverage` alias remains supported with either runner.

The default Docker project name is `magelens`. To name a new installation, run `./install.sh --project-name client-shop client-shop.test`, adding your platform, theme and runner flags as needed. Names must start with a lowercase letter or digit and contain only lowercase letters, digits, hyphens or underscores.

The installer selects the name from `--project-name`, then a nonempty `COMPOSE_PROJECT_NAME` environment variable, then the saved `.env` value, then `magelens`. It saves the selection in `.env` for installation reruns, coverage, runner and service commands. Existing installations reject a conflicting name; unset conflicting environment overrides and keep the saved name to reuse the same database volumes. Use a separate directory for another project.

For multiple copies, choose a different project name and domain for each and set non-conflicting `APPLICATION_PORT`, `APPLICATION_HTTPS_PORT` and `RUNNER_VIEW_PORT` values in each `.env` before installing. Project naming does not change the domain or ports. Stopping or removing one project's services and volumes leaves the other projects running.

Rerun `./install.sh` with your platform, theme and runner flags to resume interrupted setup or rebuild after Dockerfile changes. Existing database contents, configuration, and media are preserved.

Avoid changing application data while the tests run. See the [coverage guide](docs/coverage.md#run-lifecycle) for optional refreshes and recovery.

`./bin/application-compose down -v` deletes this project's Docker volumes, including its database and stored Composer credentials. Source files remain in `src/`. For a fresh database, back up wanted data, run that command, remove `src/app/etc/env.php`, and rerun `./install.sh`.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/code/` | Client modules |
| `src/app/design/frontend/`, `src/app/design/adminhtml/` | Local themes |
| `src/vendor/` | Composer dependencies, including Magento core |
| `install.sh`, `compose.yaml`, `docker/` | Installation and Docker services |
| [dependencies.yaml](dependencies.yaml) | Dependency version settings |
| `bin/run-coverage` | Run the selected browser suite and generate coverage |
| `cypress/`, module `Test/Cypress/` directories | Project scenarios and browser coverage collectors |
| `playwright/`, module `Test/Playwright/` directories | Playwright scenarios and coverage fixtures |
| `coverage/` | Generated reports and badges |
| [Blog demo](src/app/code/Application/Blog/README.md) | Example application exercising all three collectors |
| [Coverage guide](docs/coverage.md) | Collector details and customization |

## FAQ

### Do I need PHP, Composer or Node installed on my host?

The application, dependencies, selected test runner and report tools run in Docker. Install the host tools listed in [requirements](#requirements). Magento Open Source also needs Magento Marketplace credentials; Mage-OS does not.

### Does Hyvä work with Mage-OS?

Yes. Use `./install.sh --mageos --hyva` for Hyvä CSP. Add `--playwright` to use Playwright instead of Cypress. Hyvä Checkout remains a separate product.

### Can I use my own Magento modules and themes?

Yes. [Copy modules or themes](#copy-custom-modules-or-themes), or [copy a complete project before installation](#copy-a-complete-magento-project), then add scenarios for the selected runner. Coverage follows the configured theme scope; vendor packages require an explicit `vendorRoots` entry.

### Why are PHP, JavaScript and template percentages different?

They measure different source operations. PHP uses executable lines, whole-file JavaScript uses Istanbul statements, and template coverage measures bindings and inline scripts with DOM presence reported separately. See the [coverage guide](docs/coverage.md); the percentages are not interchangeable.

### Is this a production deployment setup?

No. MageLens installs a local developer environment with coverage instrumentation, disabled caches and development authentication settings. Use it for testing and inspecting coverage.

## Related tools and support

Thank you to [Mark Shust](https://github.com/markshust) for creating and maintaining [Docker Magento](https://github.com/markshust/docker-magento), the Docker foundation that MageLens builds on.

- [Magento template coverage](https://github.com/VitaliyBoyko/magento-template-coverage): the standalone Cypress/Playwright template collector used here.
- [PCOV fork](https://github.com/VitaliyBoyko/pcov): PHP line coverage with native export and manifest reuse, selected in `dependencies.yaml`.
- [Magento 2 and Adobe Commerce PhpStorm plugin](https://github.com/VitaliyBoyko/magento2-phpstorm-plugin): code navigation, inspections, generators and Magento MCP tools for working with the source.

For reproducible setup or reporting problems, [open an issue](https://github.com/MageLens/MageLens/issues) with the MageLens version, platform, theme, runner and relevant diagnostics. See [releases](https://github.com/MageLens/MageLens/releases) and the [changelog](CHANGELOG.md) for version changes.

## License

MageLens is source-available under the [Elastic License 2.0](LICENSE). Commercial use, modification and redistribution are allowed under its terms, including agencies using MageLens to check clients' projects and deliver reports.

You may not offer MageLens to third parties as a hosted or managed service that gives users access to a substantial set of its features or functionality, including a SaaS offering of MageLens. Using MageLens internally to test your own SaaS application is allowed. Preserve licensing and copyright notices and do not bypass any license-key protections. See [LICENSE](LICENSE) for the complete terms.

Third-party dependencies and assets retain their own licenses, including the [badge icons](assets/badge-icons/LICENSE.md).

## Repository navigation for AI agents

See [AGENTS.md](AGENTS.md) for installation, coverage and testing instructions for coding agents using MageLens.

# MageLens coverage

Run `./bin/run-coverage` from the repository root, then open `coverage/index.html`. The command runs the full suite for the runner selected during installation and generates PHP, JavaScript, and HTML template reports. Cypress and Playwright both run in Docker, with a browser visible through the live viewer. See the [quick start](../README.md#quick-start) for installation.

## Coverage scope

Coverage includes supported files in:

- `src/app/code/`
- The selected frontend and Admin themes under `src/app/design/`, including their local parent themes.

PHP executable lines, including PHP in `.phtml`, appear in the PHP report. Whole `.js` files appear in the JavaScript report. HTML/PHTML bindings, Knockout and jQuery templates, Hyvä/Alpine expressions and inline scripts appear in the template report. `Test`, `Setup`, `node_modules`, `tailwind`, browser specs and browser support directories are excluded. Unexecuted eligible files remain uncovered. Vendor packages are excluded unless opted in with `coverage.config.json`; inactive themes remain excluded. Each run resolves configured themes for active stores and Admin before instrumenting sources, so changing the selected theme updates all three reports.

Coverage runs use disposable source copies and verify that your originals remain unchanged. Symlinked source files and directories are unsupported.

## Run lifecycle

Each run replaces previous reports and starts fresh execution counters. Unchanged browser instrumentation is reused; source edits update the disposable runtime copies. Run installation and coverage commands one at a time.

After instrumentation, compatibility patches and fixture preparation, the command warms the storefront homepage and fixture pages using the installed runner in a separate browser. The Blog fixture includes the Admin login page. This prepares shared [static assets generated on demand in developer mode](https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/cli/static-view/static-view-file-deployment).

Warm-up allows up to three minutes per navigation/readiness check and ten minutes overall, with up to ten seconds to terminate the browser. It waits for the document load, enabled RequireJS modules (including `text!` templates), browser requests and a one-second quiet interval. Remaining `data-mage-init` and `text/x-magento-init` declaration markers are recorded for diagnostics; their presence does not block readiness. Coverage collection begins after warm-up succeeds, in a fresh browser session with the existing test timeouts. Warm-up execution contributes no PHP, JavaScript or template hits to the reports.

If preparation fails, the run stops and cleans its fixtures and patches before starting collection or tests. Inspect `coverage/warmup-results.json`, `coverage/warmup-diagnostics.json` and `coverage/warmup-screenshots/`. Normal Cypress failures include unfinished request URLs, their elapsed time, unresolved RequireJS modules and HTTP errors. An overall timeout may terminate Cypress before it writes final diagnostics; the terminal retains the last Cypress error/output.

The default command uses the running services and the configured HTTPS domain. It does not restart services, change Magento configuration, or clear caches and static assets. Avoid changing application data while the tests run.

Optional refreshes can be combined:

| Option | Use when |
| --- | --- |
| `--start` | Application services are stopped |
| `--refresh-cache` | Layout or configuration changes need a cache clean |
| `--refresh-assets` | Static assets need rebuilding, for example after adding a theme override or moving a file; also cleans caches |
| `--restart-php` | PHP-FPM needs restarting |

For example: `./bin/run-coverage --start --refresh-assets`.

Installation merges [docker/php/env.php.sample](../docker/php/env.php.sample) into `src/app/etc/env.php`, preserving credentials, theme selections and unrelated settings. The fragment enables developer mode, disables full-page/block output caching and HTML/PHTML, JavaScript and CSS minification, and sets local URLs and Admin defaults. These settings also apply at website and store scope. HTML assets pass through unchanged; PHTML executes directly. CSS/LESS compilation remains available for themes. Edit the fragment and rerun installation to change these defaults.

The combined report and badges are published after all tests pass and the coverage records and source checks succeed. Skipped or pending tests prevent publication. The README badge section is marked pending when collection starts.

If a process is forcibly terminated, check for active installation or coverage processes before removing `.runtime/workflow.lock` and rerunning the command. For the demo's patch recovery command, see [Cypress patch notes](../patches/cypress/README.md).

## Watch a test run

Open `https://magelens.test:6080/`, then start `./bin/run-coverage` in your terminal. For both Cypress and Playwright, the noVNC viewer shows the browser running inside Docker during warm-up and tests. Between runs, it displays a waiting screen. Viewing is read-only, so watching a run does not send mouse or keyboard input to the tests. You do not need a browser installation or graphical desktop on the host to execute tests.

Use your configured `APPLICATION_DOMAIN` and `RUNNER_VIEW_PORT` if they differ from the defaults. The legacy `CYPRESS_VIEW_PORT` setting remains supported when `RUNNER_VIEW_PORT` is unset. The viewer starts with the environment; use `./bin/run-coverage --start` if it is stopped.

Failure screenshots are saved under `cypress/screenshots/` for Cypress. Playwright saves failure screenshots and traces under `coverage/playwright-artifacts/`. Use `./bin/runner COMMAND` to run tools in either selected runner's container; see [everyday commands](../README.md#everyday-commands).

Both runners fail tests on uncaught application errors. Cypress disables cross-document view-transition animations inside its test frame so navigation between Hyvä and Admin remains reliable. This does not change normal storefront browsing; animation behavior is outside the bundled acceptance checks.

## PHP coverage

[PCOV](https://github.com/VitaliyBoyko/pcov) collects PHP execution from Magento HTTP requests made during the current browser run. CLI execution is outside the collection scope.

The PHP report measures executable lines. Unvisited files are included through static analysis with zero hits. `phpunit/php-code-coverage` generates HTML and Clover reports.

Every run records fresh execution. Cached collection metadata is refreshed automatically when source, configuration, or dependencies change.

## JavaScript coverage

`istanbul-lib-instrument` adds execution counters to whole application `.js` files, excluding browser specs and support directories. Cypress collects counters through `@cypress/code-coverage`; Playwright collects snapshots from each browser context. Both use the same Istanbul reporting pipeline. Stale counter maps and unexpected source paths fail reporting.

The JavaScript headline and badge measure **statements**, avoiding the misleading line totals of minified libraries. The main report includes every eligible file, including scripts that never load. Separate application and bundled-library reports share the same counters. HTML/PHTML files and their inline scripts belong exclusively to the template report.

Configure `coverage.config.json` independently from the package versions in `dependencies.yaml`:

```json
{
  "vendorRoots": ["vendor/acme/theme", "vendor/acme/module/src"],
  "javascript": {
    "metric": "statements",
    "libraries": ["vendor/acme/theme/web/js/library.min.js"],
    "exclude": [{
      "path": "vendor/acme/theme/web/js/library.js",
      "replacement": "vendor/acme/theme/web/js/library.min.js",
      "reason": "Theme templates load the minified distribution."
    }],
    "requiredExecuted": ["vendor/acme/theme/web/js/library.min.js"]
  }
}
```

Paths are relative to `src/`. Vendor packages are opt-in; configured Composer themes participate only when selected as an active theme or ancestor. Exclusions require reasons and replacements must remain included. Missing configured JavaScript assets fail preparation, and required runtime assets must actually execute. Do not exclude unused application features simply to raise the percentage. `Test`, `Setup`, `node_modules`, and `tailwind` directories contain no eligible runtime coverage. The complete inventory and exclusion reasons are saved in `coverage/javascript-scope.json`. Remove `javascript.inline` from older configurations; template script coverage is provided by the template package.

[examples/hyva.coverage.json](../examples/hyva.coverage.json) provides a configuration for Hyvä CSP 1.5.3, including Alpine CSP and its minified runtime build. Copy it to `coverage.config.json` before installation to opt into those vendor roots. Review the asset paths when changing Hyvä versions; exclusions are configuration choices, not automatic detection. Legacy non-CSP Hyvä is unsupported; see the [installation and migration guidance](../README.md#quick-start).

Files that are never loaded retain zero-hit counters from instrumentation. The report combines these with execution observed during the current suite.

## HTML template coverage

[@vitaliiboiko/magento-template-coverage](https://github.com/VitaliyBoyko/magento-template-coverage) measures HTML/PHTML template bindings, engine expressions and inline scripts. This includes Knockout, jQuery templates, Magento literals and regular Hyvä/Alpine directives. The report contains directory totals and per-file source views.

Hyvä template coverage supports both CSP and regular Alpine 3 evaluators, including listeners with PHP-generated event names. Modifier-only listeners such as `@submit.prevent` preserve their behavior without adding an expression to the coverage total. Directives generated entirely by PHP remain outside template execution coverage. Keep the theme’s nonce or hash registration enabled for inline scripts. Inline JavaScript bodies are measured in the same template source report, including scripts executed after a template fragment is inserted. Cached and unused templates retain zero execution hits.

The template badge measures **executable template lines**: starting lines of bindings, template expressions and inline script statements that execute. Static markup has no execution denominator. Inline script functions and branches have separate counters. The template report lists unsupported scripts and PHP-generated JavaScript without static source mappings; these gaps are never treated as covered. A Knockout event binding hit records binding evaluation; it does not prove that its handler ran.

**DOM presence** is reported separately. Hidden elements count as present, while fetching HTML alone does not. Templates with unsupported execution syntax remain visible with an explanation of the available DOM coverage.

## Use your project

For a Cypress installation, follow the [source setup instructions](../README.md#work-with-the-source), then add scenarios in `cypress/e2e/**/*.cy.js` or a module's `Test/Cypress/**/*.cy.js`. All matching scenarios run with `./bin/run-coverage`.

For Playwright, install with `./install.sh --playwright` (add `--hyva` for Hyvä and `--mageos` for Mage-OS), then add specs in `playwright/e2e/**/*.spec.{js,ts}` or a module’s `Test/Playwright/` directory. Import `test` and `expect` from the project’s `playwright/support.cjs` so all three collectors run. `./bin/run-coverage` reads the saved platform and runner selection.

Rerun `./install.sh` with the same platform, theme and runner flags after adding modules or themes, changing setup code, or updating dependencies. Selecting another installed theme updates the next run's scope automatically. Coverage commands and report locations are the same on Magento Open Source and Mage-OS.

Modules can provide optional fixture hooks in `Test/MageLens/hooks.php`:

| Action | When it runs | Expected output |
| --- | --- | --- |
| `before` | Before fixture preparation, with services running | Optional diagnostic output |
| `prepare` | Before browser warm-up and coverage collection | One JSON value on stdout; diagnostics on stderr |
| `cleanup` | When the run exits; also before preparation if a previous run was interrupted | Optional diagnostic output; safe to repeat |

Cypress receives each module's `prepare` result through `Cypress.expose('projectFixtures')[moduleName]`. Playwright tests can read the same data from `coverage/project-fixtures.json`. The [blog hooks](../src/app/code/Application/Blog/Test/MageLens/hooks.php) provide an example of fixture creation and cleanup.

The result may include `warmupPaths`, an array of application paths such as `["/admin/"]`. Both runners visit these pages after the homepage, before coverage collection. Paths must start with a single `/`; external URLs are not accepted.

## Reports and artifacts

Detailed HTML reports live in `coverage/php/`, `coverage/js/`, and `coverage/templates/`. `coverage/summary.json` records the run ID, generation time, and displayed metrics.

For collection details, inspect PHP records under `coverage/raw/php/<run-id>/`, template observations under `coverage/raw/templates/`, and JavaScript counters in `.nyc_output/out.json`. Each run creates fresh execution records.

Reports and raw artifacts are ignored by Git. The SVGs in `coverage/badges/` can be committed with the README. To share browsable reports, copy the entire `coverage/` directory so relative links continue to work.

## Use an existing Playwright fixture

MageLens supplies Playwright and the coverage collectors. To preserve a suite's
login, consent or other custom fixtures, wrap each test object explicitly:

```js
const {withCoverage, expect} = require('./playwright/support.cjs');
const {test: authenticated, guestTest} = require('./your-tests/fixtures');
module.exports = {
    test: withCoverage(authenticated),
    guestTest: withCoverage(guestTest),
    expect
};
```

Adjust the import paths for your adapter. Have the specs import this adapter,
and select their files and path aliases in `playwright.config.cjs`. MageLens does
not discover external fixture directories or replace its default fixture.
Keep external test sources in their own checkout; their package manifest and
installation scripts are not required to run them with MageLens. Any helper
libraries imported by those tests must also be available to the runner.

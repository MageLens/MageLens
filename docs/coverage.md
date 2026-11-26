<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# MageLens coverage

Run `./bin/run-coverage` from the repository root, then open the report URL printed on success, or `coverage/index.html` locally. The command runs the full suite for the runner selected during installation and generates PHP, JavaScript, HTML/PHTML template and [XML configuration](#xml-configuration-coverage) reports. Cypress and Playwright both run in Docker, with a browser visible through the live viewer. See the [quick start](../README.md#quick-start) for installation.

The local report uses the configured default storefront URL, including its protocol, port and base path where routing supports it. Each new run removes the previous report link until collection, report validation and cleanup succeed. Existing installations must rerun installation with their saved platform, theme and runner flags to enable the report mount and web-server configuration.

## Coverage scope

Coverage includes supported files in:

- `src/app/code/`
- The selected frontend and Admin themes under `src/app/design/`, including their local parent themes.

PHP executable lines, including PHP in `.phtml`, appear in the PHP report. Whole `.js` files appear in the JavaScript report. HTML/PHTML bindings, Knockout and jQuery templates, Hyvä/Alpine expressions and inline scripts appear in the template report. Supported XML declarations appear in their own source tree with the runtime effects observed during the tests. `Test`, `Setup`, `node_modules`, `tailwind`, browser specs and browser support directories are excluded. Unexecuted eligible files remain uncovered. Vendor packages are excluded unless opted in with `coverage.config.json`; inactive themes remain excluded. Each run resolves configured themes for active stores and Admin before instrumenting sources, so changing the selected theme updates all reports.

Coverage runs use disposable source copies and verify that your originals remain unchanged. Symlinked source files and directories are unsupported.

## Run lifecycle

Each run replaces previous reports and starts fresh execution counters. Unchanged browser instrumentation is reused; source edits update the disposable runtime copies. Run installation and coverage commands one at a time.

After instrumentation, compatibility patches and fixture preparation, the command warms the storefront homepage and fixture pages using the installed runner in a separate browser. The Blog fixture includes the Admin login page. This prepares shared [static assets generated on demand in developer mode](https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/cli/static-view/static-view-file-deployment).

Warm-up allows up to three minutes per navigation/readiness check and ten minutes overall, with up to ten seconds to terminate the browser. It waits for the document load, enabled RequireJS modules (including `text!` templates), browser requests and a one-second quiet interval. Remaining `data-mage-init` and `text/x-magento-init` declaration markers are recorded for diagnostics; their presence does not block readiness. Coverage collection begins after warm-up succeeds, in a fresh browser session with the existing test timeouts. Warm-up execution contributes no PHP, JavaScript, template or XML hits to the reports.

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

Optional flags can be combined:

| Option | Use when |
| --- | --- |
| `--update-readme` | Update the README badge section for this run |

Installation merges [docker/php/env.php.sample](../docker/php/env.php.sample) into `src/app/etc/env.php`, preserving credentials, theme selections and unrelated settings. The fragment enables developer mode, disables full-page/block output caching and HTML/PHTML, JavaScript and CSS minification, and sets local URLs and Admin defaults. These settings also apply at website and store scope. HTML assets pass through unchanged; PHTML executes directly. CSS/LESS compilation remains available for themes. Edit the fragment and rerun installation to change these defaults.

The combined report and badges are published after all tests pass and the coverage records and source checks succeed. Skipped or pending tests prevent publication. The README is unchanged unless you pass `--update-readme`. With that flag, its badge section is marked pending during preparation and updated after successful validation. A failed run leaves the pending message.

If a process is forcibly terminated, check for active installation or coverage processes before removing `.runtime/workflow.lock` and rerunning the command. For the demo's patch recovery command, see [Cypress patch notes](../patches/cypress/README.md).

## CLI tests

Add standalone CLI specs named `*.test.cjs` under `cli/e2e/` or a module's `Test/Cli/` directory, including Composer modules listed in `vendorRoots`. These specs run after the Cypress or Playwright browser suite when you use `./bin/run-coverage`.

Standalone CLI specs can import `test`, `magento` and `magerun` from `cli/support.cjs`. Both command helpers take an array of arguments and return `{code, stdout, stderr}`. Commands run in the Magento PHP container using the installed application's configuration. `magerun()` and `./bin/n98-magerun2` share a pinned, checksum-verified PHAR that downloads on first use. For a run without outbound access, prepare the PHAR with `./bin/n98-magerun2 --skip-core-commands --version` while online, then run `MAGELENS_MAGERUN_OFFLINE=1 ./bin/run-coverage` to require the verified cache. For an existing installation with an older wrapper, rerun `./install.sh` with your saved platform, theme and runner flags.

Use `sys:cron:run <job_code>` to execute one configured handler immediately. Use Magento's native `cron:run --group=<group>` to test scheduler behavior, such as processing a pending schedule when it becomes due. This example uses the compatibility module from the isolated acceptance suite.

```js
const assert = require('node:assert/strict');
const {test, magento, magerun} = require('../support.cjs');

test('runs one cron handler and checks its recorded message', async () => {
    const job = 'magelens_magerun_probe';
    const messages = async () => JSON.parse((await magento(['magelens:probe', 'magerun-messages', job])).stdout);
    try {
        assert.deepEqual(await messages(), []);
        await magerun(['sys:cron:run', job]);
        assert.deepEqual(await messages(), ['magerun-handler-ran']);
    } finally {
        await magento(['magelens:probe', 'clean-magerun', job]);
    }
});
```

Use `{timeout: 30000}` to change the default 60-second timeout for each command, or `{expectedExitCode: 2}` to assert a specific error exit. Keep fixture writes scoped to an isolated installation and remove them during cleanup. Set `use_separate_process` to `0` for a cron test group to collect the job’s PHP execution in the same command. CLI test results are written to `coverage/cli-results.json`.

## Watch a test run

Open `https://magelens.test:6080/`, then start `./bin/run-coverage` in your terminal. For both Cypress and Playwright, the noVNC viewer shows the browser running inside Docker during warm-up and tests. Between runs, it displays a waiting screen. Viewing is read-only, so watching a run does not send mouse or keyboard input to the tests. You do not need a browser installation or graphical desktop on the host to execute tests.

Use your configured `APPLICATION_DOMAIN` and `RUNNER_VIEW_PORT` if they differ from the defaults. The legacy `CYPRESS_VIEW_PORT` setting remains supported when `RUNNER_VIEW_PORT` is unset. The viewer starts with the environment; use `./bin/run-coverage --start` if it is stopped.

Failure screenshots are unchanged. Cypress writes a sibling HTML file under `cypress/screenshots/<spec-relative-path>/`, named `<test> -- attempt-N -- <run> -- <worker> (failed).html`. It serializes the current application DOM in the Cypress failure event; an `afterEach` fallback handles failures without that event, before Cypress takes its automatic screenshot. Playwright writes `failure-page-N -- attempt-N -- <run> -- <worker> (failed).html` in the same per-test attempt folder as its screenshot and trace under `coverage/playwright-artifacts/`. It captures immediately when a test body or `beforeEach`/`afterEach` hook throws, before later cleanup hooks run. A per-test fixture fallback handles failures that do not pass through those callbacks, and application-error or fixture-teardown failures are captured before browser context teardown.

Each file's `<meta name="magelens-failure-snapshot">` records the run, spec, full test title, attempt, worker, capture phase and timestamp; it also contains Playwright's test ID or Cypress's per-execution ID. Cypress adds a numeric suffix if concurrent writes collide.

Snapshots contain only HTML structure, text and attributes from the live DOM. The serializer reflects current form values and selected/checked state, redacts password and hidden-input values, and omits script/style contents, inline CSS and event-handler attributes. Asset references are retained as `data-snapshot-*` attributes so opening the file does not load images, stylesheets, scripts, frames or other resources. Canvas pixels, iframe documents, shadow roots, computed styles and JavaScript event listeners are not represented. Capture does not wait for assets or network activity. It is bounded to 6,000 DOM nodes, 100,000 source characters and 1 MiB per file; Playwright allows up to 1.2 seconds total to read up to four open pages. If capture is unavailable, an HTML diagnostic records the reason; snapshot errors do not replace the test failure. These local files may contain page data and are excluded by the CI upload allowlist. Use `./bin/runner COMMAND` to run tools in either selected runner's container; see [everyday commands](../README.md#everyday-commands).

Both runners fail tests on uncaught application errors. Cypress disables cross-document view-transition animations inside its test frame so navigation between Hyvä and Admin remains reliable. This does not change normal storefront browsing; animation behavior is outside the bundled acceptance checks.

Both runners supply the missing Prototype dependency in Braintree 4.8's Admin settings script during warm-up and scenarios. This adjusts only the browser response, preserving original files and normal browser caching.

## PHP coverage

[PCOV](https://github.com/MageLens/PCOV) collects PHP execution from Magento HTTP requests and CLI test commands in the current run.

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

[@magelens/magento-template-coverage](https://github.com/MageLens/MagentoTemplateCoverage) measures HTML/PHTML template bindings, engine expressions and inline scripts. This includes Knockout, jQuery templates, Magento literals and regular Hyvä/Alpine directives. The report contains directory totals and per-file source views.

Hyvä template coverage supports both CSP and regular Alpine 3 evaluators, including listeners with PHP-generated event names. Modifier-only listeners such as `@submit.prevent` preserve their behavior without adding an expression to the coverage total. Directives generated entirely by PHP remain outside template execution coverage. Keep the theme’s nonce or hash registration enabled for inline scripts. Inline JavaScript bodies are measured in the same template source report, including scripts executed after a template fragment is inserted. Cached and unused templates retain zero execution hits.

The template badge measures **executable template lines**: starting lines of bindings, template expressions and inline script statements that execute. Static markup has no execution denominator. Inline script functions and branches have separate counters. The template report lists unsupported scripts and PHP-generated JavaScript without static source mappings; these gaps are never treated as covered. A Knockout event binding hit records binding evaluation; it does not prove that its handler ran.

**DOM presence** is reported separately. Hidden elements count as present, while fetching HTML alone does not. Templates with unsupported execution syntax remain visible with an explanation of the available DOM coverage.

## HTML validation

Tests can audit the HTML of selected pages. Validation is opt-in: only pages for which a test calls `mageLensValidateHtml` are audited, and a run without calls is shown as not audited.

In Cypress, call the command after the page you want to audit has loaded:

```js
cy.visit('/customer/account/');
cy.mageLensValidateHtml();
```

In Playwright, request the `mageLensValidateHtml` fixture and pass it the page. With [your own fixtures](#use-an-existing-playwright-fixture), `withCoverage` adds it to each wrapped test object:

```js
test('audits the account page', async ({page, mageLensValidateHtml}) => {
    await page.goto('/customer/account/');
    await mageLensValidateHtml(page);
});
```

The call captures the page's HTML and returns no result. Captures are validated after the tests finish, while the reports are generated, so findings never fail a test or the run. A response that cannot be validated is listed as not validated with the reason: a redirect, a response that is not an HTML document, an empty response, or a request that failed or took longer than 60 seconds.

**Validation target.** The helper requests the current URL again with the cookies of the test session, so signed-in storefront and Admin pages are audited as that user sees them. It captures the HTML source of that response, before the browser parses it. A browser repairs invalid markup while parsing, so the rendered DOM is never used in place of the source. As a result:

- Markup created or changed by JavaScript, such as Knockout or Alpine output and opened dialogs, is not validated.
- The response to a form submission is not validated; the audit covers a new `GET` of the URL shown after it.
- Redirects are not followed. A page that redirects when requested again, such as an order confirmation, is listed as not validated.
- The extra request runs application code like any other request of the test and is included in PHP and XML coverage.
- Coverage runs serve instrumented templates. They add marker comments and coverage counters in attribute values and inline scripts; elements and line numbers are unchanged.
- Lines and columns refer to the captured response, not to a template file. The report names the capture in `coverage/raw/html-validation/` for each audit; its `html` field holds the audited source.

[html-validate](https://html-validate.org/) checks the source with its `html-validate:standard` rules, which cover markup validity without style or accessibility conventions. The version is set by `HTML_VALIDATE_VERSION` in `dependencies.yaml`. The report contains no page source: findings show the rule, message, selector and position only, and Admin secret keys, form keys and session tokens are removed from recorded URLs.

After a successful run, the combined report lists HTML validation in a separate **Reports** section and links to `coverage/html-validation/index.html`. That report shows every audit with its page, test and spec, and each finding's severity, rule, message, response line and column, or states that no issues were found. `coverage/html-validation/results.json` contains the same data. The captured responses stay in the private `coverage/raw/html-validation/` directory and are not published with the report. Existing installations must rerun installation with their saved platform, theme and runner flags to install the validator.

## Test attempts

Each attempt of a test, including every retry, gets a random 32-character attempt ID when it starts: in the Cypress support file, the Playwright `context` fixture and the CLI suite. The runner writes the attempt's test identity once to `coverage/raw/attempts/<attempt ID>.json`: runner, spec, title path below the spec, retry number, Playwright project and worker, start and finish time, and the runner's outcome. A failed attempt keeps its record when a retry follows.

Browser tests send the ID in the `application_coverage_attempt` cookie next to `application_coverage`; custom HTTP clients can send the `X-Application-Coverage-Attempt` header instead. CLI tests pass it to their commands. Each PHP request or command record stores the ID as `attempt`, with its start time as `startedAt`. Requests without an ID, such as shared setup in another browser context or a Cypress `after()` hook (the attempt cookie is cleared when each test finishes), are stored with `attempt: null` and stay unattributed. CLI commands keep the attempt of the test whose code requested them, also from `.then()` continuations that run after the test returned. Test files are named relative to the project root in every runner, whatever the Playwright `testDir` is. The JavaScript counters of each attempt's pages are also written, with only the statements, functions and branches that ran, to `coverage/raw/javascript-attempts/<attempt ID>.json`, keyed by Istanbul file path and not filtered by the report exclusions. Aggregate coverage is unchanged: it does not read attempt IDs or these counters. The two fields also appear in the request and command lists of the private `coverage/php/coverage-summary.json`.

The PHP collector is part of the PHP image: an existing installation writes these two fields only after rerunning installation with its saved platform, theme and runner flags. These records are private run data under `coverage/raw/` and are not published with the reports.

## Per-test attribution

After the reports, `bin/report-attribution.cjs` combines the attempt records into `coverage/attribution/`. It is private run data like `coverage/raw/` and is not published.

| File | Contents |
| --- | --- |
| `index.json` | The run's attempts in start order, and per collector: status, unit, record counts, attributed and unattributed units |
| `php.json` | Covered PHP lines from `coverage/php/line-coverage.json` |
| `javascript.json` | Statement (`s:<id>`), function (`f:<id>`) and branch path (`b:<id>:<path>`) counters of the JavaScript report, by file below `src/` |
| `templates.json` | Template statement, function and branch counters of the template report |
| `xml.json` | Covered XML declarations by runtime observation, per configuration area when the observation includes one (`<declaration>@<area>`), from the requests and commands of the XML report |

The collector files map each file and unit to its owners: the position of an attempt in `index.json`, or `unattributed`, with hit counts. PHP lines count 1 per owner, because PCOV records whether a line ran, not how often. A unit can belong to several attempts and to unattributed work at the same time. Uncovered units are not listed.

- Every attributed unit is checked against the aggregate report of its collector, and every covered unit has an owner. A difference stops the run before reports are published.
- PHP lines are expanded per attempt exactly as in the PHP report. A request that starts after its attempt finished keeps the attempt and is counted as `lateRecords`.
- Template records that carry their attempt ID are attributed to it; Cypress and Playwright pass the ID as the template package's record `metadata` where the installed package keeps it. The ID must belong to an attempt of the same spec, title path, retry and project. Other records are matched by spec, title path, retry and project. Two attempts with the same identity, such as Cypress tests with duplicate titles, cannot be told apart that way: their records are counted as `ambiguousRecords` and stay unattributed.
- XML hits belong to the attempt of the PHP request or command associated with the evidence.
- Attribution shows which code ran during a test attempt. It does not show that the test checked the result of that code.


## Use your project

For a Cypress installation, follow the [source setup instructions](../README.md#work-with-the-source), then add scenarios in `cypress/e2e/**/*.cy.js` or a module's `Test/Cypress/**/*.cy.js`. All matching scenarios run with `./bin/run-coverage`.

For Playwright, install with `./install.sh --playwright` (add `--hyva` for Hyvä and `--mageos` for Mage-OS), then add specs in `playwright/e2e/**/*.spec.{js,ts}` or a module’s `Test/Playwright/` directory. Import `test` and `expect` from the project’s `playwright/support.cjs` so all collectors run. `./bin/run-coverage` reads the saved platform and runner selection.

Rerun `./install.sh` with the same platform, theme and runner flags after adding modules or themes, changing setup code, or updating dependencies. Selecting another installed theme updates the next run's scope automatically. Coverage commands and report locations are the same on Magento Open Source and Mage-OS.

Modules can provide optional fixture hooks in `Test/MageLens/hooks.php`:

| Action | When it runs | Expected output |
| --- | --- | --- |
| `before` | Before fixture preparation, with services running | Optional diagnostic output |
| `prepare` | Before browser warm-up and coverage collection | One JSON value on stdout; diagnostics on stderr |
| `cleanup` | When the run exits; also before preparation if a previous run was interrupted | Optional diagnostic output; safe to repeat |

Cypress receives each module's `prepare` result through `Cypress.expose('projectFixtures')[moduleName]`. Playwright tests can read the same data from `coverage/project-fixtures.json`. The [blog hooks](../src/app/code/Application/Blog/Test/MageLens/hooks.php) provide an example of fixture creation and cleanup.

The result may include `warmupPaths`, an array of HTML page paths such as `["/admin/"]`. Both runners visit these pages after the homepage, before coverage collection. Paths must start with a single `/`; external URLs are not accepted.

## Reports and artifacts

Detailed HTML reports live in `coverage/php/`, `coverage/js/`, `coverage/templates/`, and `coverage/xml/`. `coverage/summary.json` records the run ID, generation time, and displayed metrics.

For collection details, inspect PHP records and their XML observations under `coverage/raw/php/<run-id>/`, browser XML evidence under `coverage/raw/xml-browser/<run-id>/`, template observations under `coverage/raw/templates/`, and JavaScript counters in `.nyc_output/out.json`. Each run creates fresh execution records.

After a successful run, use `./bin/export-coverage` and share only **`coverage/share.html`**. The standalone HTML file opens offline and includes coverage metrics, layout declaration totals, and project-relative file paths. If the recipient also needs the measured source code, run `./bin/export-coverage --include-source` and share **`coverage/share-with-source.html`** with them.

Keep the full `coverage/` directory private. It contains local debugging artifacts, including raw request URLs and custom fixture data that can contain credentials. After upgrading, run `./bin/run-coverage` once to replace the old local web link with one that serves only report files. Git ignores the reports, raw artifacts and SVGs in `coverage/badges/`.

## XML configuration coverage

Open `coverage/xml/index.html` and follow the original source directories down to a file. For an example, [browse XML in the live demo](https://magelens-coverage-demo.vitaliyboykostarkon.chatgpt.site/xml/index.html). Existing installations must rerun `./install.sh` with their saved platform, theme and runner flags to install the OpenTelemetry PHP extension used for runtime observations.

Line totals include every measured XML file, including layouts and DI. A line counts as covered when at least one declaration on it was observed. Amber highlights lines with both covered and missed declarations. Unmeasured lines are outside the percentage, and N/A means there are no measured lines. Open **Declaration details** below a file's source to inspect its outcomes. The XML index links to detailed coverage data and counts by declaration type where available.

### Configuration reads, Admin fields and observers

A supported `config.xml` leaf earns coverage when a runtime read consumes its effective value at default, website or store scope. A supported `system.xml` field earns coverage when Admin renders it. Unopened fields and unread values remain uncovered. Unsupported XML and ambiguous field origins appear as unmeasured.

Configuration coverage includes Backend value and flag reads and Magento's lowercase aliases for store codes. Explicit paths and subtrees requested through these accessors earn credit for their native values before plugins decorate the result. Internal storage reads and whole-configuration snapshots, including accessor calls without a path, grant no execution credit. Replacements that bypass the native getter provide no XML evidence. Empty-node conflicts and empty CDATA whose exact ownership cannot be preserved are shown as unmeasured.

The XML report also shows synchronous `events.xml` observer execution for global, frontend, adminhtml, REST (`webapi_rest`), GraphQL (`graphql`), and the CLI cron area (`crontab`). An observer earns credit when Magento reaches its underlying `execute()` method. The report links each registration to its original lines and shows covered and uncovered outcomes by area, even for observers that share a PHP class. Disabled, overridden, ambiguous and unsupported registrations are outside the observer totals for the affected area. Browser warm-up contributes no observer hits. If the collector reports stale event configuration, rerun `./bin/run-coverage --refresh-cache`.

### Layout and page configuration

During a collected HTTP request, MageLens bypasses Magento's native layout cache so the layout readers can trace instructions to their XML files. The installed cache settings and layout cache entries stay intact. Cached full-page responses and cached block HTML can still limit coverage.

Layout XML reports list original declarations and attributes, with a separate layout total. Block creation and template selection remain visible facts. Block declarations require the native block HTML boundary for rendering coverage; template declarations require successful template engine execution. A constructed block or selected template that is never rendered remains uncovered. A native template file validation rejection is shown separately from execution failures and unconfirmed execution origins. The report also shows traversed include edges, duplicate inclusions, cycles, selected wireframes and moves. It records missing move targets, moves into removed subtrees, applied removals and surviving restorations. Container construction, emitted wrappers, display decisions, configuration flags and Admin ACL decisions have independent evidence. Ignored empty or zero operands retain explicit outcomes; native zero-class wrapper interpolation is shown separately. Class, group and TTL evidence identifies native application. A fresh cacheability check can identify a surviving block whose cacheable attribute is the literal false. An intercepted wireframe getter can prevent attribution of the original page attribute. An XML template assignment, a superseding XML declaration, a later PHP replacement and actual PHP template engine execution have separate evidence. The report identifies the originating handle and the area and theme observed during the request.

Reference declarations and their name attributes earn coverage from attributable native effects on the named target, including child attachment, template execution, value application, action calls, wrappers and visibility or removal decisions. Matching a target is a zero-hit observation. Empty references, missing or removed targets and replaced child assignments retain distinct outcomes. A selected template on an unrendered reference remains uncovered. Nested child declarations keep their own effect origins.

The layout generator can credit a successful action call when a single original action supplied the native call. Native magic calls with empty or zero method strings retain their original action and method operands. Multiple matching action declarations have an ambiguity warning and zero hits. Action `ifconfig` attributes show allowed and denied configuration decisions separately from calls. Guards sharing a path and scope are ambiguous; empty or zero guards, failed decisions and unobserved guards retain distinct zero-hit outcomes. Block argument evidence separates native value generation, block-data assignment and explicit reads. Argument groups distinguish the selected first group from ignored later groups. Canonical type attributes have separate evaluation and deferred-selection evidence, including nested array items. Action type operands retain separate interpretation evidence; matching operands from multiple possible actions remain ambiguous. Typed layout values require the literal `xsi` prefix on the reviewed native path; its serializer discards equivalent type attributes using another prefix. Single-source objects, options, helpers, URLs, constants and updated values can earn application evidence. Native updater calls have independent execution evidence, with parser-ignored and failed updater declarations shown separately. Scalar array leaves keep their own origins through nested overlays. Mixed or unconfirmed parent origins remain unmeasured, with surviving leaves credited independently. A block can receive a value without reading it, and PHP can replace that value later. Argument and item names have independent key-assignment evidence. Mixed parent keys and ambiguous action keys remain unmeasured; a key assignment grants no fresh name-evaluation or value-read evidence. Explicit native getters, nested path lookups, indexed array and string lookups, and array-access reads have separate evidence. Native data setters, unsets and array-access writes revoke read provenance, including equal-valued replacements. Hooked or magic template/data properties retain an ownership limitation even when they return equal values. Custom template implementations that can access the template field outside observed accessors retain a separate execution-ownership limitation; an equal filename cannot prove that XML still owns the selection. Template resolver, context and engine-pool storage have separate warnings when property hooks, magic access or pending lazy initialization prevent verification without executing application code. A value applied before a storage replacement keeps its application evidence, with later reads measured separately. Custom block implementations that can access data storage outside observed accessors retain a separate read-ownership limitation, including equal-valued direct writes. Whole-object snapshots and PHP array offsets inside returned arrays lack individual value-read attribution. Null or absent indexed members and projections into object internals retain their limitations.

Page configuration coverage credits the original title when it reaches Magento's title renderer. It also shows earlier title declarations that Magento superseded. A head removal earns credit when Magento removes an existing resource from the scheduled collection. A removal whose target was already absent receives zero hits. Effective HTML, head and body attributes and attributable metadata earn output evidence. Body classes distinguish output, duplicate additions and cancellation by an empty class declaration. Asset references earn evidence when Magento emits their native resource tag. Serialized XML attributes, conditional output and native order grouping have separate evidence. Font preload defaults can discard XML attributes. Resource output provides no browser download or execution evidence.

Native file selection is a zero-hit observation of merged input. Handle inclusion and descendant instructions retain their own native effect evidence. The current layout adapter requires a trace through the native file loader, update merge and block reader. Layout caches can supply merged XML or scheduled structure without that trace. The report marks these requests as limited. Exposing mutable layout XML to external PHP or reassigning it revokes source ownership before interpretation, including equal-valued edits and node replacements. Cached block HTML can reach the block HTML path without running its template. Generic HTTP fragments use their native layout reader, including actions, values, moves, removals, and anonymous blocks and containers whose names Magento generates. Wireframe coverage retains containers, nested blocks, moves and removals across the native page-layout read. Root wireframe head/body branches are reported as ignored by their installed reader pool. Container labels have separate structure assignment and explicit native read evidence. Name, alias and sibling-order attributes have independent structural application evidence, with ignored, replaced and unchanged operations reported separately. Layout UI component placement can earn construction and wrapper-rendering evidence, while ignored layout-owned values retain their limitations. Requests served before layout construction and unsupported layout effects have explicit limitations.

Layout registry coverage distinguishes native membership checks, option-label consumption and whole-map snapshots. Equal-valued overlays retain their own origins. Empty labels, empty CDATA and mixed-source label fragments follow the native merge outcomes. Page-type coverage separates initialization and translated-label application from explicit field reads. Cached registry inputs and page-type data require verified source lineage for fresh hits. Observed native and reflection assignments revoke later field-read ownership. Request evidence is bounded, and exceeding the event limit prevents report publication. A failed layout observer also blocks publication; diagnostics identify collector code without exposing application exception messages.

The schema inventory links each declaration and runtime boundary to the native consumer, fixture, required evidence and platform verification. [Layout XML measurement inventory](../tests/layout-xml-inventory.md)

### Dependency injection

The XML report measures `di.xml` usage during developer and production HTTP requests and CLI tests in supported Magento areas. Run `./bin/deploy-production` to switch the local application to production, run Magento’s compiler and static deployment, and record the DI source and generated metadata fingerprints. Then run `./bin/run-coverage`. Redeploy when the DI sources or compiled metadata change. Use `--refresh-assets` to rebuild production static files from current instrumented sources without recompiling DI.

**Plugin execution** counts registered before, around or after callbacks that Magento reaches. Around callbacks earn credit when they short-circuit, as do enclosing after callbacks that run. The source view links inherited registrations to their unique sources and shows the effective subject, intercepted method, phase, and registration outcomes by area.

**Preference usage** shows which `di.xml` bindings Magento selected in a successful Object Manager resolution. It also includes attributable pre-resolved constructor dependencies in production. Shared returns count, and a chain can credit each binding with a unique original source. The report shows the requested and replacement types, the effective type, and the original lines. Unvisited bindings are uncovered, and overridden, inactive, ambiguous or unsupported bindings are unmeasured. Direct construction, isolated lookups, failed resolutions, untracked background work, and warm-up grant no hits.

**Virtual type usage** records virtual aliases selected when Magento’s factory successfully returns an object. Each uniquely sourced alias in a chain counts. Retrieving an already shared instance adds no factory evidence. An area declaration that only supplies arguments can contribute to argument usage while inheriting its virtual target.

**Constructor argument usage** records configured parameters that Magento applies during successful construction. It follows class and virtual-type inheritance and shows the source of each attributable array item, including items retained from multiple files. An array with several contributors may have an unmeasured parent row and covered item rows. An initialization parameter earns a hit when Magento uses a supplied value. Explicit call-time overrides, PHP defaults, and absent initialization values grant no credit. Evidence contains parameter and item names and requested types.

**Object lifetime usage** records when Magento applies an explicit `shared` setting while resolving a dependency for a successful construction. A setting on an object argument or array item takes precedence over the corresponding type setting. A direct Object Manager call selects its own operation and does not exercise the configured lifetime.

The declaration breakdown counts each DI declaration once per eligible area. The source report counts each measured line once across all areas. Custom plugin lists and descendants outside the inventoried subjects are unmeasured. A TypeError at a plugin declaration can leave callback entry unconfirmed. In developer mode, use `./bin/run-coverage --refresh-cache` for stale DI configuration. In production, use `./bin/deploy-production` for stale compiled provenance.

### Admin UI components, routing, ACL, menus and cron

**Standalone Admin UI component XML** tracks native creation, preparation, data-provider execution and configuration delivery for supported fields, columns and data sources. The browser report separates constructing a component, rendering its bound markup, invoking a button action and reloading a grid through AJAX. Browser effects require a matching response from the active run. Shared JavaScript execution has its own coverage report. Configuration served from cache without a source trace has a cache-only outcome.

**HTTP routing** records native storefront and Admin selections from area `routes.xml` files. The report separates the selected route and module from entry into the selected controller. It measures synchronous `/rest[/<store>]/V<n>/...` requests from `webapi.xml`, with distinct outcomes for route selection, the permission decision and PHP service entry. Handler credit requires entry into the selected method.

Custom routers, no-route fallbacks, SOAP, asynchronous and bulk REST, GraphQL and direct PHP calls are outside routing coverage. A native binding with competing declarations or disagreement between the observed and current configuration has an explicit limitation. Eligible declarations remain visible when no request selects them.

**Admin ACL and menus** report the decision on a native resource check and the individual menu entries rendered or followed. ACL declarations describe the resource hierarchy. Role assignments come from the database. Following an entry requires a browser navigation linked to that entry's emitted anchor and destination response.

**Cron** separates evaluation of a literal `crontab.xml` schedule, entry into the configured handler and successful or failed completion. A pre-seeded due row and a direct MageRun job can exercise the handler. They supply schedule evidence only when Magento also evaluates that XML expression.

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

<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# MageLens coverage

Run `./bin/run-coverage` from the repository root, then open the report URL printed on success, or `coverage/index.html` locally. The command runs the full suite for the runner selected during installation and generates PHP, JavaScript, and HTML template reports. Cypress and Playwright both run in Docker, with a browser visible through the live viewer. See the [quick start](../README.md#quick-start) for installation.

The public report uses the configured default storefront URL, including its protocol, port and base path where routing supports it. Each new run removes the previous public link until collection, report validation and cleanup succeed. Existing installations must rerun installation with their saved platform, theme and runner flags to enable the report mount and web-server configuration.

## Coverage scope

Coverage includes supported files in:

- `src/app/code/`
- The selected frontend and Admin themes under `src/app/design/`, including their local parent themes.

PHP executable lines, including PHP in `.phtml`, appear in the PHP report. Whole `.js` files appear in the JavaScript report. HTML/PHTML bindings, Knockout and jQuery templates, Hyvä/Alpine expressions and inline scripts appear in the template report. `Test`, `Setup`, `node_modules`, `tailwind`, browser specs and browser support directories are excluded. Unexecuted eligible files remain uncovered. Vendor packages are excluded unless opted in with `coverage.config.json`; inactive themes remain excluded. Each run resolves configured themes for active stores and Admin before instrumenting sources, so changing the selected theme updates all reports.

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

## Watch a test run

Open `https://magelens.test:6080/`, then start `./bin/run-coverage` in your terminal. For both Cypress and Playwright, the noVNC viewer shows the browser running inside Docker during warm-up and tests. Between runs, it displays a waiting screen. Viewing is read-only, so watching a run does not send mouse or keyboard input to the tests. You do not need a browser installation or graphical desktop on the host to execute tests.

Use your configured `APPLICATION_DOMAIN` and `RUNNER_VIEW_PORT` if they differ from the defaults. The legacy `CYPRESS_VIEW_PORT` setting remains supported when `RUNNER_VIEW_PORT` is unset. The viewer starts with the environment; use `./bin/run-coverage --start` if it is stopped.

Failure screenshots are saved under `cypress/screenshots/` for Cypress. Playwright saves failure screenshots and traces under `coverage/playwright-artifacts/`. Use `./bin/runner COMMAND` to run tools in either selected runner's container; see [everyday commands](../README.md#everyday-commands).

Both runners fail tests on uncaught application errors. Cypress disables cross-document view-transition animations inside its test frame so navigation between Hyvä and Admin remains reliable. This does not change normal storefront browsing; animation behavior is outside the bundled acceptance checks.

Both runners supply the missing Prototype dependency in Braintree 4.8's Admin settings script during warm-up and scenarios. This adjusts only the browser response, preserving original files and normal browser caching.

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

For collection details, inspect PHP records under `coverage/raw/php/<run-id>/`, template observations under `coverage/raw/templates/`, and JavaScript counters in `.nyc_output/out.json`. Each run creates fresh execution records.

Reports, raw artifacts and the SVGs in `coverage/badges/` are ignored by Git. To share browsable reports, copy the entire `coverage/` directory so relative links continue to work.

XML configuration coverage appears separately in `coverage/xml/index.html`, with source directories preserved. Supported `config.xml` leaves turn green when a runtime read consumes their effective value at default, website or store scope. Supported `system.xml` fields turn green when Admin renders them; unopened fields and unread values remain red. Loading XML grants no credit. Unsupported XML and ambiguous field origins are shown as unmeasured. The collector uses OpenTelemetry runtime hooks without adding Magento modules, changing DI or rewriting application sources. Existing installations must rerun installation with their saved platform, theme and runner selections to install the hook extension.

Configuration coverage includes Backend value and flag reads and Magento's lowercase aliases for store codes. Explicit paths and subtrees requested through these accessors earn credit for their native values before plugins decorate the result. Internal storage reads and whole-configuration snapshots, including accessor calls without a path, grant no execution credit. Replacements that bypass the native getter provide no XML evidence. Empty-node conflicts and empty CDATA whose exact ownership cannot be preserved are shown as unmeasured.

The XML report also shows synchronous HTTP `events.xml` observer execution for global, frontend, adminhtml, REST (`webapi_rest`), and GraphQL (`graphql`) configuration. An observer earns credit when Magento reaches its underlying `execute()` method. The report links each registration to its original lines and shows covered and uncovered outcomes by area, even for observers that share a PHP class. Disabled, overridden, ambiguous and unsupported registrations are outside the observer totals for the affected area. Browser warm-up contributes no observer hits. If the collector reports stale event configuration, rerun `./bin/run-coverage --refresh-cache`.

Layout XML reports list original declarations and attributes, with a separate layout total. Block creation and template selection remain visible facts. Block declarations require the native block HTML boundary for rendering coverage; template declarations require successful template engine execution. A constructed block or selected template that is never rendered remains uncovered. A native template file validation rejection is shown separately from execution failures and unconfirmed execution origins. The report also shows traversed include edges, duplicate inclusions, cycles, selected wireframes and moves. It records missing move targets, moves into removed subtrees, applied removals and surviving restorations. Container construction, emitted wrappers, display decisions, configuration flags and Admin ACL decisions have independent evidence. Ignored empty or zero operands retain explicit outcomes; native zero-class wrapper interpolation is shown separately. Class, group and TTL evidence identifies native application. A fresh cacheability check can identify a surviving block whose cacheable attribute is the literal false. An intercepted wireframe getter can prevent attribution of the original page attribute. An XML template assignment, a superseding XML declaration, a later PHP replacement and actual PHP template engine execution have separate evidence. The report identifies the originating handle and the area and theme observed during the request.

Reference declarations and their name attributes earn coverage from attributable native effects on the named target, including child attachment, template execution, value application, action calls, wrappers and visibility or removal decisions. Matching a target is a zero-hit observation. Empty references, missing or removed targets and replaced child assignments retain distinct outcomes. A selected template on an unrendered reference remains uncovered. Nested child declarations keep their own effect origins.

The layout generator can credit a successful action call when a single original action supplied the native call. Multiple matching action declarations have an ambiguity warning and zero hits. Action `ifconfig` attributes show allowed and denied configuration decisions separately from calls. Guards sharing a path and scope are ambiguous; empty or zero guards, failed decisions and unobserved guards retain distinct zero-hit outcomes. Block argument evidence separates native value generation, block-data assignment and explicit reads. Typed layout values require the literal `xsi` prefix on the reviewed native path; its serializer discards equivalent type attributes using another prefix. Single-source objects, options, helpers, URLs, constants and updated values can earn application evidence. Native updater calls have independent execution evidence, with parser-ignored and failed updater declarations shown separately. Scalar array leaves keep their own origins through nested overlays. Mixed or unconfirmed parent origins remain unmeasured, with surviving leaves credited independently. A block can receive a value without reading it, and PHP can replace that value later. Argument and item names have independent key-assignment evidence. Mixed parent keys and ambiguous action keys remain unmeasured; a key assignment grants no fresh name-evaluation or value-read evidence. Explicit native getters, nested path lookups, indexed array and string lookups, and array-access reads have separate evidence. Native data setters, unsets and array-access writes revoke read provenance, including equal-valued replacements. Hooked or magic template/data properties retain an ownership limitation even when they return equal values. Template resolver, context and engine-pool storage have separate warnings when property hooks, magic access or pending lazy initialization prevent verification without executing application code. A value applied before a storage replacement keeps its application evidence, with later reads measured separately. Whole-object snapshots and PHP array offsets inside returned arrays lack individual value-read attribution. Null or absent indexed members and projections into object internals retain their limitations.

Page configuration coverage credits the original title when it reaches Magento's title renderer. It also shows earlier title declarations that Magento superseded. A head removal earns credit when Magento removes an existing resource from the scheduled collection. A removal whose target was already absent receives zero hits. Effective HTML, head and body attributes and attributable metadata earn output evidence. Body classes distinguish output, duplicate additions and cancellation by an empty class declaration. Asset references earn evidence when Magento emits their native resource tag. Serialized XML attributes, conditional output and native order grouping have separate evidence. Font preload defaults can discard XML attributes. Resource output provides no browser download or execution evidence.

Native file selection is a zero-hit observation of merged input. Handle inclusion and descendant instructions retain their own native effect evidence. The current layout adapter requires a trace through the native file loader, update merge and block reader. Layout caches can supply merged XML or scheduled structure without that trace. The report marks these requests as limited. Exposing mutable layout XML to external PHP or reassigning it revokes source ownership before interpretation, including equal-valued edits and node replacements. Cached block HTML can reach the block HTML path without running its template. Generic HTTP fragments use their native layout reader, including actions, values, moves, removals, and anonymous blocks and containers whose names Magento generates. Wireframe coverage retains containers, nested blocks, moves and removals across the native page-layout read. Root wireframe head/body branches are reported as ignored by their installed reader pool. Container labels have separate structure assignment and explicit native read evidence. Name, alias and sibling-order attributes have independent structural application evidence, with ignored, replaced and unchanged operations reported separately. Layout UI component placement can earn construction and wrapper-rendering evidence, while ignored layout-owned values retain their limitations. Requests served before layout construction, standalone UI component XML and remaining unsupported effects lack runtime attribution.

Layout registry coverage distinguishes native membership checks, option-label consumption and whole-map snapshots. Equal-valued overlays retain their own origins. Empty labels, empty CDATA and mixed-source label fragments follow the native merge outcomes. Page-type coverage separates initialization and translated-label application from explicit field reads. Cached registry inputs and page-type data require verified source lineage for fresh hits. Observed native and reflection assignments revoke later field-read ownership. Request evidence is bounded, and exceeding the event limit prevents report publication.

The XML report measures `di.xml` usage during authorized developer and production HTTP requests in those same configuration areas. Run `./bin/deploy-production` to switch the local application to production, run Magento’s compiler and static deployment, and record the DI source and generated metadata fingerprints. Then run `./bin/run-coverage`. Redeploy when the DI sources or compiled metadata change. Use `--refresh-assets` to rebuild production static files from current instrumented sources without recompiling DI.

**Plugin execution** counts registered before, around or after callbacks that Magento reaches. Around callbacks earn credit when they short-circuit, as do enclosing after callbacks that run. The source view links inherited registrations to their unique sources and shows the effective subject, intercepted method, phase, and registration outcomes by area.

**Preference usage** shows which `di.xml` bindings Magento selected in a successful Object Manager resolution. It also includes attributable pre-resolved constructor dependencies in production. Shared returns count, and a chain can credit each binding with a unique original source. The report shows the requested and replacement types, the effective type, and the original lines. Unvisited bindings are uncovered, and overridden, inactive, ambiguous or unsupported bindings are unmeasured. Direct construction, isolated lookups, failed resolutions, CLI, background work, and warm-up grant no hits.

**Virtual type usage** records virtual aliases selected when Magento’s factory successfully returns an object. Each uniquely sourced alias in a chain counts. Retrieving an already shared instance adds no factory evidence. An area declaration that only supplies arguments can contribute to argument usage while inheriting its virtual target.

**Constructor argument usage** records configured parameters that Magento applies during successful construction. It follows class and virtual-type inheritance and shows the source of each attributable array item, including items retained from multiple files. An array with several contributors may have an unmeasured parent row and covered item rows. An initialization parameter earns a hit when Magento uses a supplied value. Explicit call-time overrides, PHP defaults, and absent initialization values grant no credit. Evidence contains parameter and item names and requested types.

**Object lifetime usage** records when Magento applies an explicit `shared` setting while resolving a dependency for a successful construction. A setting on an object argument or array item takes precedence over the corresponding type setting. A direct Object Manager call selects its own operation and does not exercise the configured lifetime. Each DI section counts declaration–area pairs separately from the XML line totals.

Each DI section counts a declaration once per eligible area. Source highlights summarize the areas without adding DI entries to the XML line totals. Custom plugin lists and descendants outside the inventoried subjects are unmeasured. A TypeError at a plugin declaration can leave callback entry unconfirmed. In developer mode, use `./bin/run-coverage --refresh-cache` for stale DI configuration. In production, use `./bin/deploy-production` for stale compiled provenance.

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

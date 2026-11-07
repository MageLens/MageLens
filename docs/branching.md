<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Playwright branching prototype (P0)

P0 runs shared setup once, checkpoints application state, and executes sibling
tests from that checkpoint. The first sibling continues in the original page;
later siblings restore the application and rebuild the page in the same browser
context. P0 combines filesystem CoW snapshots (B2), retained public static code
and PHP opcode file caches (3), and snapshot-and-continue (1).

This is development toward MageLens 2.0. Use an explicit workflow or the Rust
planner for existing Playwright source. Automatic execution currently supports
a conservative subset of tests and reviewed fixture adapters.

Branching is opt-in: `./bin/run-coverage` keeps the existing linear workflow.
Only `--branching` starts the orchestrator and checkpoint worker. Branching
currently produces execution reports, not application coverage reports. It
requires the explicit disposable-workflow arguments shown below; the flag alone
does not infer a safe checkpoint boundary.

The Rust planner runs in its own prebuilt `ghcr.io/magelens/orchestrator` image.
The optional Playwright adapter uses `ghcr.io/magelens/branching-playwright`,
which includes pinned Playwright, Chrome and Docker clients, with no Rust
compiler or planner. The Rust image includes no Node, Playwright or browser.
The selected runner loads through `branching/runners/`; a future Cypress adapter
can implement the same `open`, `run`, `close` contract. Cypress linear runs remain
available; Cypress branching reports that it is not implemented yet.

The image builder publishes source-fingerprinted Linux amd64 images from the
`branching` feature branch. Commands use cached matching images or pull them;
they do not build containers from source automatically. For explicit development
builds, set `MAGELENS_BRANCHING_BUILD_FROM_SOURCE=1`. Other architectures are
not yet qualified. The dedicated branching E2E CI runner is a follow-up task.

## Run a workflow

Use a dedicated **disposable test installation** already installed with
`--playwright`, with all services running. The initial adapter supports native
Linux Docker, the local `db` service, file sessions, and a single application
network. Choose an existing writable directory on XFS with reflinks or Btrfs.
The command tests real clone isolation; ext4 and full-copy checkpoint fallbacks
are rejected. It never formats disks or provisions a filesystem.

```bash
./bin/run-coverage --branching --disposable playwright/branches/storefront.cjs /path/on/cow/storage
# Replay the same workflow without stage checkpoints for comparison:
./bin/run-coverage --branching --disposable playwright/branches/storefront.cjs /path/on/cow/storage L0
# Select a single branch:
./bin/run-coverage --branching --disposable playwright/branches/storefront.cjs /path/on/cow/storage P0 view-cart
```

The driver uses the installed runner's locked Playwright and pinned Chrome for
Testing in a bounded Docker container, with Docker access to fence services.
This prototype runs Chrome headlessly. Node and browsers are not required on
the host. The adapter image extends the qualified browser image with pinned
Docker CLI/Compose clients and reuses the installed dependency volume.

Preparation drains services and copies the initial database, media and file
sessions to private run directories. This initial copy may cross filesystems;
stage checkpoints always use reflinks. During the run, temporary Compose mounts
point at those private copies. Cleanup restores the original mounts and starts
the application again. Redis is treated as derived cache and is cleared on
restore; OpenSearch must remain read-only during these journeys. Other mutable
files, remote services, payments, emails and external queues need their own
qualified boundary. Do not use a live shop or allow other users/writers into the
test installation during a run.

The private nginx configuration bounds waiting for request headers to five seconds
so speculative browser connections do not hold checkpoint shutdown open. Accepted
application requests still drain normally; their execution timeout is unchanged.

Reports are saved under `.runtime/branching-results/<run>.json`. They contain
per-branch results, timing phases, checkpoint lineage and actual reuse counts.
Any capture, restore, assertion or cleanup error fails the command, even if a
fallback replay completes the remaining branches. Checkpoints stay on disk for
the run and are removed after successful cleanup. No speedup is assumed: compare
complete P0 and L0 runs on the same workload, including preparation and cleanup.

## Live branching dashboard

Start the local viewer in another terminal, then run your workflow normally:

```bash
./bin/branching-dashboard
# Open http://127.0.0.1:4173
```

`bin/run-coverage --branching` records live graph events under `.runtime/branching-events/`.
The dashboard shows the selected graph, active work, checkpoint reuse and
cleanup. First checkpoints are blue, follow-up checkpoints green, end tests red,
and steps executed linearly gray. Groups flow downward in execution order, with
numbered tests beneath their shared setup. **Follow active** scrolls to the
pulsing checkpoint or test; turn it off to inspect another part of the graph.
Reduced-motion preferences use a steady indicator and immediate scrolling.
The right-hand **Test progress** list shows the same execution as a linear
sequence. Its progress includes setup actually executed or restored for each
test; it is not an estimated percentage of elapsed time. Passes have bold green
checks and failures bold red crosses in both views.

Hover, focus or click a checkpoint or test for its details, including source,
consumers, last consumer and release policy. Escape dismisses the popup. Released
checkpoints keep their history with a dashed border; failed cleanup remains
marked as requiring recovery.

The viewer reconnects after a connection loss and preserves the selected run
and checkpoint on refresh. Dashboard file changes reload the browser automatically;
the launcher also restarts the viewer when its server code changes. It is an
observer: closing it does not stop tests. Finished journals
remain available after checkpoint storage is removed. The display reflects the
last recorded engine state; abrupt process termination does not become a
successful run.

**Follow latest run** automatically opens each new execution, including after
refresh. Selecting an older run or the source preview pauses that behavior;
press the button to resume following live work.

If `.runtime/branching-plan.json` exists, **View source plan** previews the Rust
planner's candidate graph before cost selection. The actual run graph shows
which candidates were selected, including a fully linear AUTO decision. Change
the local port, event directory or manifest with positional arguments:

```bash
./bin/branching-dashboard 4174 .runtime/branching-events .runtime/my-plan.json
```

The viewer uses the pinned Node container, requires no application installation,
and binds only to host loopback. It reads graph metadata through a read-only
mount and receives no Docker socket. Journals contain node labels, source
locations and lifecycle events, not checkpoint contents or application state.
Keep them local. The viewer displays the 20 most recently modified journals,
up to 4 MiB each; it never deletes history. Remove old journals explicitly when
they are no longer needed.

Library callers can pass `eventDirectory` to `runBranches` or `execute`, or set
`MAGELENS_BRANCHING_EVENTS` in their driver environment. Journal writes run in a
separate worker; the viewer receives event deltas and builds the graph in the
browser. An optional `onEvent` callback is delivered asynchronously in order.
The final journal drain is included in elapsed time and bounded to one second.
Observation failures are recorded under `report.observation` and cannot change
test execution or cleanup.

## Define setup stages and sibling tests

A CommonJS workflow exports `workflow` and a read-only `state(runtime)` function.
See [the runnable storefront example](../playwright/branches/storefront.cjs).
Each stage has an `id`, optional single stage `parent`, `run` and `assert`.
Each spec has an `id`, stage `parent`, `run` and `assert`. IDs must be unique.
Optional JSON `inputs` are passed as the second callback argument. An optional
`label` supplies a readable dashboard title without changing checkpoint identity.
Automatic plans use test titles and the final call at each checkpoint boundary,
such as `After checkout.selectShipping()`, or an explicit `test.step` title.
Function arguments are omitted. The popup identifies the exact source file and
line; regenerate older manifests to obtain source-derived labels.

Execution selects at most **nine checkpoints along any one test's path**. This
limit is stored in `branching/planner/src/limits.json`; changing it requires
rebuilding the Rust planner. AUTO chooses estimated savings under that limit,
including capture/restore costs and repeated consumers. Forced P0 and direct
library execution enforce the same cap, preferring repeated work saved using
action units (one structural unit for an unknown manual stage). Unselected
boundaries remain ordinary steps: no test actions are removed. Reports and the
dashboard warn when a path has more than nine reusable candidates; this is a
suggestion to review or split the journey, not a test failure. Independent paths
can together use more than nine checkpoints.

```js
module.exports = {
    workflow: {
        identity: {
            source: 'application-revision', fixture: 'checkout-fixture-v1',
            configuration: 'same-customer-address-group',
            dependencies: 'dependency-lock-digest', implementation: 'checkout-v1'
        },
        stages: [{id: 'checkout-ready', run: prepareCheckout, assert: assertCheckout}],
        specs: [
            {id: 'check-order', parent: 'checkout-ready', run: placeCheckOrder, assert: assertCheckOrder},
            {id: 'free-order', parent: 'checkout-ready', run: applyFullDiscountAndOrder, assert: assertFreeOrder}
        ]
    },
    state: readNormalizedCheckoutState
};
```

Callbacks receive `runtime.page`, `runtime.context`, `runtime.sql(query)` and
`runtime.allocateId(prefix)`. Use ordinary Playwright locators and assertions.
Read `runtime.page` in each callback: restored siblings have a new page object.
IDs are allocated outside checkpoints and include a run UUID, so sibling
restoration cannot rewind the allocator. This does **not** rewrite Magento's
database sequences or make external integrations idempotent; use the allocated
ID as an external correlation/idempotency key where your fixture requires one.

`state` must return stable JSON describing the relevant application state,
including details which stage assertions might miss. It runs with HTTP/PHP
drained, so use database reads and local file reads rather than HTTP requests.
P0 compares this state after capture and on the first actual checkpoint restore.
Exclude irrelevant timestamps only deliberately; do not omit state needed to
distinguish sibling leaks. Stage assertions run after every restore. Identity
fields must describe your source, fixture, configuration and dependency versions;
checkpoints are private to one run and never reused between runs.

For the intended checkout evaluation, keep the customer, address and customer
group shared, then branch across product types, coupons/no coupon, and check or
free orders. Group siblings under a meaningful shared setup checkpoint. A linear
chain of many checkpoints does not measure the intended fanout benefit.

## State and coverage boundaries

Browser restoration covers cookies, localStorage, IndexedDB and OPFS. Restored
siblings reload the saved URL. DOM, JavaScript heap, sessionStorage, timers,
network connections and live handles are not restored. The first sibling keeps
its original page, so stage assertions must establish a state that can also be
reconstructed for later siblings. Only one page is supported at a checkpoint;
active workers, WebSockets and background cron/queue writers are rejected.

Only same-origin public immutable static responses enter the retained browser
code cache, including static HTML templates. Customer responses, storefront HTML,
API responses, authenticated requests,
responses setting cookies and unsupported `Vary` headers are excluded. PHP's
file cache is new for each run and retained across its restores. Source code and
static assets must not change during a run.

P0 reports **coverage unsupported**. It does not publish coverage reports or
badges, and its PHP mode disables PCOV for the private run. Lineage distinguishes
setup actually executed from setup inherited through a checkpoint; inherited
work is not counted as newly executed code. Use `./bin/run-coverage` for current
coverage collection. Coverage equivalence and the full platform release matrix
remain separate qualification work.

## Plan existing Playwright tests

The Rust planner reads `.spec.ts`, `.spec.js`, `.test.ts` and `.test.js` files,
normalizes syntax tokens, detects repeated prefixes and writes a manifest.
It groups tests by shared ancestry and keeps each checkpoint until its last
selected consumer finishes. Ancestors remain available while a later sibling
may need them. Single-consumer prefixes do not get snapshots.

```bash
./bin/plan-branching path/to/test-project .runtime/branching-plan.json
./bin/run-coverage --branching --disposable --auto .runtime/branching-plan.json \
  playwright/branches/automatic.cjs /path/on/cow/storage AUTO
```

Docker builds the pinned Rust binary; host Rust and Node are unnecessary. Choose
an input root containing the test project's helpers, configuration, lockfiles and
fixtures. Hidden files/directories, dependencies and generated reports are excluded. The
manifest records source hashes, repeated statements, fixture identity, candidate
parents, consumers, execution order, expected release points and unsupported
patterns. Keep the manifest outside that input root or under `.runtime`.

The launcher verifies the manifest against a fresh plan before starting a run.
`AUTO` is the default: Rust estimates the whole repeated prefix, including fixture
preparation, from source action units and a fixed benchmark constant. It selects
checkpoints only when their estimated savings cover capture, restore and cleanup
costs for the selected consumers. Tiny or unknown-cost prefixes run linearly;
all their steps and assertions still execute. There is no calibration or cost
profile lookup during a normal run. See the [static baseline](branching-cost-baseline.md)
for the editable constants, reference measurements and their limits.

Use `P0` to force eligible snapshots for comparison, or `L0` for the same selected
tests without snapshots. Append test IDs from the
manifest to run an explicit subset. Unknown IDs, stale source, syntax errors and
unsupported selected tests fail before application preparation. Dynamic test
registration requires native Playwright collection; an unfiltered launch with
such diagnostics is refused. Unsupported tests are never silently skipped.

The built-in executor handles inline callbacks with `{ page }`, direct `test`
and `expect` imports from `@playwright/test`, and no project hooks or fixtures.
It shares standalone awaited prefix statements that have no carried local
bindings. Declarations, callbacks inside prefix operations, hooks, `test.use`,
modifiers, custom fixtures and project imports need an adapter. The planner
retains those candidates and explains the restriction in the manifest.

Supply a project configuration like `playwright/branches/automatic.cjs` with
fixture/dependency identity, `state(runtime)` and
`assertCheckpoint(runtime, checkpoint)`. Extend its read-only example for your
customer, quote, addresses, product types, coupon and payment conditions.
The planner does not infer application state or quiescence from equal source
text. Its checkpoint cost is a static estimate, not a measured speedup guarantee. Run on the same disposable installation and CoW storage
required by explicit workflows. Coverage remains unsupported.

## Interrupted runs

Normal failures clean up through the same path. An interrupted process or failed
service recovery leaves `.runtime/workflow.lock`, recovery metadata and owned
state for inspection. Do not remove an active lock or delete mounted state.
After confirming the driver has exited, inspect
`.runtime/branching-recovery.json` and this project's containers. Unpause its DB
if needed, stop its app/PHP/DB, then use the normal configuration to recreate the
original services:

```bash
./bin/application-compose unpause db
./bin/application-compose stop -t 60 app phpfpm db
./bin/application-compose up -d --no-deps --force-recreate --wait db phpfpm app
```

Verify the original DB volume and media/session mounts before removing the
recovery marker, the lock's `branching.json`, and the empty lock directory.
Remove only the specific owned run directory listed in the recovery metadata.
Reports and snapshots may contain test data and browser credentials; keep them
local and do not commit or upload them wholesale.

## Library use and checks

`playwright/branching.cjs` exports `runBranches`, `Graph` and `P0Provider` for
embedding in a Playwright test with a custom backend. A backend supplies
`identity`, private `paths`, and `prepare`, `drain`, `pause`, `unpause`, `stop`,
`start`, `resetCaches`, `cleanup`. Preparation leaves private state stopped;
drain must block new writes and finish accepted work. Pause must freeze all
database writers and synchronize its files. Always assert `report.status ===
'passed'` when embedding; the CLI does this automatically. Do not combine this
prototype with the coverage fixture or concurrent tests in the same shop.

Providers may implement `beforeSpec({id, parent, index, next, nextParent})` to
plan background preparation. The engine calls it before resolving each selected
test's prefix, including after an earlier setup failure, so planning does not
depend on the previous test body having executed.

Run `npm run test:integration` for contract and orchestration regressions.
`tests/branching-browser.cjs` is an explicit isolated MariaDB/Chrome reproduction
using a dedicated CoW directory and the P0 driver image. It checks file, database,
browser-storage isolation, first-page continuation and retained static code.
It does not replace Magento checkout or release CI qualification.
See the [P0 validation record](branching-validation.md) and
[automatic planner validation](branching-automatic-validation.md), and the
[independent checkout comparison](branching-checkout-validation.md), for completed
checks and remaining qualification work.

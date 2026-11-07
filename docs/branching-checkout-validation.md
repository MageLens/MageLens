<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Checkout validation on the public Hyvä installation

This focused Linux investigation uses Mage-OS 4.0.0, Hyvä CSP 1.5.3,
Playwright 1.65.0 and Chrome for Testing 156.0.8078.80. It is separate from
release qualification and from the upstream commercial checkout suites.

## Available checkout

Hyvä's [open-source announcement](https://www.hyva.io/blog/news/hyva-is-free-open-source.html)
applies to its theme. The [Magewire checkout installation](https://docs.hyva.io/hyva-checkout/getting-started/index.html)
still requires a license. The user authorized excluding that unavailable product.

The isolated installation was created through MageLens's normal
`--mageos --hyva --playwright --container-only` installer, in a separate Git
worktree with its own Docker project, ports, database and resource limits.
The public [Luma fallback](https://github.com/hyva-themes/magento2-luma-checkout)
was then installed through Composer. Neither host DNS nor existing applications
were changed. The extra packages were pinned to public archives:

| Package | Version | Commit |
| --- | --- | --- |
| `hyva-themes/magento2-luma-checkout` | 1.1.7 | `4a77fd88723415e64fbec10e2d40dc650a2e15d0` |
| `hyva-themes/magento2-theme-fallback` | 1.0.4 | `6673002d68b23c850b84808ca93b7c9ac7141c49` |

The fallback is an additional package: installing the theme alone displayed
“No Checkout module installed.” This investigation does not change MageLens's
default installer or its dependency pins.

## Workload and assertions

`tests/branching-checkout.cjs` runs nine native Playwright journeys:
simple/configurable/bundle products, each with no coupon and check payment,
a 10% coupon and check payment, and a 100% coupon with free payment. The fixture
uses the same authenticated customer, saved address and customer group.

Three candidate boundaries follow login, product selection, cart construction
and shipping selection. Each serves three complete order tests. The first
sibling continues on its live page; subsequent siblings reconstruct the payment
page from saved browser and application state. Checkpoints use last-consumer
lifetime. AUTO calls the Rust static cost planner; it does not calibrate at run
time. The reviewed helper counts are 34, 36 and 39 browser actions/assertions.
These are explicit workflow adapters, not automatic extraction of all upstream
Playwright hooks and fixtures.

Orders are placed by clicking the actual checkout UI. Assertions inspect both
the customer order page and persisted customer/group/address, product choices,
money, payment, coupon usage and inventory reservations. Every sibling starts
without earlier sibling orders. A durable external ledger allocates order entity
and display IDs outside snapshots. Known checkout queues drain to completion;
unexpected, retrying or failed queue work fails the run.

Cleanup verifies that the original database state returned, recovery markers
and locks were removed, and the backend restored its original service mounts.
Failures retain reports, screenshots and accessibility snapshots outside the
deleted checkpoint storage.

## Application failure found by the tests

The first complete L0 run executed all nine cases: six passed and all three
bundle cases failed. The orders were placed, but their selected component labels
were absent from the Hyvä customer order page. Magento's pager supplies parent
items, while Hyvä's default item renderer omits persisted `bundle_options`.
The original failure remains in the audit artifacts; no assertion was removed.

The matching P0 run also passed six and failed the same three bundle assertions.
It executed three prefixes, published three checkpoints, restored six times,
validated all three checkpoints on first reuse, and had zero fallbacks or
checkpoint errors. Both modes restored the original state and removed locks and
recovery markers. L0 took 336.57 s and P0 360.60 s (7.1% slower). These runs include
the failing UI assertion waits and are retained as development evidence, not a
successful performance qualification.

`tests/fixtures/branching/hyva-bundle-options.patch` adds escaped labels and
quantities from the order's stored selections to that renderer. It records the
exact upstream version, commit and original file hash. This is a temporary
application compatibility fix for the isolated validation shop, not a branching
optimization or a change to the default installation. Recheck it against future
Hyvä versions and remove it when the unpatched theme passes the same assertions.

## Reproduction and interpretation

### Correction to the linear control

The first repeated campaign was stopped after two complete pairs. Its `L0`
used `P0Provider` with checkpoint reuse disabled: it still received CoW baseline
resets, the retained public-asset cache and the PHP file cache. Both arms also
used the same Docker project sequentially. This was a shared-provider reuse
experiment, **not the requested conventional-linear versus P0 comparison**.
Its 36 order tests passed with equal semantic states and complete cleanup, but
its performance result must not be presented as that comparison.

The replacement control, `tests/branching-checkout-linear.cjs`, has a separate
Docker project, network, database, source tree, media, sessions, Redis,
OpenSearch and browser. Its application tree is an ordinary byte copy and its
database is seeded through SQL. Each test imports the SQL baseline, extracts
ordinary media/session tar files and creates a fresh Playwright context. It
does not load the P0 provider, reflink storage, browser restoration or custom
asset cache modules. Normal browser caching within a test remains enabled;
PHP's normal memory cache is enabled, with no persistent PHP file cache.

The two drivers mount only their own mutable installation/storage and the same
read-only test code. An inventory checks that application containers share no
writable mount or network. The inactive stack is stopped during measurement.
The host kernel, CPU and physical disk remain shared; the runs are sequential.
The nine journey implementations and business assertions are shared through
`tests/fixtures/branching/checkout-journeys.cjs` so the control exercises the
same orders. Order allocation uses disjoint durable ranges in the two projects.

The historical practical benchmark used SQL imports for the linear baseline
and 500 ms service health checks. The initial port used CoW baseline resets and
the installed 5 s health intervals. Historical and current whole-suite times
therefore cannot be treated as a matched implementation regression. The corrected
comparison uses three alternating full-suite pairs. A separate
controlled experiment changes PHP and database health-check intervals to
500 ms on both installations, plus PHP startup polling to 500 ms; MariaDB has
no startup grace period. Probe commands, startup grace periods, retry counts,
test code and assertions remain unchanged. This
is an explicit fast-readiness profile, not an exact recreation of the old
benchmark's 500 ms interval and 1 s startup grace period. Both original Compose
files are restored after the experiment.

### Completed readiness comparison

| Profile | Full pairs | Linear median | P0 median | P0 time increase |
| --- | ---: | ---: | ---: | ---: |
| Installed 5 s health intervals | 3 | 275.37 s | 313.98 s | 14.02% |
| 500 ms health intervals and PHP startup polling | 2 | 224.32 s | 228.73 s | 1.97% |

All 90 measured orders passed with equal normalized business states and unique
order references. Every P0 suite captured three checkpoints, reused them six
times, and released all three after their last consumers. Every suite restored
its baseline and removed locks, recovery markers and private storage.

Mean service-start command time, including final recovery, fell from 125.54 s
to 38.10 s for P0 and from 54.99 s to 9.91 s for linear. The difference between
the two full-suite means fell from 39.96 s to 4.41 s. This controlled change
shows that readiness scheduling explains most of the observed relative
slowdown. It does not prove that all remaining differences are intrinsic to
branching. Two pairs are a small exploratory sample, not a broad performance
qualification.

The fast-profile setup initially failed before any test ran: Docker rejected a
startup interval on MariaDB without a startup grace period. The rejected setup
and its cleanup are retained under `.runtime/checkout-health-setup-failure/`.
The successful experiment changes only the regular MariaDB interval and both
PHP intervals. No functional assertion was skipped or retried away.

### Why the PHP waits differ

The measured command is service startup plus readiness detection, not PHP
request processing. In the default profile, a PHP/app start takes about 5.5 s
on either arm. This implementation repeats that operation more often in P0.
Within the nine tests, excluding final cleanup:

| Operation | Conventional linear | P0 |
| --- | ---: | ---: |
| PHP/app starts | 9 | 12 |
| Database starts | 0 | 9 |
| SQL baseline imports | 9 | 0 |
| Shared prefixes executed | 9 | 3 |
| Checkpoints captured | 0 | 3 |
| Checkpoint restores | 0 | 6 |

Linear drains PHP, replaces the database through SQL while MariaDB stays alive,
and resumes PHP. P0 restores raw database files, so the current backend stops
MariaDB, replaces its files, waits for MariaDB readiness and then resumes PHP.
Each of its three checkpoint captures also drains and resumes PHP. Snapshot
capture retains the live database; subsequent restores restart it. The extra
starts are a property of this implementation, not evidence that PHP or MySQL
execute the same application requests more slowly under branching. Linear's
SQL imports and DROP/CREATE work must also be included when comparing totals.

An operation trace also identified 107 additional PHP status inspections in
the checkout harness, costing about 15 s per default-profile P0 suite. The
fixture checks Docker status before each PHP command; the old benchmark and
conventional control use an already-known fenced/stopped state. This is
measured harness overhead. It has not been removed during these comparisons;
removing it safely and measuring the benefit is a separate optimization.

### Reproduce the two controls

Run the harness inside the P0 driver image with the Docker socket, repository,
owned disposable installation and CoW storage mounted at their host paths.
Set `MAGELENS_P0_IMAGE`, `MAGELENS_HOST_UID`, `MAGELENS_HOST_GID` and the isolated
`PLAYWRIGHT_BASE_URL`; join that installation's network. The installation must
contain `.runtime/experience-owner.json` with purpose
`isolated branching experience validation`. This guard is additional to the
normal backend lock and private-state checks.

```text
node tests/branching-checkout.cjs DISPOSABLE_INSTALLATION COW_STORAGE prepare
node tests/branching-checkout.cjs DISPOSABLE_INSTALLATION COW_STORAGE L0
node tests/branching-checkout.cjs DISPOSABLE_INSTALLATION COW_STORAGE P0
node tests/branching-checkout.cjs DISPOSABLE_INSTALLATION COW_STORAGE AUTO
```

`prepare` is one-time synthetic fixture provisioning and refuses an existing
fixture. Run it only after Composer installation and Magento setup complete.
Before applying the compatibility patch, verify its recorded original SHA-256;
apply with `patch -p1` from the disposable installation's `src` directory and
flush that shop's caches. Never patch an active branching run.

The original `L0` mode above is the withdrawn CoW control. Use the separate
linear entry point with its own installation and artifact directory:

```text
node tests/branching-checkout-linear.cjs INDEPENDENT_LINEAR_INSTALLATION OWNED_LINEAR_ARTIFACT_DIRECTORY
```

Provision the linear shop from the same application/Composer tree and fixture
through ordinary file copying and SQL import. Set its ownership marker's
`arm` to `conventional-linear` and `project` to its own Compose project. Disable
coverage collectors equally on both arms; leave ordinary in-memory OPcache
and browser caching enabled, with no persistent OPcache file cache in linear.
Give each driver only its own writable installation and storage, the Docker
socket, and shared read-only test code. Stop the inactive stack before each
suite. Compare complete nine-test suites in alternating order, including
preparation, every reset and checkpoint operation, and final cleanup.

Both linear controls replay every prefix and reset the application baseline
for each test. These timings therefore measure suites with complete database
isolation between tests. An ordinary Playwright suite with different per-test
teardown has a different baseline. Diagnostic API counts also include the
provider's browser checks and cache operations, so they are not interchangeable
with the source action-unit estimates.

The private external-suite inventory is 92 registrations (3 setup and 89 Chromium,
including 11 storage-helper tests and 3 upstream fixmes). A source manifest or
successful nine-case adapted checkout run does not establish that all of those
tests pass. Commercial checkout scenarios and production screenshot comparisons
have separate prerequisites. No release E2E matrix, coverage-equivalence or
Windows/macOS qualification is claimed here.


## Experiments keeping services alive

The follow-up investigation tests three implementations against the same nine
journeys: retain PHP while restoring CoW database files; retain PHP and MariaDB
with two alternating schemas; and prepare the inactive schema while the current
sibling runs. These experiments use the 500 ms readiness profile, preserve the
original P0 runtime and conventional control, and include all preparation and
cleanup in the measured suite time.

The HTTP container is paused at the boundary. A separate internal PHP-FPM status
socket verifies zero active requests and an empty listen queue, including work
that continues after `fastcgi_finish_request()`. Known queues drain, and active application transactions and database connections
must reach zero. The guard permits only the registered root import into the
owned inactive schema; all other transactions must finish. The existing browser
fence remains in place. PHP workers keep running. A direct
FastCGI probe verifies the selected schema and rejects persistent PDO
connections. Worker IDs and container start timestamps prove continuity.

The filesystem restore preserves the mounted directory inodes and replaces
their contents. Deleting and recreating the directory itself would leave a
running container attached to the old mount. Application code remains unchanged.
The two-schema variant reads an atomically switched schema selector through its
private deployment-config wrapper on every request. Only the owned run's two
schemas can be selected; the original shop and the conventional linear stack
remain separate.

Schema preparation uses a consistent SQL dump of the checkpoint. The serial
variant includes DROP/CREATE and import in each restore. The prefetch variant
prepares only the next required schema while the current sibling runs; the
ordered graph determines whether to prepare the same checkpoint or the initial
baseline for the next product group. It verifies the prepared snapshot digest
before switching, waits for preparation if necessary, releases its extra SQL
copy after the last consumer, and joins background work before cleanup.

Initial qualification runs exercise all three simple-product variants and a
PHP request that returns its response before finishing a delayed file write.
The fence must observe the busy worker and wait for that write. Each variant
passed with one checkpoint, two restores, matching order states and complete
cleanup. The initial full-suite exploration recorded 213.66 s for retained PHP with raw
CoW database restores, 281.30 s for serial schema preparation, and 186.97 s for
background schema preparation. These are single exploratory samples. The next
background-preparation suite failed before the first test body because the
initial guard incorrectly rejected its own import into the inactive schema.
Cleanup passed; the failure is retained as report
`16a1f1d4-5bce-4359-8985-a850bde838c5`. That campaign was stopped, not qualified.

The failure also exposed a cursor bug: advancing a prefetch plan from test-body
completion misses failures during prefix resolution. The engine now invokes an
optional `beforeSpec` hook before resolution of each selected test. The corrected
provider anchors its cursor to the actual selected index. Regression tests
verify cursor advancement after reset failure and reject transactions in the
active, unrelated or unowned schema. All 271 integration tests passed after
these changes.

The corrected live-server variant creates its two schemas in the existing
MariaDB server and leaves the original `magento` schema intact. It checks server
continuity from preparation through cleanup and verifies exact restoration of
the application's database grants. Its three-order qualification passed,
including the delayed PHP writer, both schema switches and complete cleanup.
The original P0 backend remains unchanged by these experimental choices.

A further conventional control retains PHP workers while continuing to restore
ordinary SQL and tar baselines into its own fixed database. It uses fresh browser
contexts and neither CoW storage nor P0's asset cache or schema-switching code.
This separates the gain from merely avoiding PHP restarts on the branching side.

The experimental entry points use the same container driver and ownership
guards as the checkout comparison:

```text
node tests/fixtures/branching-restarts/run.cjs DISPOSABLE_INSTALLATION COW_STORAGE warm-php
node tests/fixtures/branching-restarts/run.cjs DISPOSABLE_INSTALLATION COW_STORAGE two-schema
node tests/fixtures/branching-restarts/run.cjs DISPOSABLE_INSTALLATION COW_STORAGE two-schema-prefetch
node tests/fixtures/branching-restarts/live-run.cjs DISPOSABLE_INSTALLATION COW_STORAGE two-schema-prefetch
node tests/fixtures/branching-restarts/linear-run.cjs INDEPENDENT_LINEAR_INSTALLATION OWNED_LINEAR_ARTIFACT_DIRECTORY
```

`live-run.cjs` is the variant that preserves the original MariaDB server through
setup and cleanup. `linear-run.cjs` is the stronger conventional control with
PHP retained between tests. Both still install and remove their private FPM
status configuration at suite boundaries; these costs are included. They use
the same 500 ms readiness profile for those suite-boundary operations.
The internal drain uses PHP's documented [FPM status interface](https://www.php.net/manual/en/fpm.status.php).
The delayed writer specifically exercises work continuing after
[`fastcgi_finish_request()`](https://www.php.net/manual/en/function.fastcgi-finish-request.php).
These are isolated prototype checks with one configured PHP worker, local file
sessions, known queues and nonpersistent application database connections;
additional connections, external writers and distributed services require
separate qualification.

### Completed retained-service comparisons

The final comparison retains PHP and MariaDB on both sides between tests. The
linear control still resets its fixed schema through SQL and replays all nine
prefixes. Branching prepares an inactive schema concurrently and executes the
three shared prefixes once each.

| Comparison | Full pairs | Linear median | Two-schema median | Time reduction |
| --- | ---: | ---: | ---: | ---: |
| Two schemas versus the original SQL linear control | 2 | 230.42 s | 182.53 s | 20.79% |
| PHP retained on both sides | 2 | 217.76 s | 181.61 s | **16.60%** |

The stronger control's first pair was 215.70 s linear versus 184.70 s branching
(14.37% less time); the reverse-order pair was 219.81 s versus 178.52 s
(18.79% less time). Each comparison passed all 36 measured order journeys with
equal normalized business states and unique order references. No failures or
fallbacks occurred. Every branching suite captured three checkpoints, restored
six times, released all three after their last consumers and released all three
additional SQL cache copies. Both owned stacks were stopped afterward and their
original Compose configurations restored.

MariaDB retained its original start timestamp through preparation and cleanup.
PHP retained its worker PID and container start timestamp across all nine tests;
setup and cleanup still recreate PHP to attach and remove its private test
configuration. The two temporary schemas were removed, database grants exactly
restored, and the original shop state, locks and storage verified clean.

The nine background imports totalled 51.60 s and 53.92 s of elapsed work in the
final two branching suites, while their accumulated foreground waits were only
4.06 s and 5.63 s. These overlapping import durations must not be added to suite
wall time. This explains why preparing the inactive schema during a sibling's
execution matters; serial preparation left the import on the critical path.

Times are engine wall time from provider preparation through final cleanup.
One-time fixture installation, external stack startup, browser-process launch
and the additional post-run audit are outside that timer on both sides. The
gain is for the combined checkpoint, cache and background-schema implementation,
not an isolated estimate of checkpoint reuse alone. Two pairs establish a
promising local result, not a general speed guarantee or broad reliability
qualification.

Evidence is retained in `.runtime/restart-experiments/live-pairs.json`,
`warm-pairs.json` and `analysis.json`, including source SHA-256 fingerprints,
report paths, operation timings and continuity events. The failed exploratory
campaign remains separate in `measurement.json`. The final source fingerprints
were rechecked after completion. The original P0 default backend and static
Rust planner constants remain unchanged; these experiments require explicit
entry-point selection.

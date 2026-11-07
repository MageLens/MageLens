<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# P0 port validation — 7 November 2026

This is a prototype implementation report, not MageLens 2.0 release qualification.
Usage and boundaries are in [branching.md](branching.md).

## Provenance and scope

The port adapts the frozen `benchmark-candidate-continue-2` P0 decision: B2 CoW
checkpoints plus public browser/PHP code caches (3) and snapshot-and-continue (1).
The source candidate manifest SHA-256 is
`3b9ac01dd4585bab241696ec9dae796cc36ef319aef2b2a4aa8c7aa38ffc16a0`.
The frozen research sources and measurements were left unchanged.

The graph/checkpoint contract is retained. Benchmark-specific checkout RPCs are
replaced by native Playwright callbacks. The Magento adapter works on private
database/media/session copies and restores the installation's original mounts.
Fallback replay is diagnostic: any checkpoint error fails the overall command.
Shared filesystem blocks are not reported as exclusive physical storage usage.

The local `L0` option replays all setup stages, using the same private initial
fixture and code-cache policy. It is a correctness/comparison control for this
port, not a reproduction of every historical linear benchmark configuration.

## Checks performed

- `npm run test:integration`: **249 passed, zero failed/skipped/canceled** in a
  container with Node 24.22.1, PHP 8.4.27 and Docker Compose available.
- All five `tests/*.test.php` scripts passed, including real PCOV/report output.
  Report dependencies were installed from this checkout's Composer lock
  (`phpunit/php-code-coverage` 14.5.1); an older research image's 14.5.0 was not
  used to claim a successful current report check.
- Node/Bash syntax checks, Git whitespace checks and tracked copyright notices
  passed.
- `tests/branching-browser.cjs`: real MariaDB 11.4, XFS CoW storage, Playwright
  **1.65.0** and Chrome for Testing **156.0.8078.80**. Two shared setup stages fed
  three siblings, with two restores, one first-reuse validation and no fallbacks.
  Assertions covered DB/media/session isolation, cookies, localStorage,
  IndexedDB, OPFS, retained first-page heap, reconstructed later pages, one
  browser context, unique external IDs and static-cache reuse.
- The normal `bin/run-branching` command was exercised against a separate
  disposable Mage-OS 4.0.0/Luma installation copied from the research fixture.
  Both storefront siblings passed in P0 and L0; P0 reused its setup checkpoint.
  The final P0 run recorded 448 static-cache hits; PHP opcode files persisted
  through restore (4,670 at the shared checkpoint, growing to 5,200 by the end).
  Original media/session content hashes and the original order count were
  unchanged. Cleanup restored original mounts, released the lock and removed
  owned runs.

The actual adapter checks exposed and fixed the validated-Graph entry point,
nginx connection-drain delay and database health-monitor resume handling. Docker
stops its health monitor when paused and marks that state unhealthy; the adapter
now requires a **new successful probe after unpause** and rejects a new failed
probe. This follows the upstream
[monitor lifecycle](https://github.com/moby/moby/blob/master/daemon/health.go) and
[health state implementation](https://github.com/moby/moby/blob/master/daemon/container/health.go).
The private nginx configuration is syntax-checked before changing services and
uses [client_header_timeout](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_header_timeout)
to bound connections that have not submitted a request. Active application
requests retain their normal execution timeout and graceful drain.

## Not qualified here

No new speedup percentage is claimed from these smoke checks. The full checkout
fanout benchmark must be repeated on the port, including preparation, restores
and cleanup. The original research results are not measurements of this code.
The acceptance workload is simple/configurable/bundle products, each with a
check order without a coupon, a check order with a partial coupon, and a free
order with a full coupon: nine orders sharing the same customer, address and
customer group. Use meaningful checkout-ready fanout checkpoints and compare
terminal order state with full replay.

The full GitHub Actions release matrix, Magento Open Source/Hyvä branching
journeys, non-Linux hosts, external integrations and branching coverage
equivalence were not run or qualified. The prototype explicitly reports coverage
unsupported and does not publish coverage reports or badges. These checks do not
authorize a release.

## Live dashboard and checkpoint limits — 2026-11-07

The dashboard observes engine events through a local read-only HTTP/SSE viewer.
It stacks independent groups in execution order, follows active work, mirrors
the same execution in a linear test list, and exposes checkpoint/test details
through accessible hover/focus/click popups. Pass/fail outcomes are published
after terminal validation. UI revisions reload automatically; server revisions
restart the viewer through Node watch mode without restarting tests.

The Rust cost selector and direct P0 execution both enforce the shared constant
of nine checkpoint boundaries per test path. A twelve-boundary fixture verifies
that smaller savings lose priority, skipped boundaries still execute all their
actions, terminal state matches L0, and every selected checkpoint is released.
Separate paths may together select more than nine checkpoints. Warnings are
informational, not failed-test outcomes. This is a configurable product policy,
not a claim that nine is a measured universal optimum.

Validation completed in isolated Docker containers:

- `npm run test:integration`: **279 passed**, no failures or skipped tests.
  After the final viewer changes, all **7 dashboard integration checks** passed
  again, including terminal-validation timing and large SSE messages.
- `cargo test --locked`: **28 library tests and 3 CLI integration tests** passed
  in the pinned Rust 1.91.0 planner build. This includes path budgets, estimated
  savings, source-derived labels and exclusion of call arguments from labels.
- `bash tests/branching-dashboard.sh magelens-automatic-validation:local`:
  **20 Playwright checks passed**, using Playwright 1.65.0 and Chrome for Testing
  156.0.8078.80. Actual engine and Rust CLI execution covers source planning,
  AUTO/P0 selection, reuse, cleanup, failures, linear progress, ordered groups,
  scrolling, popups, code-change reload, reconnect and mobile layout.

The final self-test artifact directory is
`.runtime/branching-dashboard-self-test/20261107T125704Z-1323175/`.
JavaScript self-coverage across eleven explicitly inventoried files is **82.03%
statements, 73.16% branches, 89.91% functions and 87.31% lines**. Native Rust
planner line coverage is **77.23%**, reported separately. Unvisited JavaScript
entry points remain in the totals. All original source hashes matched; Rust's
constant/data-only `baseline.rs` is inventoried without invented executable
regions. These are coverage observations, not a completeness or release gate.

A live browser also observed the isolated checkout campaign
`70d5b65e-a525-4b68-880c-a9d9a49b2fda`: **9 orders passed, 3 shared checkpoints,
6 restores, no fallbacks, failures or blocked tests**. All three checkpoints,
the workflow lock, recovery marker and run storage were released; the original
baseline matched after cleanup. Its **81 metadata events** were recorded without
observation errors. The updated viewer was checked against that journal again,
including all nine linear outcomes and vertical ordering. The application stack
was stopped after validation; the viewer may stay open independently.

External-source previews and their adapter experiments are retained in ignored
local research storage. They are not part of this branch's public CI corpus.
The full GitHub Actions release matrix was not run for the dashboard change.

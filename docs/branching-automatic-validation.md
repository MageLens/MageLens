<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Automatic checkpoint planner validation

Validated locally on 2026-11-07 on `codex/2.0-playwright-p0`.

The Rust front end scans, token-normalizes, detects repeated prefixes, plans a
single-parent checkpoint graph and orders consumers. The opt-in launcher runs
the selected adapter in a separate container.
The existing worker owns browser/backend barriers, restore validation, original
service recovery and checkpoint deletion. There is one cleanup implementation.
A checkpoint is retained while any selected descendant may need it, including
fallback to an ancestor, and released after its last consumer finishes. A failed
consumer also releases its last references. Retained evidence opts out of early
deletion. Original explicit workflows keep their existing lifetime by default;
automatic workflows select `last-consumer`.

## Source analysis

The planner retains fixture identity and invalidates manifests when source,
configuration or helper files change. Custom fixtures and helper calls require
an explicit adapter; the public built-in executor supports bare-page tests.
Repository-owned fixtures cover repeated prefixes without an external corpus.

Normalization removes comments and formatting differences between syntax tokens.
It preserves literals, regular expressions, templates, names and statement order;
it does not mangle identifiers or infer equal values from equal variable names.
The source is executed from original UTF-8 byte ranges, not the normalized text.
The manifest records static repetition, not a prediction of runtime savings.

## Executed checks

- Pinned Rust 1.91.0: **25 unit + 3 CLI tests passed** in the planner image build.
  Covers nested fanout, fixture/hook separation, declaration boundaries, lexical
  normalization, UTF-8, source changes, symlinks, atomic publication ownership,
  stale/edited manifests and rejection of browser launch inside the Rust CLI.
  Launcher integration checks preserve arguments, worker exit status and cleanup. Static cost
  checks also cover combined fixtures/steps, exact thresholds, fanout, unknown
  units, nested savings, source action estimation and malformed graphs.
- `cargo clippy --locked --all-targets -- -D warnings` passed; Rust formatted
  with the pinned toolchain.
- `npm run test:integration`: **267 passed**, zero failed/skipped/cancelled/todo,
  using the repository's two-worker setting in the Node/PHP validation image.
- All five `tests/*.test.php` scripts passed in the real PHP 8.4.27/PCOV image
  using the locked report dependencies.
- Tracked-script syntax checks and copyright checks passed. External corpus
  integration and its original measurement records are kept in ignored local
  research storage and are not part of public CI qualification.

## Qualification limits

AUTO uses the fixed estimate documented in the [static baseline](branching-cost-baseline.md).
It does not recalibrate at launch. Equal source text does not establish a safe
or profitable boundary: project state readers and assertions remain required.
Project configuration, hooks, global setup and custom fixture lifecycles are not
implicitly reproduced by extracting callback statements. They need reviewed
adapters before automatic execution.

The full release E2E matrix, coverage equivalence and non-Linux branching have
not been qualified by these development checks. The automatic CLI reuses the
existing P0 application lifecycle. The feature branch is for review, not release.

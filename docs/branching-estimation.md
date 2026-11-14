<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Branching estimation

Branching discovers exact shared prefixes, verifies source and restoration
eligibility, and measures each prefix during its first normal execution.

```bash
./bin/plan-branching SOURCE_ROOT
./bin/run-coverage --branching
```

Planning does not execute tests or forecast durations. A failed plan preserves
the previous manifest and writes `MANIFEST.json.error.json`; successful replanning
clears that failure. Execution verifies source identities and the native inventory
again. Old ML manifests must be replanned. `--evaluate` and model configuration
are no longer supported.

At an eligible boundary, AUTO compares the measured prefix duration multiplied
by its remaining consumers with capture, restore, release and additional provider
lifecycle costs. The first execution is required work, not a saving. Existing
minimum-saving and overhead margins apply. Cheap prefixes continue normally.
Overlapping prefixes cannot claim the same avoided work twice.

Checkpoint operations are measured through application and browser readiness,
including state verification. The first complete restore updates the restore
cost before the next decision. Later observations conservatively refine separate
cost components. Capture is a sunk cost when deciding whether to keep using an
existing checkpoint. If reuse becomes uneconomical, remaining tests execute
normally through the verified reset path. A failed restore still fails the run.

Compatible project measurements are reused. When measurements are missing,
the bounded checkpoint calibration runs first; its one-time elapsed cost is
reported separately. Successful, clean runs persist operation measurements under
the workflow lock. Platform, browser, provider, source, service resources and
database-size identity changes invalidate incompatible measurements.

Grouping preserves project dependencies, serial groups, fixture scope and browser
isolation. Unsupported lifecycles remain native. Source discovery cannot authorize
restoring unsupported JavaScript closures or plugin state. Reports retain every
test, actual decisions, prefix timings, operation timings and recalibration
observations. Actual savings require complete paired executions and full coverage
equivalence; a favorable decision alone is not proof of a faster suite.

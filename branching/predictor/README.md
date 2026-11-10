<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Timing predictor development

This is an experimental, project-independent predictor and CI evaluation pipeline.
It does **not** replace the production source assessor or authorize checkpoints.
Unqualified models are usable only for evaluation, without controlling checkpoint decisions; strict inference throws
`ESTIMATION_FAILED` with status 500. Restoration eligibility remains a separate check.

Inference uses syntax counts from the pinned Babel parser and a small JSON Ridge
regression model. Callback and hook counts are kept separate from supporting code,
so large shared helpers do not overwhelm differences between tests. Explicit source
requests use `role: "work"` (the default) or `role: "context"`; native collectors assign
these roles automatically. Cypress `before` and `after` hooks count as work only for
the first and last runnable tests in their scope. Older model schemas retain their original extraction.
Playwright profiling reads the pinned runner's loaded fixture graph, including
dependencies, overrides, automatic fixtures and hooks. Test fixtures and per-test
hooks count as work; worker fixtures, hooks for the whole suite and fixtures with
their own timeout remain context because Playwright excludes their separate timing
slots from `TestResult.duration`.
Log-transformed counts reduce exponential extrapolation from
source size; grouped validation still determines whether a candidate is useful.
It neither evaluates JavaScript nor loads Python. Explicit training
uses the pinned packages in `requirements.txt`. Model snapshots, datasets and grouped
validation results are saved by SHA-256 under a private registry. Training never
changes a selected model. Select an older snapshot to roll back.
Grouped validation also compares the model with the training fold's median
duration, so a model that performs worse than this simple baseline is visible.

The pre-run scaling rule is:

```
prediction = model prediction × current baseline / training baseline × manual multiplier
```

`baselineMs` is the decision baseline reported by explicit
`./bin/run-coverage --branching --calibrate`. The configured root baseline may be used
for exploratory profiling, but must be recorded as such. Keep the baseline's meaning
and measurement protocol identical across training and inference. A checkpoint
baseline is only a proxy for application speed; CI reports raw and adjusted error to
test that assumption. Normal execution never runs a preliminary suite, repeats a
suite for prediction, retrains, or needs its own results to make its initial decisions. Successful checkpoint
measurements may update the baseline for the next run; the current forecast remains fixed.

## Project extension and explicit collection

Prepare a JSON request with `files` relative to that request, `runner` (`cypress` or
`playwright`), `unit` (`suite-tests`, `test` or `prefix`), `baselineMs`, `manualMultiplier`
(default 1), `environment`, `sourceFamily`, and `group`. Include the relevant helpers,
fixtures and configuration in the source corpus. Use the same `group` for related
workloads, repeated measurements and variants so they cannot leak across validation
folds. Keep the same `sourceFamily` across a project or workload generator.
CLI `files` entries can be paths or objects such as
`{"path": "helpers.ts", "role": "context"}`; paths are relative to the request file.

Projects can add `extraFeatures`, a map of named nonnegative numbers, such as
`{"fixture.items": 40, "fixture.bytes": 8192}`. Compute these from information already
available before execution. Do not put secrets, measured target duration or project
names in features. Preserve feature definitions between training and inference.
Missing context must be supplied here; it does not require framework-specific code.

```bash
node branching/predictor/cli.cjs prepare request.json before.json model.json
# Execute the authorized workload once, with its native runner.
node branching/predictor/cli.cjs observe before.json sample.json measurement.json
node branching/predictor/cli.cjs evaluate samples.json quality.json
python3 branching/predictor/train.py samples.json .runtime/predictor/registry
```

`measurement.json` contains `actualMs`, `passed`, `attempts` and the independently
recomputed `sourceDigest`. `samples.json` is an array of observations. Training rejects
failed, retried and changed-source observations; preserve these separately as failure
evidence. A suite duration is never a shared-prefix training label. Prefix collection
must measure the exact prefix boundary, including its fixtures and hooks. A trained
candidate remains unqualified pending an independent prospective campaign.

Normal native runner commands remain unchanged unless profiling is explicitly enabled
with `.runtime/predictor/profile.json`. That file can supply `model`, `modelDigest`,
`baselineMs`, `multiplier`, `sourceFamily`, `group`, `files`, and `extraFeatures`.
Profiling defaults to individual tests, matching the native training collector.
It freezes inputs under `coverage/predictor-*/predictions.json` before executing
the tests and saves observations and accuracy in `coverage/prediction.json`.
An explicitly selected `suite-tests` model retains whole-process measurement and
`coverage/prediction-before.json`; these labels cannot train a per-test model.
The isolated E2E harness enables this observational collection automatically.

Internal native adapters also accept `run(config, output, {profile})` to collect
individual test durations with either runner. Supply `profile.files` for helper
and fixture JavaScript or TypeScript paths relative to the project root. Included
files are fingerprinted before execution and checked afterward. Playwright uses
loaded callback functions, including generated declarations, without executing
their bodies during prediction. Fixture source files are fingerprinted too.
Cypress reports include `timing.nativeMs` and measured `timing.preparationMs`.
Training uses their difference: the collector's preparation runs inside the first
test's root hook and must not become predicted test work. This excludes measured
collector work, while runner transport and reporting remain within the native
boundary. The explicit `timingBoundary` version rejects older forecasts, even in shadow
evaluation; training rejects mixed versions for the same runner; old observations retain their original measurements. Playwright keeps
its native test-result duration. Neither boundary measures checkpoint prefixes.
Set `profile.group` to keep related generated files in the same validation fold;
otherwise each spec file is a group.
Explicit training campaigns can set `profile.sourceStore` to a private directory.
It retains exact source bytes by SHA-256, and observations reference those hashes
alongside the pre-run extension values. This permits later feature extraction
without replaying browser tests. These files can contain private project code;
keep them outside Git and public CI artifacts. Ordinary profiling does not save them.

## CI evaluation

Both native runners and every performance matrix pair retain forecasts made before
execution. Native CI evaluates individual tests; performance pairs require their
own `suite-tests` model because their totals include orchestration and checkpoint
work. A model for a different boundary produces a missing forecast, not a score.
Reports show model ID, missing forecasts, raw and adjusted errors, signed
bias, interval coverage and out-of-range inputs. Missing models are reported as
incomplete, never as zero error. Whole-suite reports mark checkpoint-decision accuracy
as unmeasured. Performance artifacts retain sanitized observations for 30 days.

To select a frozen CI model, run `node branching/predictor/cli.cjs pack-ci model.json model.b64`.
Set repository variable `MAGELENS_PREDICTOR_MODEL_GZIP_BASE64` to the generated file's
contents and `MAGELENS_PREDICTOR_MODEL_SHA256` to the printed model digest. Compression
preserves the exact model bytes while fitting the CI variable size limit. For small
models, `MAGELENS_PREDICTOR_MODEL_JSON` can hold the original JSON instead; configure
only one representation. For larger snapshots, use
`node branching/predictor/cli.cjs pack-ci-chunks model.json variables.json` and set
its numbered repository variables (`MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_1` through
`_4`, as needed), plus the printed model digest. Clear unused chunks and the two
single-variable representations. Chunks preserve the original bytes and are each
bounded by the CI variable limit. There is no automatic model-weight promotion. Baseline updates use existing
validated checkpoint measurements after the run, without replaying tests. Matrix campaigns accept
`predictorModel`, `predictorBaselineMs` and `predictorMultiplier` in their configuration;
CI uses its existing explicit CLI calibration for `predictorBaselineMs`.

Keep original training data and model snapshots outside Git, alongside compact
provenance. Clean obsolete browser output and disposable resources after collection.

The selected evaluation snapshot is published in the package registry as
`ghcr.io/magelens/predictor.ai:0.0.1`. Model bytes and training data stay outside Git.
The orchestrator Dockerfile consumes the package by registry digest, copies the
model to `/opt/magelens/predictor/model.json`, and verifies its SHA-256 during the
build. Multiple product releases reuse this same immutable model package.
Prediction is part of the orchestrator; the model has a separate manual delivery workflow
and is added to the orchestrator during the build. CI does not train, publish or update
the packaged model. Retain the training code in Git.
For a deliberate model update, train and validate a candidate privately, deliver
and publish the model package manually, then verify the published bytes before updating the
orchestrator's package version, registry digest and model checksum. Never overwrite
an existing package version. Ordinary product releases leave these pins unchanged.
Packaging does not qualify the model or enable checkpoint decisions.

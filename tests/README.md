<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Test your installation

Run the fast integration checks with `npm run test:integration`.

The full E2E matrix and release qualification use **GitHub Actions**. Focused local browser reproductions, development and debugging are allowed with isolated resources and bounded RAM/disk use. Do not run the full CI suite or E2E matrix locally unless explicitly requested. Local results do not replace final CI qualification. Local syntax, PHP unit and Node integration checks remain available. After `npm ci --ignore-scripts`, `npm run test:integration` limits concurrency to two workers to bound RAM use.

## Run CI

[CI](https://github.com/MageLens/MageLens/actions/workflows/ci.yml) runs only on pull requests. Merging and creating release tags do not rerun the matrix. The required matrix is:

| Host | Platform | Theme | Runner | Cases |
| --- | --- | --- | --- | --- |
| `ubuntu-latest` | Magento Open Source, Mage-OS | Luma, Hyvä CSP | Cypress, Playwright | 8 |
| `windows-latest` | Mage-OS | Luma | Cypress | 1 |

The host probe records the actual runner image, architecture, Bash and Docker/Compose versions. It requires Linux containers, writable host mounts, symlinks, container DNS and a published port reachable from the host before installation. A failed probe leaves the required case incomplete; it never substitutes a Linux runner.

Open or update a pull request to qualify its merge candidate. Inspect the run and download its evidence with:

```bash
gh run list --workflow ci.yml --branch BRANCH
gh run view RUN_ID
gh run download RUN_ID --pattern 'case-*' --dir ci-artifacts
```

After fixing a failure, push the new candidate. Use **Re-run all jobs** when retrying the same candidate; the gate rejects evidence from an earlier attempt. A partial rerun is useful only for diagnosis.

Configure the branch protection/ruleset to require **Required CI gate**. Static syntax/workflow checks, integration/PHP unit checks, and copyright/license notices are separate jobs. The final gate requires all nine E2E cases, **63/63 shared acceptance scenarios**, completed cleanup and all reports, then runs the original eight-way Linux comparison. Failed, skipped, pending, canceled, missing and stale results prevent success. All pull requests, including forks, run the same matrix against their exact merge candidate.

## Marketplace credentials

Set the repository Actions variable **COMPOSER_AUTH** to the Composer `auth.json` JSON for `repo.magento.com`. This shared test account is used by CI, including fork pull requests.

## Reports and debugging

Each `case-OS-PLATFORM-THEME-RUNNER-attempt-N` artifact contains `evidence.json` and sanitized `coverage/` JSON. Evidence records commit SHA, workflow run/attempt, OS image, architecture, memory, dependency pins, matrix case, step outcomes and test counts. Coverage includes the shared application counters needed for the original comparison, plus `equivalence.json` with every measured file's coverage outcomes and aggregate totals. Private paths, source and warning text are represented by stable hashes. `qualification-N` contains `qualification.json`, `theme-report-comparison.json` and, when all eight Linux reports exist, `linux-matrix-comparison.json`.

The gate compares all five Luma reports with each other (including Windows) and all four Hyvä CSP reports with each other. It checks PHP lines, JavaScript statements/functions/branches, template statements/functions/branches, DOM observations, source fingerprints, generated-script links, inventories, warnings and totals. Host paths, line endings, ordering and per-run metadata are normalized. Hit counts become covered/uncovered outcomes because repeated event/render execution can vary; differing coverage outcomes still fail. Missing snapshots and any same-theme difference block qualification and release publishing. The comparison lists differing files and coordinates; diagnostics are bounded without limiting what is compared.

Cypress uses the same source-built 16.2.1 binary locally and in CI, with the pinned cookie, document-initialization and response-timeout fixes in `docker/runner/cypress-source/`. `coverage/installation.json` records its upstream commit and patch digest. Each Cypress case also runs eleven isolated regressions (nine cookie/authorization journeys, document initialization and a delayed-response check); `cypress-runner-results.json` is included in its sanitized artifact and required by the final gate. For focused local investigation in an isolated installed runner, use `./bin/runner node tests/cypress-regressions.cjs`. This does not replace the final CI matrix. The source build runs upstream document-classifier, proxy and CDP unit tests and preserves Cypress's packaging and integrity checks; its build inputs and dependencies are discarded before the final image is produced.

Uploads run even after failures. Only explicitly selected counters and structured diagnostics leave the runner. Raw HTML/source reports, fixture payloads, auth files, private packages, databases, certificates, screenshots and raw service/install logs are excluded. Inspect the failed Actions step for additional diagnostics; never upload the temporary checkout or all of `.runtime/`. Artifacts expire after **one day**; download the sanitized evidence promptly. Each case is limited to **5 MiB**. Artifact names include the run attempt; the gate and publisher select that exact attempt so a rerun cannot reuse an older report. No dependency or result caches are uploaded. Three public tooling images are built once per PR attempt and retained as OCI artifacts for one day. These large artifacts contain no application source or credentials; allow for several GiB of temporary artifact storage. Each case pulls the same manifest digests from its local registry, and the gate requires matching image provenance. Release publication reuses the successful PR qualification when the released files are identical.

Every job runs one installation, with at most four Mage-OS and two Magento jobs in parallel on separate standard hosted VMs. E2E jobs have a 150-minute timeout and a 130-minute harness limit, allowing time for cleanup and uploads. CI stores installations under `MAGELENS_TEST_TMPDIR` on disk, avoiding Ubuntu 26’s RAM-backed `/tmp`. Disposable hosted Linux jobs remove unused Android/.NET/GHC/CodeQL SDK directories. Before installation, both the host and its Linux Docker engine must provide at least 25 GiB free disk and 6 GiB RAM; a sparse VM disk cannot hide an exhausted Windows host drive. Docker resources are never globally pruned. No local RAM or disk is consumed by installations. Cleanup addresses only the registered test project and volumes. Canceled/force-terminated jobs cannot qualify, and GitHub disposes of the hosted VM.

After an authorized release PR is merged, run **Actions → Publish release → Run workflow** on `main`, supplying the successful PR CI run ID and the full merged commit SHA. The publisher checks the exact run attempt's qualification and requires identical Git trees for the tested candidate and released commit, then promotes the qualified OCI images to GHCR without rebuilding, attaches `images.json`, creates the tag and publishes changelog notes. The `php`, `runner-cypress` and `runner-playwright` GHCR packages must allow anonymous pulls; a private package blocks publication. It does not run tests again. Publish while the qualification artifact is still available.

```bash
gh workflow run release.yml --ref main -f ci-run=RUN_ID -f release-sha=MERGED_COMMIT_SHA
```

## Hosted runner feasibility and cost

Linux uses its native Docker engine. [Windows feasibility](https://github.com/MageLens/MageLens/actions/runs/41296912030) passed Linux Docker/Compose, mounts, symlinks, DNS, Windows filesystem access and Windows-side loopback forwarding through the actual Windows runner's local WSL2 VM. The WSL disk lives on the temporary drive; disk checks include the backing Windows filesystem.

The standard ARM64 `macos-latest` host reported 7 GiB RAM and `kern.hv_support=0`. QEMU software emulation passed an initial container probe, but the full installation spent over an hour compiling PHP extensions; a [later VM startup](https://github.com/MageLens/MageLens/actions/runs/41312488890) timed out. This configuration could not complete the required host case reliably within the resource limits.

The standard Intel `macos-26-intel` host passed the local VZ/Linux-container, Bash, mount and networking probes. However, its [complete installation attempt](https://github.com/MageLens/MageLens/actions/runs/41322571485/job/124896085102) spent about two hours preparing images and packages, then exceeded Composer's 300-second archive-extraction timeout before browser tests. Cleanup succeeded. macOS is explicitly deferred from the required matrix because hosted execution is too slow; Apple Silicon awaits a self-hosted Mac. Neither macOS configuration is qualified. The existing macOS probe setup remains available for future investigation, but no macOS job is scheduled by the active CI matrix.

GitHub's [runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [container-job rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcontainer) and [nested-virtualization caveat](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) govern feasibility. [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions) permit developing/testing MageLens. Standard hosted compute for public repositories is free under [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions); storage remains subject to the account's allowance. [Limits](https://docs.github.com/en/actions/reference/limits) include six hours per hosted job and plan concurrency/storage limits. This configuration uses standard labels only, no schedules for E2E, short bounded artifacts and no paid storage/cache settings. It does not change billing, visibility or runner plans.

Dependabot checks GitHub Actions, npm and the PHP report Composer manifest weekly, with bounded open PR counts. Its npm proposals must keep `dependencies.yaml`, `package.json` and `package-lock.json` synchronized; existing dependency tests enforce this. Dependabot cannot update the custom `dependencies.yaml` format or Hyvä package manifest automatically. Review those pins against upstream security releases, then qualify updates in CI. Application Composer locks are generated inside isolated installations; installed `src/` locks are never committed by CI.

## Existing harness

The workflow reuses `tests/e2e-isolated.sh` unchanged in its acceptance behavior. `npm run test:e2e` is available for focused local investigation; the full `npm run test:e2e:matrix` belongs in CI unless explicitly requested locally. Magento uses `MAGELENS_COMPOSER_AUTH_FILE` or `MAGELENS_COMPOSER_AUTH_VOLUME`; Mage-OS never copies those credentials.

By default, the test installs Luma with Cypress using the versions in `dependencies.yaml`, runs the bundled browser suites, and verifies PHP, JavaScript, and template coverage reports. It also checks that reports belong to the current run, original source files are unchanged, and test data is cleaned up. The installer uses `--container-only` to generate HTTPS inside Docker; it does not edit host DNS or certificate trust.

Each invocation has its own Compose project, image tags, database, credentials, and source. Ports default to **18080**, **18443**, and **16080**. Override `MAGELENS_TEST_PORT`, `MAGELENS_TEST_HTTPS_PORT`, and `MAGELENS_TEST_VIEW_PORT` when those ports are occupied or when running tests concurrently.

Reports, screenshots, and logs are retained under `.runtime/e2e/<project>/`, including `coverage/index.html`. Containers, named volumes, and temporary source are removed on success, failure, or a handled interruption. A failed Docker cleanup retains the temporary workspace and reports its location. Built images and Docker build cache remain available for subsequent runs. Forced process termination may require manual cleanup of that test's project.

For focused local investigation, `MAGELENS_E2E_KEEP_ON_FAILURE=1` retains a failed test's workspace and running services. The failure output includes its location and Compose cleanup command; remove that temporary directory after stopping its services and volumes.

These E2E checks validate fresh installations. The integration suite also checks upgrades of existing installations and recovery of patches left by interrupted runs.

## Both platforms, all storefronts and runners

CI runs the matrix using the published dependency versions in `dependencies.yaml`, one isolated installation per job, and feeds all eight Linux reports to `tests/compare-matrix.cjs`.

The matrix creates **eight independent installations**: Magento Open Source and Mage-OS, each with Luma and Hyvä CSP, using Cypress and Playwright. Each uses `--project-name` and the published coverage packages from npm, then runs subsequent commands using the saved name. Checks verify the installed platform and pinned version, active theme, selected runner, absence of the other runner's packages and tooling, and coverage generation with `./bin/run-coverage`. Reports are saved at `.runtime/e2e/<project>/<runner>/coverage/index.html`; your existing application stays untouched. `coverage/installation.json` identifies each report's platform, version, theme and runner.

The matrix also runs `bash tests/project-isolation.sh`: two lightweight checkouts use distinct project names, domains and dynamically assigned ports. Stopping and removing one project's services and volumes must leave the other project's service and data available.

Every combination also checks the shared `./bin/runner` command, the read-only viewer over HTTPS, and browser/desktop recovery after graceful and forced container stops. Both runners execute headed in Docker; host browsers and a host graphical desktop are not required. To run just the restart checks against a built runner image, use `bash tests/runner-container.sh IMAGE`.

Both runners disable page-change animations during scenarios and fail on uncaught application errors.

Cypress installations also verify Node-side certificate and hostname validation, script injection into HTTPS `x-gzip` responses, and separate screenshot artifacts from two concurrent runs. Their logs and screenshots are retained in `coverage/cypress-runtime/`.

All eight combinations check input updates, loops, navigation, and form submissions against the installed platform. Coverage checks require executed PHP, JavaScript, and template lines, along with uncovered branches and unvisited templates. Hyvä checks also cover Alpine model updates, PHP-generated event names, conditional listeners, modifier-only form prevention and unclicked event handlers. CSP runs include the original vendor theme templates and require the gallery, price and cancellation-modal directives to have no unsupported-directive warnings. Each combination runs the same seven acceptance scenarios: five Blog scenarios covering publishing, moderation, image handling, validation, permissions, and storefront interaction, plus two coverage probes. Inline PHTML scripts must execute normally and appear only in template coverage, with called functions, unused functions and both branch outcomes reported. PHP-rendered child scripts must link to their original template and keep unused child functions and branches uncovered. Original source files and PHP line numbers must remain unchanged. Patch cleanup is checked against the original framework files on both platforms.

Hyvä tests use the installer-selected default theme, with package versions pinned in [hyva-packages.json](../docker/php/hyva-packages.json). Playwright tests include the elgentos guest fixture. CSP runs require an enforcing script policy and verify that unauthorized inline scripts and dynamic code are blocked. Licensed Hyvä Checkout and the full upstream elgentos checkout suite are outside this installation matrix.

The matrix also compares covered and uncovered lines in the shared Blog PHP and Admin JavaScript across all eight installations. Within each platform and theme, Cypress and Playwright must produce the same Blog PHP and JavaScript line coverage and template statement coverage. The comparison is saved to `.runtime/e2e/matrix-comparison.json`. Missing or duplicate combinations fail the comparison. Overall percentages can differ between Luma and Hyvä because their storefront implementations differ and inactive application files remain uncovered.

The CI case workflow selects `MAGELENS_E2E_PLATFORM=magento|mageos`, `MAGELENS_E2E_THEME=luma|hyva` and `MAGELENS_E2E_RUNNER=cypress|playwright`. Keep all required cases for final qualification; an individual case cannot satisfy the gate.

Omitting these settings selects Magento Open Source/Luma/Cypress. The full matrix always checks all eight combinations, regardless of individual selection settings.

## Test a local template coverage package

Test unpublished collector changes in a reviewed CI branch: pack the library in the runner workspace and pass `MAGELENS_TEMPLATE_COVERAGE_PACKAGE` to the existing harness. Record the tarball digest in the run evidence and do not replace the final published-pin qualification with an unpublished-package run. Local packing and focused browser debugging are permitted; the full matrix remains in CI.

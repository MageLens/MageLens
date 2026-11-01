<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Test your installation

Run the fast integration checks with `npm run test:integration`.

All E2E execution and debugging uses **GitHub Actions**. Do not run E2E locally unless the user explicitly requests it. This includes the isolated installation harness, matrix, project isolation, browser recovery and container acceptance scripts. Local syntax, PHP unit and Node integration checks remain available. For limited RAM, use `node --test --test-concurrency=2 tests/*.test.cjs` after `npm ci --ignore-scripts`.

## Run CI

[CI](https://github.com/MageLens/MageLens/actions/workflows/ci.yml) runs on pull requests, pushes to `main`, release tags and manual dispatch. The required matrix is:

| Host | Platform | Theme | Runner | Cases |
| --- | --- | --- | --- | --- |
| `ubuntu-latest` | Magento Open Source, Mage-OS | Luma, Hyvä CSP | Cypress, Playwright | 8 |
| `macos-latest` | Mage-OS | Hyvä CSP | Playwright | 1 |
| `windows-latest` | Mage-OS | Luma | Cypress | 1 |

The host probe records the actual runner image, architecture, Bash and Docker/Compose versions. It requires Linux containers, writable host mounts, symlinks, container DNS and a published port reachable from the host before installation. A failed probe leaves the required case incomplete; it never substitutes a Linux runner.

To qualify a reviewed branch, use **Actions → CI → Run workflow**, select the branch, or:

```bash
gh workflow run ci.yml --ref BRANCH
gh run list --workflow ci.yml --branch BRANCH
gh run view RUN_ID
gh run download RUN_ID --pattern 'case-*' --dir ci-artifacts
```

For inexpensive host diagnosis, dispatch with `-f feasibility-only=true`. This executes probes without installations and deliberately cannot pass the required gate. Leave the option off for final qualification.

Dispatch uses that branch's exact commit. New workflows must be registered with GitHub before manual dispatch is available; the initial PR run registers CI. Inspect the SHA before approving credential access. After changes, push and dispatch the new candidate. Use **Re-run all jobs** for final verification; the gate rejects evidence from an earlier attempt. A partial rerun is useful only for diagnosis.

Configure the branch protection/ruleset to require **Required CI gate**. Static syntax/workflow checks, integration/PHP unit checks, and copyright/license notices are separate jobs. The final gate requires all ten E2E cases, **70/70 shared acceptance scenarios**, completed cleanup and all reports, then runs the original eight-way Linux comparison. Failed, skipped, pending, canceled, missing and stale results prevent success. Same-repository PRs require environment approval of their exact merge candidate to run Magento; this lets the required gate qualify the same commit GitHub evaluates for merging. Fork PRs remain incomplete until their reviewed changes are placed on a repository branch. Manual dispatch also qualifies a reviewed branch head.

## Marketplace credentials

Create the GitHub environment `magento-e2e` with required reviewers and an environment secret **COMPOSER_AUTH** containing Marketplace `http-basic` credentials for `repo.magento.com`. Use a dedicated account/key with only the required package access. Restrict deployments to reviewed branches/tags, prevent self-review where feasible, and approve only after reviewing the exact candidate including workflow/script changes. Store no Marketplace secrets at repository scope. The job checks required-reviewer protection and copies only Marketplace auth to a temporary mode-0600 file; the harness copies it to its own temporary volume. Cleanup removes both.

Fork pull requests never run the credentialed job. Same-repository PRs run it only after the protected environment reviewer approves the exact merge candidate; merely being a repository contributor is not approval. Dependabot receives no Actions secrets and cannot complete Magento qualification without a separately reviewed maintainer branch. `pull_request_target` is not used. Public Mage-OS jobs do not receive Composer auth. Missing credentials or protection are incomplete coverage and block full qualification. The `public-e2e` environment must contain no secrets.

## Reports and debugging

Each `case-OS-PLATFORM-THEME-RUNNER-attempt-N` artifact contains `evidence.json` and sanitized `coverage/` JSON. Evidence records commit SHA, workflow run/attempt, OS image, architecture, memory, dependency pins, matrix case, step outcomes and test counts. Coverage includes the shared application counters needed for the original comparison. `qualification-N` contains `qualification.json` and, when all eight Linux reports exist, `linux-matrix-comparison.json`.

Uploads run even after failures. Only explicitly selected counters and structured diagnostics leave the runner. Raw HTML/source reports, fixture payloads, auth files, private packages, databases, certificates, screenshots and raw service/install logs are excluded. Inspect the failed Actions step for additional diagnostics; never upload the temporary checkout or all of `.runtime/`. Artifacts expire after **one day**; download the sanitized evidence promptly. Each case is limited to **5 MiB**. Artifact names include the run attempt; the gate and publisher select that exact attempt so a rerun cannot reuse an older report. No dependency, image or result caches are uploaded, and no test result is reused.

Every job runs one installation, with at most two public and two credentialed jobs in parallel. E2E jobs have a 150-minute timeout and a 130-minute harness limit, allowing time for cleanup and uploads. CI stores installations under `MAGELENS_TEST_TMPDIR` on disk, avoiding Ubuntu 26’s RAM-backed `/tmp`. Disposable hosted Linux jobs remove unused Android/.NET/GHC/CodeQL SDK directories before checking for 25 GiB free disk and 6 GiB RAM. Docker resources are never globally pruned. No local RAM or disk is consumed by installations. Cleanup addresses only the registered test project and volumes. Canceled/force-terminated jobs cannot qualify, and GitHub disposes of the hosted VM.

The automatic publisher runs after successful CI, downloads the exact qualification artifact, and verifies the release tag resolves to the qualified SHA before creating or updating release notes. Manual runs never publish. No release is published by this PR.

## Hosted runner feasibility and cost

[Initial probes](https://github.com/MageLens/MageLens/actions/runs/41295654114) ran on all three actual standard hosts. The [corrected Linux probe](https://github.com/MageLens/MageLens/actions/runs/41295761433) passed Docker/Compose, mounts, symlinks and networking. macOS 26 ARM64 reported 7 GiB RAM, no Docker, and `kern.hv_support=0`. Windows Server 2025 initially reported a Windows Docker engine. A subsequent actual-host probe successfully installed and booted Ubuntu 24.04 under WSL2. [The Windows feasibility run](https://github.com/MageLens/MageLens/actions/runs/41296912030) passed Docker/Compose, mounts, symlinks, DNS, Windows filesystem access and Windows-side loopback forwarding using that local WSL2 engine. Windows CI records this runtime and the actual Windows image identity. Its WSL disk is placed on the runner temporary drive, and disk checks account for the backing Windows filesystem. [Colima startup on the same macOS host](https://github.com/MageLens/MageLens/actions/runs/41296694640) also failed using the local Virtualization framework; startup evidence is retained in its case report. A subsequent [QEMU software-emulation probe](https://github.com/MageLens/MageLens/actions/runs/41301026656) passed Linux ARM64 Docker/Compose, writable mounts, symlinks, DNS and host networking on `macos-latest`. CI now uses that local QEMU VM with two CPUs, 5 GiB guest RAM and a 40 GiB guest disk, recording the runtime and VM tool versions. Software emulation is slower; a successful probe alone does not qualify the host. Both host cases remain required until their complete acceptance harness passes.

If software emulation cannot complete the full harness within the configured limits, an alternative standard macOS label needs an explicitly approved change to the host requirement and fresh feasibility testing. Self-hosted machines or larger runners would require a separate infrastructure decision; neither is enabled here. Remote Linux Docker would not prove these host cases. Software emulation is not assumed to fit the time/RAM budget.

GitHub's [runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [container-job rules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcontainer) and [nested-virtualization caveat](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) govern feasibility. [Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions) permit developing/testing MageLens. Standard hosted compute for public repositories is free under [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions); storage remains subject to the account's allowance. [Limits](https://docs.github.com/en/actions/reference/limits) include six hours per hosted job and plan concurrency/storage limits. This configuration uses standard labels only, no schedules for E2E, short bounded artifacts and no paid storage/cache settings. It does not change billing, visibility or runner plans.

Dependabot checks GitHub Actions, npm and the PHP report Composer manifest weekly, with bounded open PR counts. Its npm proposals must keep `dependencies.yaml`, `package.json` and `package-lock.json` synchronized; existing dependency tests enforce this. Dependabot cannot update the custom `dependencies.yaml` format or Hyvä package manifest automatically. Review those pins against upstream security releases, then qualify updates in CI. Application Composer locks are generated inside isolated installations; installed `src/` locks are never committed by CI.

## Existing harness

The workflow reuses `tests/e2e-isolated.sh` unchanged in its acceptance behavior. `npm run test:e2e` and `npm run test:e2e:matrix` remain available for CI or an explicitly requested local investigation. Magento uses `MAGELENS_COMPOSER_AUTH_FILE` or `MAGELENS_COMPOSER_AUTH_VOLUME`; Mage-OS never copies those credentials.

By default, the test installs Luma with Cypress using the versions in `dependencies.yaml`, runs the bundled browser suites, and verifies PHP, JavaScript, and template coverage reports. It also checks that reports belong to the current run, original source files are unchanged, and test data is cleaned up. The installer uses `--container-only` to generate HTTPS inside Docker; it does not edit host DNS or certificate trust.

Each invocation has its own Compose project, image tags, database, credentials, and source. Ports default to **18080**, **18443**, and **16080**. Override `MAGELENS_TEST_PORT`, `MAGELENS_TEST_HTTPS_PORT`, and `MAGELENS_TEST_VIEW_PORT` when those ports are occupied or when running tests concurrently.

Reports, screenshots, and logs are retained under `.runtime/e2e/<project>/`, including `coverage/index.html`. Containers, named volumes, and temporary source are removed on success, failure, or a handled interruption. A failed Docker cleanup retains the temporary workspace and reports its location. Built images and Docker build cache remain available for subsequent runs. Forced process termination may require manual cleanup of that test's project.

Only during an explicitly requested local investigation, `MAGELENS_E2E_KEEP_ON_FAILURE=1` retains a failed test's workspace and running services. The failure output includes its location and Compose cleanup command; remove that temporary directory after stopping its services and volumes.

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

Test unpublished collector changes in a reviewed CI branch: pack the library in the runner workspace and pass `MAGELENS_TEMPLATE_COVERAGE_PACKAGE` to the existing harness. Record the tarball digest in the run evidence and do not replace the final published-pin qualification with an unpublished-package run. Local packing is permitted; local E2E still requires an explicit user request.

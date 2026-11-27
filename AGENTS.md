<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Maintain MageLens

This guide is for contributors maintaining MageLens. The installable project is in [compose/](compose/); application development and LLM-to-TDD instructions live in [compose/AGENTS.md](compose/AGENTS.md).

Repository commands run from this directory. Run installation, application and coverage commands from `compose/`. Keep the standalone project usable after it is copied out of this repository: do not add dependencies on repository-level `tests/`, `.github/` or maintainer skills.

Follow the [engineering-discipline skill](.agents/skills/engineering-discipline/SKILL.md) for implementation, documentation updates, testing and releases.

## Copyright notices

For first-party files owned by Vitalii Boiko, use `Copyright (c)  MageLens` (two spaces before `MageLens`, no years). Keep the existing license identifier and license reference. Apply this format to newly created files and files whose contents are already being changed for the task; leave untouched legacy notices valid. Never modify a file solely to replace its notice or introduce unrelated edits to make it eligible. Preserve third-party copyright notices, contributor credits, author metadata and license text. This attribution wording does not change ownership or licensing terms.

`npm run check:copyright` accepts legacy notices in untouched files and requires the new format for added or content-modified first-party files, including their notice sidecars. Local checks inspect staged and working-tree changes to tracked files; add new files to Git before checking. PR checks compare the full candidate against the target branch's merge base. If change detection fails, restore the required Git history or base reference; never replace notices repository-wide to pass a check.

## Validate changes

CI exists to expose real gaps and problems in the user journey: installation, daily commands, storefront and Admin flows, coverage collection, and recovery. Investigate failures and fix their root causes in the product or test harness. Do not add CI-only workarounds that hide defects, bypass real user paths, weaken assertions or coverage, skip required cases, suppress application errors, or retry away functional failures. Runner setup and resource adaptations must preserve those journeys and acceptance checks. If a supported journey cannot run under the allowed infrastructure constraints, report incomplete coverage and the demonstrated blocker.

For host-side integration checks, install the locked dependencies with `npm ci --ignore-scripts`, then run `npm run test:integration`. Target an existing relevant test first; use the full integration suite for shared orchestration changes. PHP checks live in `tests/*.test.php`; inspect their prerequisites before selecting host or container execution. Use `bash -n`, `node --check` and `php -l` for changed scripts.

Run the full E2E matrix and release qualification in GitHub Actions. Focused local browser reproductions, development and debugging are allowed; use isolated resources, bound RAM/disk use and preserve existing applications. Do not run the full CI suite or E2E matrix locally unless explicitly requested. Static and unit/integration checks remain available locally; `npm run test:integration` limits concurrency to two workers to bound memory use.

The CI workflow checks seven Linux combinations and Mage-OS/Luma/Cypress on `windows-latest`, covering all eight platform, storefront and runner combinations once. Apple Silicon macOS supports all eight combinations, but macOS is not included in the automated release qualification matrix. Intel macOS is not supported. Actual host feasibility is required; a Linux job cannot stand in for Windows. The final `Required CI gate` requires all eight active cases, 64 acceptance scenarios, every report and the complete eight-way coverage comparison. Missing, skipped, canceled and incomplete required checks block qualification.

Compare complete coverage outcomes within each theme across platforms, browser runners and operating systems: Luma with Luma and Hyvä CSP with Hyvä CSP. Include every measured application, theme and vendor file, PHP lines, JavaScript statements/functions/branches, template execution, DOM observations, XML declaration outcomes, source fingerprints and measurement warnings. Equal headline percentages are insufficient. Normalize only host paths, line endings, ordering, run metadata and repeated-hit frequencies; covered/uncovered outcomes, inventories and totals must match. Investigate discrepancies rather than excluding files or allowing a tolerance. Inspect `compose/coverage/equivalence.json.gz` and `theme-report-comparison.json` alongside the complete eight-way comparison before declaring CI complete.

Local development and CI use the same runner Dockerfile and harness. Cypress 16.4.0 is rebuilt from its pinned upstream source with the cookie, document-initialization and response-timeout fixes in `compose/docker/runner/cypress-source/`; do not duplicate it in CI scripts or application code. Each Cypress case must pass the eleven runner regressions (nine cookie/authorization journeys, document initialization and a delayed-response check) and record matching source/patch provenance. Review the patch when updating Cypress; remove the source build after an upstream release passes the retained regressions. Existing installations must rerun installation with their saved selections to rebuild the runner.

CI runs on pull requests, including forks, against the exact merge candidate only when a maintainer applies the `run-ci` label. Remove and reapply the label to request a new run after changes. CI is optional for merging; release qualification remains mandatory for the final candidate. Merges and release tags do not rerun the matrix. Retrieve the `case-*-attempt-N` and `qualification-N` artifacts; see [tests/README.md](tests/README.md) for setup and diagnostics.

Fix failures, push a new candidate and request CI again. Rerun all jobs on the final candidate: artifacts from different attempts cannot be combined. The manually dispatched release publisher consumes the successful PR qualification and requires the release commit to have the same Git tree as the tested candidate. Identical files after merging do not require another CI run; changed files require a new qualified PR. Do not merge or publish unless requested.

## Preserve application data and report integrity

- Keep original source bytes and PHP line numbers unchanged during coverage. Instrument disposable copies and retain source-hash and symlink checks.
- Keep warm-up separate from collection. Fresh run IDs and zero-hit baselines must exclude stale and warm-up execution.
- Preserve fixture, collection and compatibility-patch cleanup after failures or interruptions on both platforms.
- Retain checks for matching run IDs, unchanged source and all tests passing before reports and badges are published. Skipped or pending tests are not a successful run.
- Keep every value in the opt-in coverage database equal to what the corresponding report shows: totals, percentages with the report's own rounding, module names as registered in `etc/module.xml`, and collector status. Mark data that was not observed, such as a template inventory without observation records, instead of reporting it as uncovered, and carry measurement warnings into the manifest. Retain the check that compares the database with the reports before publication.
- Never print or commit Composer auth, `.env`, installed `env.php`, certificates or credential volumes. Do not prune unrelated Docker resources or remove an existing application's volumes.
- Preserve dependency pins and lockfiles together. Do not publish a release unless requested.
- Exclude generated runtime files, coverage reports and incidental badge changes from unrelated work. Report which validation actually passed and any checks blocked by unavailable services, images, repositories or credentials.

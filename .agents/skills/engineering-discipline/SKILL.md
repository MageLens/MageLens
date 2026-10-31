---
name: engineering-discipline
description: "Apply focused changes, consistent behavior across entry points, minimal user-facing documentation, and a mandatory E2E release gate when implementing, documenting, testing, or releasing software."
---
<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->


# Engineering Discipline

## Everyday implementation

- Read applicable project instructions and inspect existing code, documentation, and test commands before editing. Keep changes within the requested scope; avoid unrelated refactoring.
- Apply the Principle of Least Astonishment: preserve established conventions, architecture, and backward compatibility unless the requested change requires otherwise. Prefer simple, deterministic, maintainable solutions.
- Before changing shared behavior, identify every affected route, entry point, interface, and workflow. Equivalent actions under equivalent conditions must produce consistent results, validation, and errors.
- Reuse existing components, business logic, validation, and error handling. Update shared implementations instead of creating competing paths.
- Add or update automated regression tests for behavior changes, including equivalent entry points and existing workflows. Run relevant checks during development and any broader checks required by the project; inspect the final diff for unintended changes.
- Investigate failures and fix their root causes. Never ignore, skip, suppress, delete, or weaken failing tests to manufacture a passing result.

## User-facing documentation

- Make only targeted edits needed for user-visible changes. Preserve existing structure, style, terminology, and tone; avoid wholesale rewrites, unnecessary sections, and repeated explanations.
- Focus on installation, configuration, features, and practical usage. Keep internal reasoning, implementation nuances, debugging history, and task execution details in engineering reports, outside user-facing documentation.
- Ensure installation commands target the latest published release. Verify it through the project's authoritative release source; use a supported latest-release URL where available, otherwise the verified current version. Do not guess or advertise an unpublished candidate. This rule does not authorize unrelated dependency or lockfile upgrades.

## Mandatory gate before every release

1. Identify the complete E2E suite and required configuration matrix from project instructions, scripts, and CI configuration. A filtered subset or single matrix entry does not satisfy this gate.
2. Execute the entire suite against the final release candidate and wait for every job to finish. Also complete all other project-required release checks. Verify exit statuses and reports; confirm expected tests actually ran and all passed.
3. Block release and any claim of readiness if tests fail, are skipped or pending, are interrupted, or cannot run. Missing suites, credentials, services, or evidence of completion are blockers, not assumed successes.
4. Fix root causes, then rerun the complete E2E suite. Changes to the candidate or its test setup after verification require a fresh full run. Do not bypass failures with selective retries or reduced coverage.
5. Proceed only after the gate passes and release publication is authorized by the user. This skill itself does not authorize publishing.

## Verification report

Report the commands or CI runs actually executed, their scope, and verified results. Explicitly list checks not performed or incomplete and why. Never claim tests passed without inspecting their results; if release verification is incomplete, state that release is blocked.

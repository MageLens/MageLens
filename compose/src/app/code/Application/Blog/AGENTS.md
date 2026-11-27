<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Demonstration Blog module

This supplements the project [AGENTS.md](../../../../../AGENTS.md). Paths below are relative to this module unless stated otherwise.

`Application_Blog` is the bundled example for trying PHP, JavaScript, template and XML configuration coverage on Magento Open Source or Mage-OS. Read [README.md](README.md) for behavior and scenarios.

From the installed project root, use `./install.sh --mageos` for Mage-OS. Add `--hyva` for Hyvä CSP, and add `--playwright` for Playwright. Omit `--mageos` for Magento Open Source. Run `./bin/run-coverage` to execute the demo scenarios and open `coverage/index.html` afterward. Repeat the same platform, theme and runner flags when reinstalling.

## Navigation and contracts

- `Model/` and `ViewModel/Blog.php`: data access, publication visibility, validation and presentation data.
- `Controller/Index/`, `Controller/Post/`: storefront routes; `Controller/Adminhtml/Manage/` and `Block/Adminhtml/Manage.php`: Admin operations.
- `etc/db_schema.xml`, `etc/acl.xml`, route/menu XML and `Setup/Patch/Data/InitialArticles.php`: schema, authorization and initial demo content.
- `view/frontend/`: Luma Knockout/Underscore and Hyvä Alpine implementations; `view/adminhtml/`: Admin forms, preview and scripts.
- `Test/Cypress/` and `Test/Playwright/`: equivalent acceptance scenarios.
- `Test/MageLens/hooks.php`: before/prepare/cleanup fixture lifecycle.

Keep Admin ACL, secret keys, form-key checks and POST-only mutations intact. Preserve plain-text escaping, publication/visibility rules, pending comment moderation, image validation and owned-file cleanup. Do not reset ordinary editorial content to make a fixture pass.

Maintain behavior on both platforms across Luma and Hyvä CSP, and keep both browser suites equivalent. Coverage must include unused functions/branches rather than forcing every example to appear covered.

Fixture preparation returns one JSON value on stdout; send diagnostics to stderr. Cleanup must be repeatable and remove only this run's owned posts, images, categories, comments, user and role. Preserve recovery metadata for interrupted runs.

## Validation

Run the relevant application scenarios from the installed project root with `./bin/run-coverage`. Inspect the reports and retain source-preservation and fixture-cleanup checks. There is no standalone Composer or npm test package inside this module.

Edit tracked files here, never their `.runtime/app/` copies. Module/schema/theme installation changes need the normal installer with the same profile flags; use isolated E2E installations to avoid mutating an existing project's database. Source-only coverage runs must still preserve original bytes and PHP line numbers.

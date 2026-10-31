<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Cypress-only Magento patches

The bundled blog demo temporarily applies one compatibility fix while Cypress runs:

- [Session handling](magento-framework-session-cookie-race-41057.patch) prevents intermittent session loss during login and form submissions. See [Magento issue #41057](https://github.com/magento/magento2/issues/41057).

The session patch targets **Magento 2.4.8-p5** and **Mage-OS 2.3.0**. It is applied and reverted automatically, including after failed tests. No manual setup is needed. If a patch does not match your installed platform version, the run stops; review compatibility before retrying.

Template coverage **1.1.2** fixes DOM observation in the application window, preserving Magento Admin's Prototype extensions. The former [Admin form workaround](retired/magento-admin-form-prototype.patch) is now retired and is never applied. Before applying or reverting active patches, the script restores it if an older interrupted run left it applied. Conflicting local edits stop recovery for review.

After updating from an older release, rerun `./install.sh` with your platform, theme and runner flags to install the new collector and refresh published assets, then run `./bin/run-coverage`.

`./bin/run-coverage` applies the patches before its automatic storefront homepage warm-up, after instrumentation and fixture preparation. Coverage starts afterward in a fresh browser with the existing test timeouts. A warm-up failure also reverts the patches. See [the run lifecycle](../../docs/coverage.md#run-lifecycle) for limits and diagnostics.

After a forcibly interrupted run, rerun `./bin/run-coverage` to recover automatically, or restore the Magento files without running tests:

```bash
./bin/application-compose run --rm --no-deps phpfpm bash /application/docker/php/cypress-patches.sh revert
```

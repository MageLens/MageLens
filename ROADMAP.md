<!--
SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Platform roadmap

Official host support covers Linux and Windows via WSL2. MageLens may also work on macOS with Docker configured for Linux containers. macOS is experimental.

| Host | Official support and CI coverage | Next milestone |
| --- | --- | --- |
| Linux | All eight combinations of Magento Open Source or Mage-OS, Luma or Hyvä CSP, and Cypress or Playwright | Maintain release coverage across all eight combinations. |
| Windows via WSL2 | Mage-OS, Luma, and Cypress on Ubuntu 24.04 under WSL2 | Extend Windows CI to the remaining platform, storefront, and runner combinations. |
| macOS | Experimental on Intel and Apple Silicon. Hosted CI qualification is deferred. | Complete the install and coverage workflow on a suitable macOS runner. |

See the [Windows quick start](README.md#quick-start), the [passing Windows job for MageLens 1.7.0](https://github.com/MageLens/MageLens/actions/runs/41421565922/job/125198074355), and the [current CI matrix](tests/README.md#run-ci).

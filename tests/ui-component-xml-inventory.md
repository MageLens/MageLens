<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Standalone Admin UI component XML

The disposable `MageLens_UiProbe` and `MageLens_UiProbeOverlay` modules provide a native Admin listing and form. The native proof compares the response data and provider calls with collection off and on. It also verifies the source lines of an untouched column, an equal-valued module overlay, a PHP metadata replacement, a disabled child, and an unopened instance. It checks a same-run cache repeat from a separate PHP process and a cache entry populated before collection.

The collector uses Magento’s ordered file inputs and native converter output to identify explicit named components, field and column labels, and literal data-provider classes. Default component definitions participate in configuration and creation. Effect ownership stays with the original instance declaration. Provider execution is measured when the corresponding native listing or form reads data through the configured provider. Delivery requires the native component configuration to reach the response body. Collection does not record form or grid values.

This family currently measures Admin listing and form instances. Extended instances, custom PHP component classes, UI definitions and definition maps, legacy label arguments that compete with a settings label, nested data sources, dynamic provider bindings, standalone child types outside fields, columns, buttons and data sources, individual option values and layout placement use separate evidence or have unmeasured ownership. Data providers invoked directly outside the native listing or form data path provide no evidence for the XML binding.

## Browser effects

The Cypress and Playwright journeys use the same native Admin listing and form with collection off and on. They verify sorted AJAX rows, server delivery, the original registry instance, rendered Knockout bindings, and the effect of the configured Reset button. A client-disabled button is delivered without construction. Another button renders without an invocation. The browser adapter reads only inventoried component names and opaque response IDs. Magento's native response data and form values stay in the application.

The disposable developer-mode install publishes native Admin static assets before both browser phases. The collected phase publishes from the instrumented source. This keeps lazy static generation out of the grid's native RequireJS initialization on the single FPM worker.

Browser evidence covers standard registry instances, Knockout-bound field elements, button elements and table cells, native button action dispatch, and successful native grid reloads with an HTTP response. Custom renderers and button dispatch methods, browser cache-only data reloads, and post-delivery reassignment of individual properties have unmeasured browser effects.

The focused Mage-OS 4.0.0 Luma proof passed in Playwright 1.65.0 and Cypress 16.3.0 with Chrome for Testing 157.0.8103.78. The native and collected runs in both browsers produced the same grid and form behavior. Each merged report linked every asserted browser effect to the corresponding PHP response. Cypress used the repository-pinned source and patch.

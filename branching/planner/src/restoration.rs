// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{contains, text};
use tree_sitter::Node;

// URL and storage reconstruction does not restore page/context configuration,
// input-device state, routes, clocks or browser-side subscriptions. Keep this
// capability check independent of duration measurement and lexical portability.
pub fn supported(node: Node, source: &str) -> bool {
    !contains(node, &|child| {
        matches!(child.kind(), "property_identifier" | "string")
            && matches!(text(child, source).trim_matches(['\'', '"']),
                "setViewportSize" | "emulateMedia" | "setExtraHTTPHeaders"
                | "setDefaultTimeout" | "setDefaultNavigationTimeout"
                | "context" | "browser" | "keyboard" | "mouse" | "touchscreen" | "clock"
                | "addInitScript" | "exposeFunction" | "exposeBinding"
                | "route" | "routeFromHAR" | "routeWebSocket" | "unroute" | "unrouteAll"
                | "on" | "once" | "addListener" | "removeListener" | "removeAllListeners")
    })
}

// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use super::*;
use std::collections::BTreeSet;

pub(super) fn binding(n: Node, s: &str, out: &mut BTreeSet<String>) {
    if matches!(
        n.kind(),
        "identifier" | "type_identifier" | "shorthand_property_identifier_pattern"
    ) {
        out.insert(text(n, s).into());
        return;
    }
    match n.kind() {
        "pair_pattern" => {
            if let Some(n) = field(n, "value") {
                binding(n, s, out);
            }
        }
        "assignment_pattern" | "object_assignment_pattern" => {
            if let Some(n) = field(n, "left") {
                binding(n, s, out);
            }
        }
        "required_parameter" | "optional_parameter" => {
            if let Some(n) = field(n, "pattern").or_else(|| field(n, "name")) {
                binding(n, s, out);
            }
        }
        "type_annotation" => {}
        _ => {
            for child in children(n) {
                binding(child, s, out);
            }
        }
    }
}

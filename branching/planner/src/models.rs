// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::{
    Result, field, hash,
    points::{self, Estimate},
    project::Module,
    text,
};
use serde::Deserialize;
use std::{collections::BTreeMap, fs, path::Path};

pub const FILE: &str = "magelens.estimation.json";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Configuration {
    version: u32,
    calls: Vec<CallModel>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallModel {
    file: String,
    source_sha256: String,
    line: usize,
    column: usize,
    callee: String,
    operations: BTreeMap<String, u64>,
    pub returns: ReturnValue,
    explanation: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReturnValue {
    Data,
    Text,
    Undefined,
}
pub type Models = BTreeMap<(String, usize, usize), CallModel>;

impl CallModel {
    pub fn estimate(&self) -> Estimate {
        let mut estimate = Estimate::default();
        for (name, count) in &self.operations {
            let weight = weight(name).expect("validated model operation");
            let points = weight * count;
            estimate.add(Estimate {
                points,
                estimated_points: points,
                lower_bound_points: points,
                upper_bound_points: Some(points),
                operations: BTreeMap::from([(name.clone(), *count)]),
                estimated_operations: BTreeMap::from([(name.clone(), *count as f64)]),
                ..Estimate::default()
            });
        }
        // Contracts describe expected work, not proved runtime bounds. Never
        // treat their contribution as an exact lower bound or a safety proof.
        estimate.lower_bound_points = 0;
        estimate.upper_bound_points = None;
        estimate.complete = false;
        estimate.assumptions.push(format!(
            "Project call model {}:{}:{}: {}",
            self.file, self.line, self.column, self.explanation
        ));
        estimate
    }
}
fn weight(name: &str) -> Option<u64> {
    Some(match name {
        "navigation" => points::NAVIGATION,
        "interaction" => points::INTERACTION,
        "assertion" => points::ASSERTION,
        "request" => points::REQUEST,
        "wait" => points::WAIT,
        "localIo" => points::LOCAL_IO,
        _ => return None,
    })
}
pub fn load(
    root: &Path,
    modules: &BTreeMap<String, Module>,
    sources: &[crate::Source],
) -> Result<Models> {
    let bytes = match fs::read(root.join(FILE)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(format!("{FILE}: {error}")),
    };
    if !sources
        .iter()
        .any(|source| source.path == FILE && source.sha256 == hash(&bytes))
    {
        return Err(format!("{FILE}: configuration changed while planning"));
    }
    let config: Configuration =
        serde_json::from_slice(&bytes).map_err(|e| format!("{FILE}: {e}"))?;
    if config.version != 1 || config.calls.is_empty() || config.calls.len() > points::NODE_LIMIT {
        return Err(format!(
            "{FILE}: expected version 1 and a nonempty, bounded calls list"
        ));
    }
    let mut models = Models::new();
    for model in config.calls {
        let label = format!("{FILE}: {}:{}:{}", model.file, model.line, model.column);
        let module = modules
            .get(&model.file)
            .ok_or_else(|| format!("{label}: model source is not a scanned module"))?;
        if model.source_sha256 != hash(&module.source) {
            return Err(format!(
                "{label}: stale sourceSha256; review the model against the changed source"
            ));
        }
        if model.explanation.trim().is_empty()
            || model.explanation.len() > 4096
            || model.callee.is_empty()
        {
            return Err(format!("{label}: callee and explanation are required"));
        }
        let mut total = 0u64;
        for (name, count) in &model.operations {
            let weight =
                weight(name).ok_or_else(|| format!("{label}: unknown operation {name}"))?;
            if *count > 1_000_000 {
                return Err(format!("{label}: operation count exceeds 1000000"));
            }
            total = total
                .checked_add(
                    count
                        .checked_mul(weight)
                        .ok_or_else(|| format!("{label}: cost overflow"))?,
                )
                .ok_or_else(|| format!("{label}: cost overflow"))?;
        }
        if model.operations.is_empty() {
            return Err(format!(
                "{label}: supply explicit operation counts (zero is allowed for pure work)"
            ));
        }
        let point = tree_sitter::Point {
            row: model
                .line
                .checked_sub(1)
                .ok_or_else(|| format!("{label}: line must be one-based"))?,
            column: model
                .column
                .checked_sub(1)
                .ok_or_else(|| format!("{label}: column must be one-based"))?,
        };
        let mut node = module
            .tree
            .root_node()
            .named_descendant_for_point_range(point, point);
        let mut target = None;
        while let Some(current) = node {
            if current.start_position() != point {
                break;
            }
            if current.kind() == "call_expression"
                && field(current, "function")
                    .is_some_and(|n| text(n, &module.source) == model.callee)
            {
                target = Some((current.start_byte(), current.end_byte()));
                break;
            }
            node = current.parent();
        }
        let (start, end) =
            target.ok_or_else(|| format!("{label}: no call at this location matches callee"))?;
        if models
            .insert((model.file.clone(), start, end), model)
            .is_some()
        {
            return Err(format!("{label}: duplicate call model"));
        }
    }
    Ok(models)
}

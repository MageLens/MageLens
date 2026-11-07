// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use crate::baseline::{Baseline, PLAYWRIGHT_P0};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stage {
    pub id: String,
    pub parent: Option<String>,
    pub checkpoint: bool,
    pub units: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub stages: Vec<Stage>,
    pub parents: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub stage: String,
    pub selected: bool,
    pub reason: String,
    pub consumers: usize,
    pub combined_units: Option<u64>,
    pub estimated_prefix_ms: Option<f64>,
    pub break_even_prefix_ms: Option<f64>,
    pub minimum_combined_units: Option<u64>,
    pub standalone_saving_ms: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub schema_version: u32,
    pub basis: &'static str,
    pub baseline: Baseline,
    pub selected: Vec<String>,
    pub reason: String,
    pub estimated_linear_setup_ms: Option<f64>,
    pub estimated_planned_setup_ms: Option<f64>,
    pub estimated_saving_ms: f64,
    pub decisions: Vec<Decision>,
    pub search_iterations: usize,
    pub max_checkpoints_per_test: usize,
}

// One versioned constant shared with the execution guard. Compiled into Rust;
// no runtime calibration or per-run override.
pub fn checkpoint_limit() -> usize {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Limits {
        max_checkpoints_per_test: usize,
    }
    serde_json::from_str::<Limits>(include_str!("limits.json"))
        .expect("valid checkpoint limit")
        .max_checkpoints_per_test
}

pub fn select(input: Input) -> Result<Plan, String> {
    select_with(input, PLAYWRIGHT_P0)
}
fn select_with(input: Input, baseline: Baseline) -> Result<Plan, String> {
    if input.stages.is_empty() || input.parents.is_empty() {
        return Err("Empty cost graph".into());
    }
    let mut indices = BTreeMap::new();
    for (i, s) in input.stages.iter().enumerate() {
        if indices.insert(s.id.as_str(), i).is_some() {
            return Err("Duplicate cost stage".into());
        }
    }
    let chain = |id: &str| -> Result<Vec<usize>, String> {
        let mut result = vec![];
        let mut current = Some(id);
        while let Some(id) = current {
            let i = *indices.get(id).ok_or("Unknown cost parent")?;
            if result.contains(&i) {
                return Err("Cost graph cycle".into());
            }
            result.push(i);
            current = input.stages[i].parent.as_deref();
        }
        result.reverse();
        Ok(result)
    };
    let all_chains = input
        .stages
        .iter()
        .map(|s| chain(&s.id))
        .collect::<Result<Vec<_>, _>>()?;
    let paths = input
        .parents
        .iter()
        .map(|s| chain(s))
        .collect::<Result<Vec<_>, _>>()?;
    let units = all_chains
        .iter()
        .map(|path| {
            let mut total = Some(0u64);
            for &i in path {
                total = match (total, input.stages[i].units) {
                    (Some(a), Some(b)) => Some(a.checked_add(b).ok_or("Action unit overflow")?),
                    _ => None,
                };
            }
            Ok(total)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut consumers = vec![0usize; input.stages.len()];
    for path in &paths {
        for i in path {
            consumers[*i] += 1;
        }
    }
    let eligible: Vec<usize> = input
        .stages
        .iter()
        .enumerate()
        .filter(|(i, s)| s.checkpoint && consumers[*i] > 1 && units[*i].is_some())
        .map(|(i, _)| i)
        .collect();
    let margin = 1.0 + baseline.overhead_margin;
    let limit = checkpoint_limit();
    let within_limit = |chosen: &BTreeSet<usize>| {
        paths
            .iter()
            .all(|path| path.iter().filter(|i| chosen.contains(i)).count() <= limit)
    };
    // Ordered traversal matches P0: continue the first branch, restore the
    // deepest available ancestor later, pay capture and last-consumer release
    // once. Nested checkpoints cannot claim the same saved prefix twice.
    // Unknown stage costs cancel out: no selected checkpoint can skip them.
    let simulate = |chosen: &BTreeSet<usize>| -> f64 {
        let mut available = BTreeSet::new();
        let mut total = 0.0;
        for path in &paths {
            let last = path.iter().rposition(|i| available.contains(i));
            total += if last.is_some() {
                baseline.restore_ms * margin
            } else {
                baseline.reset_ms
            };
            for &i in &path[last.map(|p| p + 1).unwrap_or(0)..] {
                total += input.stages[i].units.unwrap_or(0) as f64 * baseline.unit_ms;
                if chosen.contains(&i) && available.insert(i) {
                    total += (baseline.capture_ms + baseline.release_ms) * margin;
                }
            }
        }
        total
    };
    let linear = simulate(&BTreeSet::new());
    let mut selected = BTreeSet::new();
    let mut best = linear;
    let mut iterations = 0;
    // Bounded best-improvement search, starting from linear. This may miss
    // opportunities but never adds an estimated net loss. No runtime samples.
    for _ in 0..64 {
        let mut improvement = None;
        let mut next_best = best;
        for &i in &eligible {
            let mut candidate = selected.clone();
            if !candidate.remove(&i) {
                candidate.insert(i);
            }
            // Once a path is full, try replacing a lower-value checkpoint.
            // Never drop actions: rejected boundaries remain ordinary stages.
            let alternatives = if within_limit(&candidate) {
                vec![candidate]
            } else {
                selected
                    .iter()
                    .filter_map(|old| {
                        let mut swapped = candidate.clone();
                        swapped.remove(old);
                        within_limit(&swapped).then_some(swapped)
                    })
                    .collect()
            };
            for candidate in alternatives {
                let cost = simulate(&candidate);
                if next_best - cost > baseline.min_saving_ms {
                    next_best = cost;
                    improvement = Some(candidate);
                }
            }
        }
        match improvement {
            Some(set) => {
                selected = set;
                best = next_best;
                iterations += 1;
            }
            None => break,
        }
    }
    let decisions = input
        .stages
        .iter()
        .enumerate()
        .filter(|(_, s)| s.checkpoint)
        .map(|(i, s)| {
            let count = consumers[i];
            let known = units[i].is_some() && count > 1;
            let threshold = known.then(|| {
                baseline.restore_ms * margin - baseline.reset_ms
                    + ((baseline.capture_ms + baseline.release_ms) * margin
                        + baseline.min_saving_ms)
                        / (count - 1) as f64
            });
            let saving = known.then(|| linear - simulate(&BTreeSet::from([i])));
            let chosen = selected.contains(&i);
            Decision {
                stage: s.id.clone(),
                selected: chosen,
                reason: if count < 2 {
                    "single-consumer"
                } else if !known {
                    "unknown-units"
                } else if chosen {
                    "static-estimated-saving"
                } else if saving.unwrap_or(0.0) <= baseline.min_saving_ms {
                    "below-break-even"
                } else if !within_limit(&selected.iter().copied().chain([i]).collect()) {
                    "checkpoint-limit"
                } else {
                    "overlaps-better-plan"
                }
                .into(),
                consumers: count,
                combined_units: units[i],
                estimated_prefix_ms: units[i].map(|u| u as f64 * baseline.unit_ms),
                break_even_prefix_ms: threshold,
                minimum_combined_units: threshold.map(|ms| {
                    if ms < 0.0 {
                        0
                    } else {
                        (ms / baseline.unit_ms).floor() as u64 + 1
                    }
                }),
                standalone_saving_ms: saving,
            }
        })
        .collect();
    let complete = paths.iter().all(|p| units[*p.last().unwrap()].is_some());
    Ok(Plan {
        schema_version: 1,
        basis: "static-benchmark-estimate",
        baseline,
        selected: selected
            .iter()
            .map(|i| input.stages[*i].id.clone())
            .collect(),
        reason: if !selected.is_empty() {
            "static-estimated-saving"
        } else if !complete {
            "unknown-units"
        } else {
            "linear-estimated-cheaper"
        }
        .into(),
        estimated_linear_setup_ms: complete.then_some(linear),
        estimated_planned_setup_ms: complete.then_some(best),
        estimated_saving_ms: linear - best,
        decisions,
        search_iterations: iterations,
        max_checkpoints_per_test: limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stage(id: &str, parent: Option<&str>, units: u64, checkpoint: bool) -> Stage {
        Stage {
            id: id.into(),
            parent: parent.map(String::from),
            checkpoint,
            units: Some(units),
        }
    }
    fn input(stages: Vec<Stage>, parents: &[&str]) -> Input {
        Input {
            stages,
            parents: parents.iter().map(|s| s.to_string()).collect(),
        }
    }
    #[test]
    fn cheap_repetition_stays_linear() {
        let p = select(input(vec![stage("small", None, 4, true)], &["small"; 3])).unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions[0].reason, "below-break-even");
        assert_eq!(p.basis, "static-benchmark-estimate");
    }
    #[test]
    fn small_fixture_and_later_steps_are_a_combined_unit() {
        let p = select(input(
            vec![
                stage("fixture", None, 1, true),
                stage("checkout", Some("fixture"), 150, true),
            ],
            &["fixture", "checkout", "checkout"],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["checkout"]);
        assert_eq!(p.decisions[1].combined_units, Some(151));
    }
    #[test]
    fn two_small_parts_can_cross_the_combined_threshold() {
        let p = select(input(
            vec![
                stage("fixture", None, 60, false),
                stage("step", Some("fixture"), 60, true),
            ],
            &["step"; 3],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["step"]);
        assert!(p.decisions[0].minimum_combined_units.unwrap() > 60);
        assert!(p.decisions[0].minimum_combined_units.unwrap() < 120);
    }
    #[test]
    fn fanout_changes_break_even_and_boundary_is_strict() {
        for (consumers, minimum) in [(2, 119), (3, 103), (9, 91)] {
            let parents = vec!["unit"; consumers];
            let low = select(input(
                vec![stage("unit", None, minimum - 1, true)],
                &parents,
            ))
            .unwrap();
            let high = select(input(vec![stage("unit", None, minimum, true)], &parents)).unwrap();
            assert!(low.selected.is_empty());
            assert_eq!(high.selected, vec!["unit"]);
            assert_eq!(high.decisions[0].minimum_combined_units, Some(minimum));
        }
    }
    #[test]
    fn nested_snapshots_do_not_double_count_parent_work() {
        let p = select(input(
            vec![
                stage("parent", None, 150, true),
                stage("child", Some("parent"), 1, true),
            ],
            &["child"; 3],
        ))
        .unwrap();
        assert_eq!(p.selected.len(), 1);
        assert!(p.estimated_planned_setup_ms.unwrap() < p.estimated_linear_setup_ms.unwrap());
    }
    #[test]
    fn unknown_fixture_is_not_treated_as_free_and_candidate_is_retained() {
        let mut root = stage("fixture", None, 1, false);
        root.units = None;
        let p = select(input(
            vec![root, stage("child", Some("fixture"), 1000, true)],
            &["child"; 2],
        ))
        .unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions.len(), 1);
        assert_eq!(p.decisions[0].reason, "unknown-units");
        assert!(p.estimated_linear_setup_ms.is_none());
    }
    #[test]
    fn unknown_subtree_does_not_block_known_sibling_or_common_ancestor() {
        let mut unknown = stage("unknown", Some("root"), 1, true);
        unknown.units = None;
        let p = select(input(
            vec![
                stage("root", None, 200, true),
                unknown,
                stage("known", None, 200, true),
            ],
            &["unknown", "unknown", "known", "known"],
        ))
        .unwrap();
        assert_eq!(p.selected, vec!["root", "known"]);
        assert!(p.estimated_linear_setup_ms.is_none());
    }
    #[test]
    fn single_consumer_never_snapshots() {
        let p = select(input(vec![stage("a", None, 1000, true)], &["a"])).unwrap();
        assert!(p.selected.is_empty());
        assert_eq!(p.decisions[0].reason, "single-consumer");
    }
    #[test]
    fn malformed_graph_or_overflow_is_rejected() {
        assert!(select(input(vec![stage("a", Some("a"), 1, true)], &["a"])).is_err());
        assert!(select(input(vec![stage("a", None, 1, true)], &["missing"])).is_err());
        assert!(
            select(input(
                vec![stage("a", None, 1, true), stage("a", None, 1, true)],
                &["a"]
            ))
            .is_err()
        );
        assert!(
            select(input(
                vec![
                    stage("a", None, u64::MAX, true),
                    stage("b", Some("a"), 1, true)
                ],
                &["b"]
            ))
            .is_err()
        );
    }
    #[test]
    fn runtime_measurements_and_policy_overrides_are_not_inputs() {
        assert!(serde_json::from_str::<Input>(r#"{"stages":[],"parents":[],"unitMs":1}"#).is_err());
    }

    #[test]
    fn limits_each_path_and_keeps_more_valuable_boundaries() {
        let stages: Vec<_> = (0..12)
            .map(|i| {
                stage(
                    &format!("s{i:02}"),
                    (i > 0).then(|| format!("s{:02}", i - 1)).as_deref(),
                    if i == 0 {
                        120
                    } else if i == 11 {
                        10000
                    } else {
                        1000
                    },
                    true,
                )
            })
            .collect();
        // A real branch at every boundary; nine is a path limit, not a total.
        let parents: Vec<_> = (0..12)
            .flat_map(|i| [format!("s{i:02}"), format!("s{i:02}")])
            .collect();
        let p = select(Input { stages, parents }).unwrap();
        assert_eq!(p.max_checkpoints_per_test, 9);
        assert_eq!(p.selected.len(), 9);
        assert!(p.selected.contains(&"s11".into()));
        assert!(!p.selected.contains(&"s00".into()));
        assert!(p.decisions.iter().any(|d| d.reason == "checkpoint-limit"));
        assert!(p.estimated_saving_ms > 0.0);
    }

    #[test]
    fn independent_paths_have_separate_budgets_and_small_prefixes_still_stay_linear() {
        let stages: Vec<_> = (0..12)
            .map(|i| stage(&format!("root{i}"), None, 1000, true))
            .collect();
        let parents = stages
            .iter()
            .flat_map(|s| [s.id.clone(), s.id.clone()])
            .collect();
        let p = select(Input { stages, parents }).unwrap();
        assert_eq!(p.selected.len(), 12);
        let stages: Vec<_> = (0..12)
            .map(|i| {
                stage(
                    &format!("s{i}"),
                    (i > 0).then(|| format!("s{}", i - 1)).as_deref(),
                    1,
                    true,
                )
            })
            .collect();
        assert!(
            select(Input {
                stages,
                parents: vec!["s11".into(); 3]
            })
            .unwrap()
            .selected
            .is_empty()
        );
    }
}

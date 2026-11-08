// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

use magelens_plan::{Manifest, estimation, plan, write_json, write_manifest};
use std::{env, fs, path::Path, time::Instant};
fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("cost-plan") if args.len()==1 => {
            let input=serde_json::from_reader(std::io::stdin()).map_err(|e|e.to_string())?;
            let plan=magelens_plan::cost::select(input)?;
            println!("{}",serde_json::to_string(&plan).map_err(|e|e.to_string())?);
        },
        Some("plan") if args.len()==3 => {
            let start=Instant::now();
            let output=Path::new(&args[2]);
            // Validate the destination before either a plan or its error record is written.
            let parent=output.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));
            fs::create_dir_all(parent).map_err(|e|e.to_string())?;
            let parent=fs::canonicalize(parent).map_err(|e|e.to_string())?;
            let root=fs::canonicalize(&args[1]).map_err(|e|e.to_string())?;
            if parent.starts_with(&root) && !parent.strip_prefix(&root).unwrap().components().any(|c|c.as_os_str().to_string_lossy().starts_with('.')) {
                return Err("Write the manifest outside the source root or inside an ignored dot directory".into());
            }
            let manifest=record_result(output, plan(&root).and_then(|manifest| {
                write_manifest(output,&manifest)?;
                Ok(manifest)
            }))?;
            println!("{} tests, {} repeated prefixes ({} automatic), {} diagnostics; {:.2} ms",
                manifest.tests.len(),manifest.checkpoints.len(),manifest.checkpoints.iter().filter(|c|c.automatic).count(),manifest.diagnostics.len(),start.elapsed().as_secs_f64()*1000.0);
            let analysis=&manifest.assessment["analysis"];
            println!("Cost analysis: {}/{} statements analyzed, {} exact; {} fixture gaps, {} worker gaps",
                analysis["analyzedStatements"],analysis["totalStatements"],analysis["exactStatements"],
                analysis["fixturesWithGaps"],analysis["workersWithGaps"]);
        },
        Some("verify") if args.len()==2 => {verify(&args[1])?; println!("Manifest matches source and planner");},
        _ => return Err("Usage: magelens-plan plan SOURCE_ROOT MANIFEST | verify MANIFEST | cost-plan < UNITS.json. Execute tests with bin/run-coverage --branching.".into())
    }
    Ok(())
}
fn record_result<T>(manifest: &Path, result: Result<T, String>) -> Result<T, String> {
    let failure = std::path::PathBuf::from(format!("{}.error.json", manifest.display()));
    match result {
        Ok(value) => {
            match fs::remove_file(&failure) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
            Ok(value)
        }
        Err(message) => {
            let error: serde_json::Value = serde_json::from_str(&message)
                .ok()
                .filter(|v: &serde_json::Value| v["code"] == "ESTIMATION_FAILED")
                .unwrap_or_else(|| {
                    estimation::error(
                        "Cost assessment failed; no tests may execute until all work is assessed",
                        vec![serde_json::json!({"phase":"assessment","message":message})],
                    )
                });
            if let Err(write_error) = write_json(&failure, &error) {
                return Err(estimation::error(
                    "Assessment failed and its failure report could not be saved",
                    vec![error, serde_json::json!({"message":write_error})],
                )
                .to_string());
            }
            Err(error.to_string())
        }
    }
}
fn verify(file: &str) -> Result<(), String> {
    // The orchestration container mounts source read-only. Verification never
    // changes manifests or clears a failed assessment; successful replanning does.
    match fs::read_to_string(format!("{file}.error.json")) {
        Ok(failure) => {
            let valid = serde_json::from_str::<serde_json::Value>(&failure)
                .ok()
                .is_some_and(|value| {
                    value["code"] == "ESTIMATION_FAILED"
                        && value["statusCode"] == 500
                        && value["issues"].is_array()
                });
            return Err(if valid {
                failure
            } else {
                "Invalid assessment failure report; replan before execution".into()
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let data = fs::read(file).map_err(|e| e.to_string())?;
    let saved: Manifest = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let fresh = plan(Path::new(&saved.root))?;
    if serde_json::from_slice::<serde_json::Value>(&data).map_err(|e| e.to_string())?
        != serde_json::to_value(&fresh).unwrap()
    {
        return Err("Stale or modified manifest; run plan again before launching".into());
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        let error = if matches!(env::args().nth(1).as_deref(), Some("plan" | "verify")) {
            serde_json::from_str::<serde_json::Value>(&error)
                .ok()
                .filter(|value| value["code"] == "ESTIMATION_FAILED")
                .unwrap_or_else(|| {
                    estimation::error(
                        "Cost assessment failed; no tests may execute until all work is assessed",
                        vec![serde_json::json!({"phase":"assessment","message":error})],
                    )
                })
                .to_string()
        } else {
            error
        };
        eprintln!("{error}");
        std::process::exit(1);
    }
}

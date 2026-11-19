---
name: coverage-database
description: "Query the MageLens coverage database (coverage/report.sqlite) with targeted read-only SQL: check which collectors ran, find uncovered code, total a module, and list the tests that reach a file."
---
<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->


# Coverage Database

`./bin/run-coverage` writes `coverage/report.sqlite` after a successful run. It holds every eligible unit of PHP, JavaScript, template and XML coverage, with or without a hit. The schema is `coverage/schema.sql`; field meanings are in [docs/coverage.md](../../../docs/coverage.md#coverage-database).

## Rules

- Open the database read-only: `sqlite3 -readonly coverage/report.sqlite "SQL"` (SQLite 3.37 or newer), or `new DatabaseSync(file, {readOnly: true})` from `node:sqlite`, which `./bin/runner node` provides without host tools. Never write to it; the next run replaces it.
- Ask narrow questions. Filter by `module_name` or `file_path` and by metric, select only the columns you need, and add `LIMIT`. Do not dump `records` or load the file into context.
- Read the views first: `metric_totals`, `module_totals`, `file_totals`, `uncovered_records`.
- A metric is the pair `source_type` and `metric`: PHP `lines` and XML `lines` are different metrics, as are JavaScript and template `statements`. Always filter or group by both, and never add or compare different metrics. Total from `total` and `covered` counts, not from averaged percentages.
- An empty result is not proof of full coverage. Before reading `uncovered_records` for a file, confirm the exact path in `file_totals`; a mistyped or unmeasured file also returns no rows.
- Paths are relative to the Magento root (`src/`). Line numbers refer to the original source.

## Check what was collected

Run this before drawing a conclusion from missing rows:

```sql
SELECT collector, status, limitations FROM manifest;
```

- `collected`: the data is complete for the run. A record without a hit is uncovered code.
- `not_collected`: there are no rows for this collector. Report "not measured", never 0%.
- `collector` equals `records.source_type`. `limitations` lists what the collector could not measure. Those units have no records, so they are neither covered nor uncovered.
- `run_id` and `commit_sha` identify the run. If the sources changed since, rerun coverage before trusting line numbers.

## Example queries

Totals for the run, one row per metric:

```sql
SELECT source_type, metric, covered, total, percent FROM metric_totals;
```

Totals for one module:

```sql
SELECT source_type, metric, files, covered, total, percent
FROM module_totals WHERE module_name = 'Application_Blog';
```

Least covered PHP files of a module:

```sql
SELECT file_path, covered, total, percent FROM file_totals
WHERE module_name = 'Application_Blog' AND metric = 'lines' AND source_type = 'php'
ORDER BY percent, total DESC LIMIT 10;
```

Uncovered code in one file. The first query confirms the path and shows whether anything is uncovered:

```sql
SELECT source_type, metric, covered, total FROM file_totals
WHERE file_path = 'app/code/Application/Blog/Model/Posts.php';
SELECT source_type, metric, start_line, end_line FROM uncovered_records
WHERE file_path = 'app/code/Application/Blog/Model/Posts.php' ORDER BY start_line;
```

For XML declarations, `record_key` ends with `@<area>`, for example `@frontend`: one declaration has a record in each eligible configuration area.

Files of a module that no test reached at all:

```sql
SELECT file_path, source_type, metric, total FROM file_totals
WHERE module_name = 'Application_Blog' AND covered = 0;
```

Tests covering a file. First confirm that `test-attribution` is `collected` in `manifest`; otherwise `tests` and `test_hits` are empty and the answer is "not measured":

```sql
SELECT DISTINCT t.runner, t.test_file, t.test_name
FROM records r JOIN test_hits th USING (record_id) JOIN tests t USING (test_id)
WHERE r.file_path = 'app/code/Application/Blog/Model/Posts.php';
```

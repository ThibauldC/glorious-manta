# Spark UI Detective: the quiz

A dependency-free game embedded in the parent Eleventy site at `/spark-ui/`.
It uses no browser storage, so a refresh restarts the game.

## Files

| File | What it holds |
|---|---|
| `index.njk` | the Eleventy page that mounts the game |
| `style.css` | Spark UI styling plus the detective chrome |
| `app.js` | screens, the Spark UI renderer, scoring |
| `cases.js` | all seven cases: the story for each, plus the mock Spark UI data |
| `talk-cases.js` | GENERATED: the Spark UI data for the talk's four cases |
| `tools/build_talk_cases.py` | builds `talk-cases.js` from the talk's event logs |

The intro screen offers two case files: the four cases from the talk (`set: "talk"`) and
three new ones (`set: "new"`).

## The talk's cases

Their jobs, stages, every task, executors, and SQL plans with metrics come straight
from the event logs recorded for the talk. Regenerate them with:

```
python3 sparkui/tools/build_talk_cases.py ~/git/personal/spark-ui-detective
```

The script reads `case_0_logs`, `case1_logs_bad`, `case2_mem_bad_attempt2` and
`case_3_logs` from that folder. On the way out it relabels job descriptions and app
names (the originals, such as "CASE 1 BAD: standard-rate hot join key", give the answer
away), masks OneLake workspace and lakehouse GUIDs, and exports only a whitelist of
Spark properties, since the raw environment holds session tokens and a password.
The brief,
suspects and verdict for each talk case live in `cases.js`, wrapped in `fromLog()`.

`app.js` knows nothing about Spark specifics. It renders whatever `cases.js` gives
it, so replacing mock numbers with real ones never touches the renderer.

## Replacing the mock data

Every number in the three new cases is a placeholder. After running the notebooks in
`case4_small_files`, `case5_missing_pruning` and `case6_driver_bottleneck`, capture
the History Server values and paste them in.

Units: sizes in bytes, durations in milliseconds, records as plain integers. `app.js`
formats them the Spark way (`3.0 GiB`, `4.8 s`, `2.4 min`), so do not pre-format.

Task rows use the `T()` helper, one line per task, in this order:

```
index, taskId, attempt, exec, host, launch, duration, gc,
input, inputRecords, shuffleWrite, shuffleWriteRecords, shuffleRead, spill
```

Twenty rows per decisive stage is enough. The table header says "Showing 20 of 625",
which is what the real Spark UI does anyway.

The SQL plan graph is the exception to "do not pre-format". Each query's `graph` holds
nodes whose ids match the `(n)` numbers in the plan text, with `from` naming the nodes
that feed in and `cluster` naming the WholeStageCodegen box around them. Its metrics are
strings copied as the SQL tab prints them: `[name, value]`, or
`[name, total, min, med, max, "stage 1.0: task 39"]` for task-aggregated metrics.
Hovering a node shows its block from the plan text, as Spark does.

## What the player can do

Switch tabs, drill from Stages into a stage, sort the stage and task tables by any column, open
the DAG and Event Timeline collapsibles, and read the SQL plan graph and its metrics. Then accuse.

The site tracks which tabs each player opened and mentions it in the verdict, so
somebody who guessed without reading the SQL plan gets told.

## Publishing

Run the parent site's `npm run build`; Eleventy publishes the page and its assets under
`/spark-ui/`.

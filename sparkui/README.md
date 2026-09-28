# Spark UI Detective: the quiz

A dependency-free game embedded in the parent Eleventy site at `/spark-ui/`.
It uses no browser storage, so a refresh restarts the game.

## Files

| File | What it holds |
|---|---|
| `index.njk` | the Eleventy page that mounts the game |
| `style.css` | Spark UI styling plus the detective chrome |
| `app.js` | screens, the Spark UI renderer, scoring |
| `cases.js` | the three cases, as data |

`app.js` knows nothing about Spark specifics. It renders whatever `cases.js` gives
it, so replacing mock numbers with real ones never touches the renderer.

## Replacing the mock data

Every number in `cases.js` is a placeholder. After running the notebooks in
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

Switch tabs, drill from Stages into a stage, sort the task table by any column, open
the DAG and Event Timeline collapsibles, read the SQL plan graph and its metrics, and check the three Fabric
Diagnosis panels. Then accuse.

The site tracks which tabs each player opened and mentions it in the verdict, so
somebody who guessed without reading the SQL plan gets told.

## Publishing

Run the parent site's `npm run build`; Eleventy publishes the page and its assets under
`/spark-ui/`.

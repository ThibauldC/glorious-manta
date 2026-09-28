#!/usr/bin/env python3
"""Build sparkui/talk-cases.js from the talk's Spark event logs.

    python3 sparkui/tools/build_talk_cases.py ~/git/personal/spark-ui-detective

Reads the four event logs recorded for the talk and writes everything the Spark UI
renderer shows: jobs, stages, every task, executors, and SQL plans with their
metrics. The story around each case (brief, suspects, verdict) lives in cases.js.

Nothing is invented. Three things are changed on the way out:

- Job descriptions and app names are relabelled. The scripts named their jobs after
  the bug ("CASE 1 BAD: standard-rate hot join key"), which would give the answer away.
- Workspace and lakehouse GUIDs in OneLake paths are masked.
- Only a whitelist of Spark properties is exported. The raw environment contains
  session tokens and a metastore password.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CASES = {
    "case0": {
        "log": "case_0_logs",
        "labels": [("CASE 0 BAD: data growth and spill", "Monthly route report")],
        "app": "monthly_route_re",
        "paths": [("demo_outputs/case0", "reports/monthly_routes")],
    },
    "case1": {
        "log": "case1_logs_bad",
        "labels": [("CASE 1 BAD: standard-rate hot join key", "Fare rule enrichment")],
        "app": "fare_rule_enrich",
        "paths": [("demo_outputs/case1/bad", "enriched/trips_with_fare_rules")],
    },
    "case2": {
        "log": "case2_mem_bad_attempt2",
        "labels": [("CASE 2 BAD: unbounded Python partition profiling", "Column profile report")],
        "app": "column_profile_r",
        "paths": [("demo_outputs/case2/bad", "reports/column_profile")],
    },
    "case3": {
        "log": "case_3_logs",
        "labels": [("CASE 3 BAD: gzip CSV export", "Partner trip export")],
        "app": "partner_trip_exp",
        "paths": [("demo_outputs/case3/bad", "exports/partner_trips")],
    },
}

ENV_KEYS = [
    "spark.app.name", "spark.master", "spark.submit.deployMode",
    "spark.driver.cores", "spark.driver.memory", "spark.driver.memoryOverhead",
    "spark.driver.maxResultSize",
    "spark.executor.cores", "spark.executor.instances", "spark.executor.memory",
    "spark.executor.memoryOverhead",
    "spark.dynamicAllocation.enabled", "spark.dynamicAllocation.minExecutors",
    "spark.dynamicAllocation.maxExecutors",
    "spark.native.enabled",
    "spark.sql.adaptive.enabled", "spark.sql.autoBroadcastJoinThreshold",
    "spark.sql.files.maxPartitionBytes", "spark.sql.shuffle.partitions",
]

GUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
ONELAKE = re.compile(r"abfss://" + GUID + r"@onelake\.dfs\.fabric\.microsoft\.com/" + GUID + "/")
CLEAN_ONELAKE = "abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/"

KIB, MIB, GIB, TIB = 1 << 10, 1 << 20, 1 << 30, 1 << 40


class Cleaner:
    """Relabels and masks every string that leaves this script."""

    def __init__(self, cfg, app_name):
        self.pairs = list(cfg["labels"]) + list(cfg["paths"])
        suffix = app_name.split("_")[-1]
        self.pairs.append((app_name, cfg["app"] + "_" + suffix))

    def __call__(self, text):
        if not isinstance(text, str):
            return text
        text = ONELAKE.sub(CLEAN_ONELAKE, text)
        for old, new in self.pairs:
            text = text.replace(old, new)
        return text


# ------------------------------------------------------------------ formatting
# The SQL tab prints metrics as strings. These follow Spark's Utils.bytesToString
# and Utils.msDurationToString, so the graph reads like the real one.

def spark_bytes(n):
    n = int(n)
    for unit, size in (("TiB", TIB), ("GiB", GIB), ("MiB", MIB), ("KiB", KIB)):
        if n >= 2 * size:
            return "%.1f %s" % (n / size, unit)
    return "%.1f B" % n


def spark_ms(ms):
    ms = int(ms)
    if ms < 1000:
        return "%d ms" % ms
    if ms < 60000:
        return "%.1f s" % (ms / 1000)
    if ms < 3600000:
        return "%.1f m" % (ms / 60000)
    return "%.2f h" % (ms / 3600000)


def spark_num(n):
    return "{:,}".format(int(n))


def utc(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y/%m/%d %H:%M:%S")


def quantiles(values):
    """Spark's task summary picks sorted[min(q * n, n - 1)]."""
    s = sorted(values)
    n = len(s)
    return [s[min(int(q * n), n - 1)] for q in (0, 0.25, 0.5, 0.75, 1.0)]


# ------------------------------------------------------------------- the log

def load(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def kind(event):
    return event["Event"].split(".")[-1]


def build(key, cfg, logdir):
    events = load(Path(logdir) / cfg["log"])
    by = {}
    for e in events:
        by.setdefault(kind(e), []).append(e)

    start = by["SparkListenerApplicationStart"][0]
    clean = Cleaner(cfg, start["App Name"])
    t0 = start["Timestamp"]
    ends = by.get("SparkListenerApplicationEnd")
    stamps = [e.get("Timestamp") or e.get("time") or e.get("Completion Time") or
              e.get("Submission Time") or 0 for e in events]
    stamps += [e["Task Info"]["Finish Time"] for e in by.get("SparkListenerTaskEnd", [])]
    t_end = ends[0]["Timestamp"] if ends else max(stamps)
    complete = bool(ends)

    spark_version = events[0]["Spark Version"]
    env_props = dict(by["SparkListenerEnvironmentUpdate"][0]["Spark Properties"])

    # ------------------------------------------------------------ executors
    execs = {}
    for e in by.get("SparkListenerBlockManagerAdded", []):
        bm = e["Block Manager ID"]
        if bm["Executor ID"] == "fallback":
            continue
        ex = execs.setdefault(bm["Executor ID"], {"id": bm["Executor ID"]})
        ex["address"] = "%s:%d" % (bm["Host"], bm["Port"])
        ex["storageMemoryTotal"] = e.get("Maximum Memory", 0)
        ex.setdefault("added", e["Timestamp"])
    for e in by.get("SparkListenerExecutorAdded", []):
        ex = execs.setdefault(e["Executor ID"], {"id": e["Executor ID"]})
        ex["cores"] = e["Executor Info"]["Total Cores"]
        ex["added"] = e["Timestamp"]
    for e in by.get("SparkListenerExecutorRemoved", []):
        ex = execs[e["Executor ID"]]
        if "removed" not in ex:
            ex["removed"] = e["Timestamp"]
            ex["lossReason"] = e["Removed Reason"]

    # --------------------------------------------------------------- tasks
    tasks_by_stage = {}
    for e in by.get("SparkListenerTaskEnd", []):
        info, m = e["Task Info"], e.get("Task Metrics") or {}
        reason = e["Task End Reason"]
        sr = m.get("Shuffle Read Metrics", {})
        sw = m.get("Shuffle Write Metrics", {})
        im = m.get("Input Metrics", {})
        om = m.get("Output Metrics", {})
        ok = reason["Reason"] == "Success"
        t = {
            "index": info["Index"], "taskId": info["Task ID"], "attempt": info["Attempt"],
            "status": "SUCCESS" if ok else ("KILLED" if info.get("Killed") else "FAILED"),
            "locality": info["Locality"], "exec": info["Executor ID"], "host": info["Host"],
            "launch": utc(info["Launch Time"]),
            "launchMs": info["Launch Time"], "finishMs": info["Finish Time"],
            "duration": info["Finish Time"] - info["Launch Time"],
            "runTime": m.get("Executor Run Time", 0),
            "gc": m.get("JVM GC Time", 0),
            "input": im.get("Bytes Read", 0), "inputRecords": im.get("Records Read", 0),
            "output": om.get("Bytes Written", 0), "outputRecords": om.get("Records Written", 0),
            "shuffleRead": sr.get("Remote Bytes Read", 0) + sr.get("Local Bytes Read", 0),
            "shuffleReadRecords": sr.get("Total Records Read", 0),
            "fetchWait": sr.get("Fetch Wait Time", 0),
            "shuffleWrite": sw.get("Shuffle Bytes Written", 0),
            "shuffleWriteRecords": sw.get("Shuffle Records Written", 0),
            "memorySpill": m.get("Memory Bytes Spilled", 0),
            "spill": m.get("Disk Bytes Spilled", 0),
            "peakMemory": m.get("Peak Execution Memory", 0),
            "stageAttempt": e["Stage Attempt ID"],
            "accums": info.get("Accumulables", []) if ok else [],
        }
        if not ok:
            t["error"] = clean(task_error(reason))
        tasks_by_stage.setdefault(e["Stage ID"], []).append(t)

    # -------------------------------------------------------------- stages
    stage_names, stage_tasks = {}, {}
    for e in by.get("SparkListenerJobStart", []):
        for s in e["Stage Infos"]:
            stage_names[s["Stage ID"]] = s["Stage Name"]
            stage_tasks[s["Stage ID"]] = s["Number of Tasks"]
    submitted = {}
    for e in by.get("SparkListenerStageSubmitted", []):
        s = e["Stage Info"]
        submitted[s["Stage ID"]] = s
    completed = {}
    for e in by.get("SparkListenerStageCompleted", []):
        s = e["Stage Info"]
        completed[s["Stage ID"]] = s

    job_starts = {e["Job ID"]: e for e in by.get("SparkListenerJobStart", [])}
    job_ends = {e["Job ID"]: e for e in by.get("SparkListenerJobEnd", [])}
    running_jobs = set(job_starts) - set(job_ends)

    stages, stage_detail = [], {}
    for sid in sorted(set(submitted) | pending_stages(job_starts, running_jobs, submitted)):
        sub = submitted.get(sid)
        done = completed.get(sid)
        tasks = tasks_by_stage.get(sid, [])
        good = [t for t in tasks if t["status"] == "SUCCESS"]
        if sub is None:
            status = "PENDING"
        elif done is None:
            status = "ACTIVE"
        elif done.get("Failure Reason"):
            status = "FAILED"
        else:
            status = "COMPLETE"
        sub_ms = sub["Submission Time"] if sub else None
        end_ms = done["Completion Time"] if done else t_end
        row = {
            "id": sid, "attempt": (sub or {}).get("Stage Attempt ID", 0),
            "description": clean(stage_names[sid]),
            "submitted": utc(sub_ms) if sub_ms else "Unknown",
            "duration": (end_ms - sub_ms) if sub_ms else 0,
            "tasksDone": len(good), "tasksTotal": stage_tasks[sid],
            "tasksFailed": len(tasks) - len(good),
            "input": total(good, "input"), "inputRecords": total(good, "inputRecords"),
            "output": total(good, "output"),
            "shuffleRead": total(good, "shuffleRead"), "shuffleWrite": total(good, "shuffleWrite"),
            "spill": total(good, "spill"), "memorySpill": total(good, "memorySpill"),
            "status": status,
        }
        stages.append(row)
        if sub is not None:
            stage_detail[sid] = detail(sub, tasks, execs, clean)

    # ---------------------------------------------------------------- jobs
    jobs = []
    for jid in sorted(job_starts):
        e = job_starts[jid]
        ids = e["Stage IDs"]
        ran = [s for s in ids if s in submitted]
        skipped = [s for s in ids if s not in submitted and jid not in running_jobs]
        good = sum(len([t for t in tasks_by_stage.get(s, []) if t["status"] == "SUCCESS"]) for s in ran)
        failed = sum(len([t for t in tasks_by_stage.get(s, []) if t["status"] != "SUCCESS"]) for s in ran)
        total_tasks = sum(stage_tasks[s] for s in ids if s not in skipped)
        done_stages = len([s for s in ran if s in completed and not completed[s].get("Failure Reason")])
        label = "%d/%d" % (done_stages, len(ids) - len(skipped))
        if skipped:
            label += " (%d skipped)" % len(skipped)
        end = job_ends.get(jid)
        result = end["Job Result"]["Result"] if end else None
        end_ms = end["Completion Time"] if end else t_end
        props = e.get("Properties", {})
        last_stage = max(ids)
        longest = max(ran, key=lambda s: stage_row(stages, s)["duration"]) if ran else ids[0]
        jobs.append({
            "id": jid,
            "description": clean(props.get("spark.job.description") or stage_names[last_stage]),
            "group": clean(stage_names[last_stage]),
            "submitted": utc(e["Submission Time"]),
            "startMs": e["Submission Time"] - t0, "endMs": end_ms - t0,
            "duration": end_ms - e["Submission Time"],
            "stages": label, "stageIds": ids, "link": longest,
            "tasksDone": good, "tasksTotal": total_tasks, "tasksFailed": failed,
            "tasksSkipped": sum(stage_tasks[s] for s in skipped),
            "status": "RUNNING" if end is None else ("SUCCEEDED" if result == "JobSucceeded" else "FAILED"),
            "sqlId": int(props["spark.sql.execution.id"]) if props.get("spark.sql.execution.id") else None,
        })

    # ----------------------------------------------------------------- sql
    sql = build_sql(by, jobs, tasks_by_stage, t_end, clean)

    # ----------------------------------------------------------- executors
    exec_list, summary = executor_table(execs, tasks_by_stage)
    events_out = []
    for ex in execs.values():
        if ex["id"] == "driver":
            continue
        events_out.append({"ms": ex["added"] - t0, "id": ex["id"], "kind": "added"})
        if "removed" in ex:
            events_out.append({"ms": ex["removed"] - t0, "id": ex["id"], "kind": "removed",
                               "reason": clean(ex["lossReason"])})

    environment = [[k, clean(env_props[k])] for k in ENV_KEYS if k in env_props]

    return {
        "app": {
            "id": start["App ID"], "attemptId": start.get("App Attempt ID"),
            "name": clean(start["App Name"]), "user": start["User"],
            "uptime": dur_text(t_end - t0), "uptimeMs": t_end - t0,
            "sparkVersion": spark_version, "schedulingMode": "FIFO",
            "completedJobs": len([j for j in jobs if j["status"] == "SUCCEEDED"]),
            "incomplete": not complete,
        },
        "jobs": jobs,
        "stages": stages,
        "stageDetail": stage_detail,
        "sql": sql,
        "executors": {"summary": summary, "list": exec_list},
        "executorEvents": sorted(events_out, key=lambda x: x["ms"]),
        "environment": environment,
    }


def pending_stages(job_starts, running, submitted):
    out = set()
    for jid in running:
        for s in job_starts[jid]["Stage IDs"]:
            if s not in submitted:
                out.add(s)
    return out


def stage_row(stages, sid):
    return [s for s in stages if s["id"] == sid][0]


def total(tasks, field):
    return sum(t[field] for t in tasks)


def dur_text(ms):
    if ms < 60000:
        return "%.1f s" % (ms / 1000)
    if ms < 3600000:
        return "%.1f min" % (ms / 60000)
    return "%.1f h" % (ms / 3600000)


def task_error(reason):
    r = reason["Reason"]
    if r == "ExecutorLostFailure":
        how = ("caused by one of the running tasks" if reason.get("Exit Caused By App")
               else "unrelated to the running tasks")
        return "ExecutorLostFailure (executor %s exited %s) Reason: %s" % (
            reason["Executor ID"], how, reason.get("Loss Reason", ""))
    if r == "ExceptionFailure":
        return "%s: %s" % (reason.get("Class Name"), reason.get("Description"))
    return r


# ------------------------------------------------------------- stage detail

def detail(sub, tasks, execs, clean):
    good = [t for t in tasks if t["status"] == "SUCCESS"]
    locality = {}
    for t in tasks:
        locality[t["locality"]] = locality.get(t["locality"], 0) + 1

    summary = []
    if good:
        def row(metric, field, kind, rec=None, always=False):
            vals = [t[field] for t in good]
            if not always and not any(vals):
                return
            q = quantiles(vals)
            r = {"metric": metric, "min": q[0], "p25": q[1], "median": q[2],
                 "p75": q[3], "max": q[4], "kind": kind}
            if rec:
                rq = quantiles([t[rec] for t in good])
                r.update(recMin=rq[0], recP25=rq[1], recMedian=rq[2], recP75=rq[3], recMax=rq[4])
            summary.append(r)
        # Spark's summary "Duration" is executor run time, not wall time.
        row("Duration", "runTime", "time", always=True)
        row("GC Time", "gc", "time", always=True)
        row("Peak Execution Memory", "peakMemory", "bytes")
        row("Input Size / Records", "input", "bytes", "inputRecords")
        row("Output Size / Records", "output", "bytes", "outputRecords")
        row("Shuffle Read Blocked Time", "fetchWait", "time")
        row("Shuffle Read Size / Records", "shuffleRead", "bytes", "shuffleReadRecords")
        row("Shuffle Write Size / Records", "shuffleWrite", "bytes", "shuffleWriteRecords")
        row("Spill (Memory)", "memorySpill", "bytes")
        row("Spill (Disk)", "spill", "bytes")

    by_exec = {}
    for t in tasks:
        b = by_exec.setdefault(t["exec"], {"exec": t["exec"],
                                           "address": execs.get(t["exec"], {}).get("address", t["host"]),
                                           "tasks": 0, "failedTasks": 0, "taskTime": 0, "input": 0,
                                           "shuffleRead": 0, "shuffleWrite": 0, "spill": 0})
        b["tasks"] += 1
        b["taskTime"] += t["duration"]
        if t["status"] != "SUCCESS":
            b["failedTasks"] += 1
        for f in ("input", "shuffleRead", "shuffleWrite", "spill"):
            b[f] += t[f]

    stage_start = sub["Submission Time"]
    out_tasks = []
    for t in sorted(tasks, key=lambda t: (t["index"], t["attempt"])):
        row = {k: v for k, v in t.items()
               if k not in ("accums", "launchMs", "finishMs", "runTime", "stageAttempt",
                            "outputRecords", "fetchWait", "peakMemory")}
        row["start"] = t["launchMs"] - stage_start
        out_tasks.append(row)

    return {
        "totalTaskTime": total(tasks, "duration"),
        "localitySummary": ", ".join("%s: %d" % kv for kv in sorted(locality.items())),
        "input": total(good, "input"), "inputRecords": total(good, "inputRecords"),
        "output": total(good, "output"), "outputRecords": total(good, "outputRecords"),
        "shuffleRead": total(good, "shuffleRead"), "shuffleReadRecords": total(good, "shuffleReadRecords"),
        "shuffleWrite": total(good, "shuffleWrite"), "shuffleWriteRecords": total(good, "shuffleWriteRecords"),
        "spill": total(good, "spill"), "memorySpill": total(good, "memorySpill"),
        "dag": stage_dag(sub, clean),
        "summary": summary,
        "byExecutor": [by_exec[k] for k in sorted(by_exec, key=exec_order)],
        "tasks": out_tasks,
    }


def stage_dag(sub, clean):
    """Group the stage's RDDs by operation scope, the way Spark's DAG view does."""
    nodes = []
    for r in sorted(sub["RDD Info"], key=lambda r: r["RDD ID"]):
        scope = json.loads(r["Scope"])["name"] if r.get("Scope") else r["Name"]
        label = "%s [%d]" % (r["Name"], r["RDD ID"])
        if nodes and nodes[-1]["name"] == scope:
            nodes[-1]["rdds"].append(label)
        else:
            nodes.append({"name": scope, "rdds": [label]})
    return [{"name": clean(n["name"]), "detail": clean(", ".join(n["rdds"]))} for n in nodes]


def exec_order(eid):
    return (0, 0) if eid == "driver" else (1, int(eid)) if eid.isdigit() else (2, eid)


# -------------------------------------------------------------------- sql

SKIP_NODES = ("InputAdapter", "ShuffleQueryStage", "BroadcastQueryStage", "TableCacheQueryStage")


def parse_plan_tree(text):
    """The '(n) Name' tree at the top of the formatted plan, final plan only."""
    lines = text.split("\n\n")[0].split("\n")[1:]
    if any("== Final Plan ==" in l for l in lines):
        root_line = lines[0]
        body, keep = [], False
        for l in lines[1:]:
            if "== Final Plan ==" in l:
                keep = True
                continue
            if "== Initial Plan ==" in l:
                break
            if keep:
                body.append(l)
        lines = [root_line] + body
    pat = re.compile(r"^(?P<lead>[\s:+\-|]*?)(\* )?(?P<name>[A-Za-z].*?) \((?P<id>\d+)\)")
    root, stack = None, []
    for l in lines:
        m = pat.match(l)
        if not m:
            continue
        col = len(m.group("lead"))
        node = {"name": m.group("name"), "id": int(m.group("id")), "kids": []}
        while stack and stack[-1][0] >= col:
            stack.pop()
        if stack:
            stack[-1][1]["kids"].append(node)
        elif root is None:
            root = node
        stack.append((col, node))
    return root


def plan_blocks(text):
    out = {}
    for block in re.split(r"\n\n+", text):
        m = re.match(r"^\((\d+)\) ", block)
        if m:
            out[int(m.group(1))] = block
    return out


def build_sql(by, jobs, tasks_by_stage, t_end, clean):
    starts = {e["executionId"]: e for e in by.get("SparkListenerSQLExecutionStart", [])}
    ends = {e["executionId"]: e for e in by.get("SparkListenerSQLExecutionEnd", [])}
    latest = dict(starts)
    for e in by.get("SparkListenerSQLAdaptiveExecutionUpdate", []):
        latest[e["executionId"]] = e

    # Per-task SQL metric values, successful tasks only, as the SQL tab counts them.
    values = {}
    for sid, tasks in tasks_by_stage.items():
        for t in tasks:
            for a in t["accums"]:
                if a.get("Metadata") != "sql" or "Update" not in a:
                    continue
                values.setdefault(a["ID"], []).append((int(a["Update"]), sid, t["stageAttempt"], t["taskId"]))
    driver = {}
    for e in by.get("SparkListenerDriverAccumUpdates", []):
        for acc_id, v in e["accumUpdates"]:
            driver[acc_id] = driver.get(acc_id, 0) + v

    out = []
    for xid in sorted(starts):
        s, plan_ev = starts[xid], latest[xid]
        end = ends.get(xid)
        text = clean(plan_ev["physicalPlanDescription"])
        graph = plan_graph(plan_ev["sparkPlanInfo"], text, values, driver, clean)
        out.append({
            "id": xid,
            "description": clean(s["description"]),
            "submitted": utc(s["time"]),
            "duration": (end["time"] if end else t_end) - s["time"],
            "status": "RUNNING" if end is None else ("FAILED" if end.get("errorMessage") else "COMPLETED"),
            "jobIds": [j["id"] for j in jobs if j["sqlId"] == xid],
            "properties": sorted([k, clean(v)] for k, v in (s.get("modifiedConfigs") or {}).items()),
            "graph": graph,
            "plan": text,
        })
    return out


def metric_value(m, values, driver):
    name, mtype, acc = m["name"], m["metricType"], m["accumulatorId"]
    vals = values.get(acc, [])
    if acc in driver:
        vals = vals + [(driver[acc], None, None, None)]
    nums = [v[0] for v in vals if v[0] >= 0]
    if mtype == "sum":
        return [name, spark_num(sum(nums))]
    fmt = {"size": spark_bytes, "timing": spark_ms,
           "nsTiming": lambda n: spark_ms(n / 1e6), "average": lambda n: "%.1f" % (n / 10)}.get(mtype)
    if fmt is None:
        return [name, spark_num(sum(nums))]
    if len(nums) <= 1:
        return [name, fmt(nums[0] if nums else 0)]
    ordered = sorted(v for v in vals if v[0] >= 0)
    top = max(vals, key=lambda v: v[0])
    where = "stage %s.%s: task %s" % (top[1], top[2], top[3])
    med = ordered[len(ordered) // 2][0]
    if mtype == "average":
        return [name + " (min, med, max)", "(%s, %s, %s (%s))" % (
            fmt(ordered[0][0]), fmt(med), fmt(top[0]), where)]
    return [name, fmt(sum(nums)), fmt(ordered[0][0]), fmt(med), fmt(top[0]), where]


def plan_graph(info, text, values, driver, clean):
    blocks = plan_blocks(text)
    tree = parse_plan_tree(text)
    nodes, clusters = [], {}
    next_id = [max(blocks) + 1 if blocks else 1]

    def visit(p, tnode, cluster):
        name = p["nodeName"]
        kids = p.get("children", [])
        if name.startswith("WholeStageCodegen"):
            cid = int(re.search(r"\((\d+)\)", name).group(1))
            clusters[cid] = {"name": name,
                             "metrics": [metric_value(m, values, driver) for m in p.get("metrics", [])]}
            return visit(kids[0], tnode, cid)
        if name in SKIP_NODES:
            if tnode and tnode["name"].startswith(name):
                tnode = tnode["kids"][0] if tnode["kids"] else None
            return visit(kids[0], tnode, None if name == "InputAdapter" else cluster)
        matched = tnode is not None and tnode["name"].startswith(name)
        if matched:
            nid = tnode["id"]
        else:
            nid = next_id[0]
            next_id[0] += 1
        tkids = tnode["kids"] if matched and len(tnode["kids"]) == len(kids) else [None] * len(kids)
        froms = [visit(k, tk, cluster) for k, tk in zip(kids, tkids)]
        node = {"id": nid, "name": clean(name)}
        if cluster:
            node["cluster"] = cluster
        if froms:
            node["from"] = froms
        ms = [metric_value(m, values, driver) for m in p.get("metrics", [])]
        if ms:
            node["metrics"] = ms
        if nid not in blocks:
            node["tip"] = clean(p["simpleString"])
        nodes.append(node)
        return nid

    if tree and tree["name"].startswith("AdaptiveSparkPlan") and info["nodeName"] != "AdaptiveSparkPlan":
        tree = tree["kids"][0] if tree["kids"] else None
    visit(info, tree, None)
    nodes.sort(key=lambda n: n["id"])
    graph = {"nodes": nodes}
    if clusters:
        graph["clusters"] = clusters
    return graph


# -------------------------------------------------------------- executors

def executor_table(execs, tasks_by_stage):
    stats = {}
    for tasks in tasks_by_stage.values():
        for t in tasks:
            s = stats.setdefault(t["exec"], {"failedTasks": 0, "completeTasks": 0, "taskTime": 0,
                                             "gcTime": 0, "input": 0, "shuffleRead": 0, "shuffleWrite": 0})
            if t["status"] == "SUCCESS":
                s["completeTasks"] += 1
            else:
                s["failedTasks"] += 1
            s["taskTime"] += t["duration"]
            s["gcTime"] += t["gc"]
            s["input"] += t["input"]
            s["shuffleRead"] += t["shuffleRead"]
            s["shuffleWrite"] += t["shuffleWrite"]
    rows = []
    for eid in sorted(execs, key=exec_order):
        ex = execs[eid]
        s = stats.get(eid, {"failedTasks": 0, "completeTasks": 0, "taskTime": 0, "gcTime": 0,
                            "input": 0, "shuffleRead": 0, "shuffleWrite": 0})
        row = {"id": eid, "address": ex.get("address", ""),
               "status": "Dead" if "removed" in ex else "Active",
               "rddBlocks": 0, "storageMemory": 0, "storageMemoryTotal": ex.get("storageMemoryTotal", 0),
               "diskUsed": 0, "cores": ex.get("cores", 0), "activeTasks": 0,
               "totalTasks": s["failedTasks"] + s["completeTasks"]}
        row.update(s)
        if "lossReason" in ex:
            row["lossReason"] = ex["lossReason"]
        rows.append(row)
    workers = [r for r in rows if r["id"] != "driver"]
    summary = {
        "activeExecutors": len([r for r in workers if r["status"] == "Active"]),
        "deadExecutors": len([r for r in workers if r["status"] == "Dead"]),
        "totalCores": sum(r["cores"] for r in workers if r["status"] == "Active"),
        "totalTasks": sum(r["totalTasks"] for r in rows),
        "failedTasks": sum(r["failedTasks"] for r in rows),
        "totalTaskTime": sum(r["taskTime"] for r in rows),
        "totalGcTime": sum(r["gcTime"] for r in rows),
        "totalInput": sum(r["input"] for r in rows),
        "totalShuffleRead": sum(r["shuffleRead"] for r in rows),
        "totalShuffleWrite": sum(r["shuffleWrite"] for r in rows),
    }
    return rows, summary


# ------------------------------------------------------------------- main

def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    logdir = sys.argv[1]
    data = {key: build(key, cfg, logdir) for key, cfg in CASES.items()}
    target = Path(__file__).resolve().parent.parent / "talk-cases.js"
    with open(target, "w") as fh:
        fh.write("/* Spark UI Detective - the talk's cases, as recorded.\n"
                 " *\n"
                 " * GENERATED by tools/build_talk_cases.py from the event logs. Do not edit;\n"
                 " * rerun the script. The story for each case lives in cases.js.\n"
                 " */\n\n")
        fh.write("var TALK_UI = {\n")
        for i, (key, case) in enumerate(data.items()):
            fh.write("%s: %s%s\n" % (key, json.dumps(case, separators=(",", ":")),
                                     "," if i < len(data) - 1 else ""))
        fh.write("};\n")
    print("wrote %s (%d KiB)" % (target, target.stat().st_size // 1024))


if __name__ == "__main__":
    main()

/* Spark UI Detective - case data
 *
 * Two case files, picked on the intro screen with each case's `set`:
 *
 * "talk"  The four cases from the talk. Their Spark UI data (jobs, stages, tasks,
 *         executors, SQL plans, diagnosis) is generated from the recorded event
 *         logs into talk-cases.js by tools/build_talk_cases.py. Only the story
 *         around it (brief, suspects, verdict) is written here.
 *
 * "new"   Three cases that were not in the talk. MOCK DATA: every number is a
 *         placeholder, to be replaced with values captured from real runs of
 *         case4_small_files, case5_missing_pruning and case6_driver_bottleneck.
 *
 * The renderer in app.js never assumes anything about the content, so you can
 * edit this file alone.
 *
 * Units: bytes for sizes, milliseconds for durations, raw integers for records.
 * app.js formats them the way Spark does (GiB / MiB / KiB, "4.8 s", "2.4 min").
 *
 * Task rows use the compact T() helper below so a captured task table stays one
 * line per task and is easy to paste over.
 *
 * Each SQL query carries a `graph` for the plan DAG. Node ids match the (n)
 * numbers in the plan text; `from` lists the nodes feeding into a node, and
 * `cluster` puts it inside a WholeStageCodegen box. Graph metrics are strings,
 * copied as the SQL tab prints them: [name, value] for a plain metric, or
 * [name, total, min, med, max, "stage 1.0: task 39"] for a task-aggregated one.
 */

var TASK_FIELDS = ["index", "taskId", "attempt", "exec", "host", "launch",
                   "duration", "gc", "input", "inputRecords",
                   "shuffleWrite", "shuffleWriteRecords", "shuffleRead", "spill"];

function T() {
  var row = { status: "SUCCESS", locality: "PROCESS_LOCAL" };
  for (var i = 0; i < TASK_FIELDS.length; i++) row[TASK_FIELDS[i]] = arguments[i];
  return row;
}

var KIB = 1024, MIB = 1024 * 1024, GIB = 1024 * 1024 * 1024;

// A talk case: the Spark UI recorded in the event log plus the story written here.
function fromLog(ui, story) {
  var c = {}, k;
  for (k in ui) c[k] = ui[k];
  for (k in story) c[k] = story[k];
  return c;
}

var COMMON_ENVIRONMENT = [
  ["spark.app.name", "Spark Job Definition"],
  ["spark.driver.cores", "8"],
  ["spark.driver.memory", "56g"],
  ["spark.executor.cores", "8"],
  ["spark.executor.instances", "4"],
  ["spark.executor.memory", "56g"],
  ["spark.master", "yarn"],
  ["spark.sql.adaptive.enabled", "true"],
  ["spark.sql.adaptive.coalescePartitions.enabled", "true"],
  ["spark.sql.autoBroadcastJoinThreshold", "10485760"],
  ["spark.sql.files.maxPartitionBytes", "134217728"],
  ["spark.sql.files.openCostInBytes", "4194304"],
  ["spark.sql.shuffle.partitions", "200"],
  ["spark.sql.sources.parallelPartitionDiscovery.threshold", "32"],
  ["spark.submit.deployMode", "cluster"]
];

var CASES = [

/* ========================================================== TALK CASE 0 == */
fromLog(TALK_UI.case0, {
  set: "talk",
  id: "data-growth",
  title: "Same code, six years of data",
  subtitle: "Monthly route report, full-history backfill",
  brief: "A route report removes duplicate trips, then counts trips and revenue for every " +
         "month and pickup-to-drop-off route. It has run on the latest quarter for months. " +
         "Today it was pointed at the full 2019 to 2024 history: 259 million trips. " +
         "It finished, but nobody likes what they saw. Is this simply the price of more data?",
  symptom: "259,287,888 trips, 3 min 37 s runtime",
  question: "What is the primary cause of the runtime?",

  options: [
    { id: "a", text: "One route key dominates the aggregation, so one reducer does most of the work" },
    { id: "b", text: "The shuffle still has eight partitions, so every reducer's aggregation spills to disk" },
    { id: "c", text: "The scan is the bottleneck: 259 million rows is simply a lot to read" },
    { id: "d", text: "The executor ran out of memory and had to be replaced" }
  ],
  answer: "b",

  evidence: [
    { tab: "Stages", text: "Stage 13 runs 1.8 min with only 8 tasks. It reads 7.4 GiB of shuffle and spills 6.8 GiB to disk. With stage 11, which writes that shuffle, it accounts for 183 of the 217 seconds." },
    { tab: "Stage 13 detail", text: "All eight tasks take between 1.5 and 1.8 minutes and read 802 MiB to 1.0 GiB each. No skew. Every one of them spills: 4.3 to 5.9 GiB in memory, 741 to 978 MiB on disk. Shuffle read blocked time is 0 ms, so nothing is waiting on the network." },
    { tab: "SQL", text: "Query 5 hashes 259 million rows into an Exchange with number of partitions: 8. The final HashAggregate reports 41.4 GiB of spill and 8 sort fallback tasks, and the query's properties show spark.sql.shuffle.partitions = 8." },
    { tab: "Executors", text: "One executor with 8 cores. All eight reducers run at the same time and share one pool of execution memory." },
    { tab: "Diagnosis", text: "Data skew and time skew are clean: the largest stage 13 task is 1.1x the mean. Heavy, not uneven." }
  ],

  wrongAnswers: {
    a: "Stage 13's tasks read between 802 MiB and 1.0 GiB each, and Diagnosis puts the largest at 1.1x the mean. No reducer is hot. They are all equally overloaded.",
    c: "The scan runs in stage 11 and reads 4.9 GiB of Parquet in 73 s. The slowest stage is 13, which reads no files at all: it aggregates the shuffle and spends its time writing and re-reading spill files.",
    d: "The Executors tab shows one executor, alive from start to finish, with no failed tasks. Here memory pressure shows up as spill, not as a lost executor."
  },

  fix: {
    text: "Raise spark.sql.shuffle.partitions from 8 to at least 256 and change nothing else. The same eight cores " +
          "then work through 256 smaller reducers in about 32 waves, each holding a thirty-second of the aggregation " +
          "state, which is small enough to stay in memory. More partitions add no CPU. They shrink what each task " +
          "has to remember.",
    before: "3 min 37 s, 6.8 GiB spilled to disk",
    note: "The event log for the fixed run is not part of this case file."
  }
}),

/* ========================================================== TALK CASE 1 == */
fromLog(TALK_UI.case1, {
  set: "talk",
  id: "hot-key",
  title: "The last task standing",
  subtitle: "Trip enrichment with fare rules, 2022 to 2024",
  brief: "Every trip from 2022 to 2024 gets a pricing-rule description from an eight-row lookup table, " +
         "joined on a fare_rule key and written to Parquet. Broadcast joins are switched off for this " +
         "workload, so both sides are shuffled. 119 million trips go in, 119 million come out. " +
         "The final stage races to the end and then sits there for two minutes.",
  symptom: "119,136,044 trips, 3 min 6 s write query",
  question: "What is the primary cause of the runtime?",

  options: [
    { id: "a", text: "One join key holds almost every row, so one reducer does nearly all the work" },
    { id: "b", text: "The sort-merge join spills to disk because 256 partitions is too few" },
    { id: "c", text: "One slow or unhealthy executor is holding the stage back" },
    { id: "d", text: "Shuffling the eight-row rule table 256 ways costs more than the join itself" }
  ],
  answer: "a",

  evidence: [
    { tab: "Stages", text: "Stage 8 runs 2.4 min over 256 tasks and reads 3.6 GiB of shuffle. It is three quarters of the write query." },
    { tab: "Stage 8 detail", text: "Sort the tasks by duration. Task 89 (index 75) runs 2.4 min and reads 3.2 GiB, 105,720,908 records: 89% of every row in the shuffle. The median task finishes in 42 ms and reads nothing. The event timeline shows one bar still running long after every other slot is empty." },
    { tab: "SQL", text: "Query 1 joins with a SortMergeJoin after Exchange hashpartitioning(fare_rule, 256). The Exchange's local bytes read peak at 3.2 GiB in stage 8.0: task 89. The properties show autoBroadcastJoinThreshold = -1 and skewJoin disabled, so nothing is going to rescue it." },
    { tab: "Diagnosis", text: "Fabric flags both skews for job 5: 3,319.71 MB maximum task data read against a 14.54 MB mean, and a 142.23 s task against a 0.88 s mean." },
    { tab: "Executors", text: "One executor, 8 cores, no failures, no spill. The hot task is busy, not waiting, while seven cores have nothing left to do." }
  ],

  wrongAnswers: {
    b: "Stage 8 spills nothing: Spill (Memory) and Spill (Disk) are 0 for the stage, and both Sort nodes in the SQL plan report a spill size of 0.0 B.",
    c: "There is only one executor, and it ran every task, fast or slow. The slow task is slow because it has 105 million records to join. The other 255 tasks share the remaining 13 million.",
    d: "The rule side is eight rows and 748 bytes of shuffle. It is not what stage 8 spends two minutes on."
  },

  fix: {
    text: "Salt the key. Give every trip one of 8,192 deterministic salt values, replicate the eight rule rows once per " +
          "salt, and join on (fare_rule, salt). The STANDARD trips then hash across all 256 partitions instead of " +
          "landing in one. For a dimension this small the better fix is to allow the broadcast join: no shuffle on the " +
          "fact side means no partition can ever become hot.",
    before: "Stage 8: 2.4 min, one task holding 89% of the rows",
    note: "The event log for the fixed run is not part of this case file."
  }
}),

/* ========================================================== TALK CASE 2 == */
fromLog(TALK_UI.case2, {
  set: "talk",
  id: "executor-memory",
  title: "The executor that kept dying",
  subtitle: "Column null-count profile, full history",
  brief: "A data-quality job profiles every column of the trips table: a row count and a null count per " +
         "column, 21 rows of output. It reads the full 2019 to 2024 history, deals the 259 million trips " +
         "evenly over eight partitions, and does the counting in Python on the executors. The first " +
         "application attempt never finished. This is the second one, and it has been going for fourteen minutes.",
  symptom: "21 rows expected. After 14 min: no output, two executors gone",
  question: "What is killing the job?",

  options: [
    { id: "a", text: "The driver collects the trips and runs out of memory" },
    { id: "b", text: "The Python profiler keeps each whole partition in memory until the executor is killed" },
    { id: "c", text: "A bad node: the host keeps killing healthy containers" },
    { id: "d", text: "The shuffle is skewed, so one task receives most of the trips" }
  ],
  answer: "b",

  evidence: [
    { tab: "Jobs", text: "Job 5 is still running after 12.5 minutes. Its scan stage finished; the next stage has 0 of 8 tasks done and 16 failed. The event timeline shows executor 1 removed, executor 2 added and removed, executor 3 added." },
    { tab: "Stage 11 detail", text: "Every attempt fails with ExecutorLostFailure, exit status 137. The first attempt of all eight tasks dies together on executor 1 after 190 s; the second dies together on executor 2 after 351 s. Two executor deaths, sixteen failed tasks." },
    { tab: "Stage 11 detail", text: "The DAG runs ShuffledRowRDD, map, mapPartitions, PythonRDD: each task hands its shuffled partition to Python code on the executor." },
    { tab: "Executors", text: "Executors 1 and 2 are dead. Loss reason: Container killed on request. Exit code is 137. Each had 8 cores, so eight Python workers shared one container." },
    { tab: "Diagnosis", text: "Spark Advisor raises Spark_System_Executor_ExitCode137BadNode for both executors: when a container runs out of memory, YARN kills it with exit code 137." },
    { tab: "Stages", text: "Stage 10, the scan, is healthy: 53 tasks, 259,287,888 records, 13.7 GiB of shuffle written, no failures, no spill. The trouble starts when Python gets the rows." }
  ],

  wrongAnswers: {
    a: "The driver stayed up through both executor losses; it is the process that kept writing this log. The failures are ExecutorLostFailure on executors 1 and 2, and the stage DAG shows the work running in a PythonRDD on the executors. Nothing is collected.",
    c: "YARN labels every container that exits with 137 as coming \"from a bad node\". The same host ran the 53-task scan stage without a single failure. The containers die only in the Python stage, each time after eight Python workers have been running for minutes: that is what memory growth looks like.",
    d: "Round-robin partitioning deals rows out one at a time, so every partition gets the same share of 259 million. And the tasks do not die one by one: all eight attempts on an executor fail in the same second, because they die with the executor."
  },

  fix: {
    text: "Stream instead of materialising. The profiler builds [row.asDict() for row in rows] before counting anything, " +
          "so each task holds its whole partition, about 32 million Python dictionaries, in memory. Spark can spill " +
          "its own sorts and aggregations; it cannot spill a Python list. A generator, (row.asDict() for row in rows), " +
          "keeps one row at a time. Same input, same eight partitions, same pool. More memory or more partitions would " +
          "only postpone the kill.",
    before: "Killed twice, no report after 14 min",
    after: "Completes in 10 min 32 s"
  }
}),

/* ========================================================== TALK CASE 3 == */
fromLog(TALK_UI.case3, {
  set: "talk",
  id: "one-writer",
  title: "One writer, seven idle cores",
  subtitle: "Gzip CSV export for a partner, 2023 to 2024",
  brief: "A partner wants two years of trips as one gzip-compressed CSV with a header row. The export " +
         "selects ten columns, formats the two timestamps as text and writes the file. It takes nearly " +
         "ten minutes for 80 million rows, and the team is about to ask for a bigger Spark pool.",
  symptom: "79,479,946 rows, 1 file, 9 min 33 s runtime",
  question: "What is the primary cause of the runtime?",

  options: [
    { id: "a", text: "The write runs as a single task, so one core does all the work" },
    { id: "b", text: "The source table is split into too many small files" },
    { id: "c", text: "Data skew: one partition of trips is much larger than the others" },
    { id: "d", text: "Gzip compression spills to disk because the executor is short of memory" }
  ],
  answer: "a",

  evidence: [
    { tab: "Stages", text: "Stage 4 runs 9.0 min and has exactly one task. It is 99.8% of the export query." },
    { tab: "Stage 4 detail", text: "Task 52 reads 1.4 GiB, 79,479,946 records, and writes 1.2 GiB of gzip CSV. GC takes 0.9 s, and there is no spill and no shuffle. The task is not struggling. It is alone." },
    { tab: "SQL", text: "The plan runs Scan parquet, Project, Coalesce 1, WriteFiles, with no Exchange. The scan reads 24 partitions from 29 files, and Coalesce folds them into one. Number of written files: 1." },
    { tab: "Diagnosis", text: "Executor Usage Analysis: 8 cores allocated, 1.0 in use on average, idle for 87% of the executor's lifetime." },
    { tab: "Executors", text: "One executor with 8 cores. During the export, seven of them have nothing to run." }
  ],

  wrongAnswers: {
    b: "The scan reads 29 files, 1.5 GiB in total: about 55 MiB a file. Its scan time is 27 s of a 538 s task.",
    c: "Skew needs a distribution to be uneven. Stage 4 has one task, so there is nothing to compare, and Diagnosis reports no skew for that reason.",
    d: "Spill (Memory) and Spill (Disk) are both zero, and GC time is under a second for a nine-minute task. It is compute-bound on a single core."
  },

  fix: {
    text: "Replace coalesce(1) with repartition(64) or more. The rows, the columns, CSV and gzip stay the same; the " +
          "output becomes a folder of part files written by 64 tasks in parallel. If the partner truly needs one " +
          "file, that requirement is the bottleneck: a single gzip stream cannot be written in parallel.",
    before: "9 min 33 s, one task on one core",
    note: "The event log for the fixed run is not part of this case file."
  }
}),

/* ================================================================ CASE 4 == */
{
  set: "new",
  id: "small-files",
  title: "Death by a thousand files",
  subtitle: "Bronze ingestion, every morning at 06:00",
  brief: "An upstream API drops a JSON file into a landing folder every few seconds. " +
         "A bronze notebook reads that folder and aggregates trips by route. " +
         "The folder holds 3 GiB. The notebook has crept from two minutes to over eight, " +
         "and the on-call engineer swears the code has not changed in months.",
  symptom: "3.0 GiB of input, 8 min 36 s runtime",
  question: "What is the primary cause of the runtime?",

  app: {
    id: "application_1741769642000_0031",
    name: "bronze_trips_ingest",
    user: "trusted-service-user",
    uptime: "8.6 min",
    uptimeMs: 516000,
    sparkVersion: "3.4.1",
    schedulingMode: "FIFO",
    completedJobs: 2
  },

  jobs: [
    { id: 0, description: "Listing leaf files and directories for 20000 paths",
      group: "json at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 09:14:05", startMs: 3000, endMs: 147000,
      duration: 144000, stages: "1/1", stageIds: [0], tasksDone: 32, tasksTotal: 32 },
    { id: 1, description: "parquet at NativeMethodAccessorImpl.java:0",
      group: "CASE 4 BAD: small-file landing zone",
      submitted: "2026/03/12 09:16:33", startMs: 151000, endMs: 507000,
      duration: 356000, stages: "2/2", stageIds: [1, 2], tasksDone: 825, tasksTotal: 825 }
  ],

  stages: [
    { id: 0, attempt: 0, description: "Listing leaf files and directories for 20000 paths",
      submitted: "2026/03/12 09:14:05", duration: 144000, tasksDone: 32, tasksTotal: 32,
      input: 0, inputRecords: 0, output: 0, shuffleRead: 0, shuffleWrite: 0, spill: 0,
      status: "COMPLETE" },
    { id: 1, attempt: 0, description: "json at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 09:16:33", duration: 332000, tasksDone: 625, tasksTotal: 625,
      input: 3.0 * GIB, inputRecords: 10231455, output: 0,
      shuffleRead: 0, shuffleWrite: 1512 * KIB, spill: 0, status: "COMPLETE" },
    { id: 2, attempt: 0, description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 09:22:05", duration: 21000, tasksDone: 200, tasksTotal: 200,
      input: 0, inputRecords: 0, output: 412 * KIB,
      shuffleRead: 1512 * KIB, shuffleWrite: 0, spill: 0, status: "COMPLETE" }
  ],

  stageDetail: {
    0: {
      totalTaskTime: 4224000, localitySummary: "PROCESS_LOCAL: 32",
      input: 0, inputRecords: 0, shuffleWrite: 0, spill: 0,
      dag: [{ name: "Listing leaf files", detail: "32 partitions" }],
      summary: [
        { metric: "Duration", min: 121000, p25: 129000, median: 133000, p75: 138000, max: 142000, kind: "time" },
        { metric: "GC Time", min: 0, p25: 0, median: 0, p75: 40, max: 90, kind: "time" }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 8, taskTime: 1062000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "2", address: "10.0.0.8:41005", tasks: 8, taskTime: 1055000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "3", address: "10.0.0.9:39114", tasks: 8, taskTime: 1058000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "4", address: "10.0.0.10:44980", tasks: 8, taskTime: 1049000, input: 0, shuffleRead: 0, shuffleWrite: 0 }
      ],
      tasks: [
        T(0, 0, 0, "1", "10.0.0.7", "2026/03/12 09:14:06", 133000, 0, 0, 0, 0, 0, 0, 0),
        T(1, 1, 0, "2", "10.0.0.8", "2026/03/12 09:14:06", 129000, 0, 0, 0, 0, 0, 0, 0),
        T(2, 2, 0, "3", "10.0.0.9", "2026/03/12 09:14:06", 142000, 0, 0, 0, 0, 0, 0, 0),
        T(3, 3, 0, "4", "10.0.0.10", "2026/03/12 09:14:06", 121000, 0, 0, 0, 0, 0, 0, 0),
        T(4, 4, 0, "1", "10.0.0.7", "2026/03/12 09:14:06", 138000, 0, 0, 0, 0, 0, 0, 0),
        T(5, 5, 0, "2", "10.0.0.8", "2026/03/12 09:14:06", 131000, 40, 0, 0, 0, 0, 0, 0),
        T(6, 6, 0, "3", "10.0.0.9", "2026/03/12 09:14:06", 136000, 0, 0, 0, 0, 0, 0, 0),
        T(7, 7, 0, "4", "10.0.0.10", "2026/03/12 09:14:06", 127000, 0, 0, 0, 0, 0, 0, 0)
      ]
    },
    1: {
      totalTaskTime: 2988000, localitySummary: "PROCESS_LOCAL: 625",
      input: 3.0 * GIB, inputRecords: 10231455, shuffleWrite: 1512 * KIB, spill: 0,
      dag: [
        { name: "WholeStageCodegen (1)", detail: "Scan json" },
        { name: "HashAggregate", detail: "partial_count, partial_sum" },
        { name: "Exchange", detail: "hashpartitioning(200)" }
      ],
      summary: [
        { metric: "Duration", min: 1900, p25: 4100, median: 4800, p75: 5500, max: 9200, kind: "time" },
        { metric: "GC Time", min: 60, p25: 140, median: 190, p75: 260, max: 480, kind: "time" },
        { metric: "Input Size / Records", min: 4.1 * MIB, p25: 4.6 * MIB, median: 4.9 * MIB,
          p75: 5.1 * MIB, max: 5.4 * MIB, kind: "bytes",
          recMin: 13987, recP25: 15402, recMedian: 16371, recP75: 17110, recMax: 17902 },
        { metric: "Shuffle Write Size / Records", min: 2100, p25: 2320, median: 2478,
          p75: 2610, max: 2810, kind: "bytes",
          recMin: 34, recP25: 38, recMedian: 41, recP75: 43, recMax: 47 }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 157, taskTime: 751000, input: 771 * MIB, shuffleRead: 0, shuffleWrite: 381 * KIB },
        { exec: "2", address: "10.0.0.8:41005", tasks: 156, taskTime: 744000, input: 766 * MIB, shuffleRead: 0, shuffleWrite: 377 * KIB },
        { exec: "3", address: "10.0.0.9:39114", tasks: 156, taskTime: 749000, input: 768 * MIB, shuffleRead: 0, shuffleWrite: 378 * KIB },
        { exec: "4", address: "10.0.0.10:44980", tasks: 156, taskTime: 744000, input: 767 * MIB, shuffleRead: 0, shuffleWrite: 376 * KIB }
      ],
      tasks: [
        T(0, 32, 0, "1", "10.0.0.7", "2026/03/12 09:16:35", 4800, 180, 4.9 * MIB, 16371, 2478, 41, 0, 0),
        T(1, 33, 0, "2", "10.0.0.8", "2026/03/12 09:16:35", 5100, 210, 5.0 * MIB, 16688, 2510, 42, 0, 0),
        T(2, 34, 0, "3", "10.0.0.9", "2026/03/12 09:16:35", 4400, 150, 4.7 * MIB, 15702, 2402, 39, 0, 0),
        T(3, 35, 0, "4", "10.0.0.10", "2026/03/12 09:16:35", 4900, 190, 4.9 * MIB, 16410, 2481, 41, 0, 0),
        T(4, 36, 0, "1", "10.0.0.7", "2026/03/12 09:16:35", 5500, 260, 5.1 * MIB, 17110, 2610, 43, 0, 0),
        T(5, 37, 0, "2", "10.0.0.8", "2026/03/12 09:16:35", 3900, 120, 4.4 * MIB, 14801, 2298, 37, 0, 0),
        T(6, 38, 0, "3", "10.0.0.9", "2026/03/12 09:16:35", 4700, 170, 4.8 * MIB, 16104, 2455, 40, 0, 0),
        T(7, 39, 0, "4", "10.0.0.10", "2026/03/12 09:16:35", 9200, 480, 5.4 * MIB, 17902, 2810, 47, 0, 0),
        T(8, 40, 0, "1", "10.0.0.7", "2026/03/12 09:16:40", 4600, 160, 4.8 * MIB, 15988, 2440, 40, 0, 0),
        T(9, 41, 0, "2", "10.0.0.8", "2026/03/12 09:16:40", 5000, 200, 5.0 * MIB, 16554, 2497, 41, 0, 0),
        T(10, 42, 0, "3", "10.0.0.9", "2026/03/12 09:16:40", 4100, 140, 4.6 * MIB, 15402, 2320, 38, 0, 0),
        T(11, 43, 0, "4", "10.0.0.10", "2026/03/12 09:16:40", 4800, 180, 4.9 * MIB, 16299, 2470, 41, 0, 0),
        T(12, 44, 0, "1", "10.0.0.7", "2026/03/12 09:16:40", 1900, 60, 4.1 * MIB, 13987, 2100, 34, 0, 0),
        T(13, 45, 0, "2", "10.0.0.8", "2026/03/12 09:16:40", 5200, 220, 5.1 * MIB, 16903, 2544, 42, 0, 0),
        T(14, 46, 0, "3", "10.0.0.9", "2026/03/12 09:16:40", 4500, 160, 4.7 * MIB, 15810, 2418, 39, 0, 0),
        T(15, 47, 0, "4", "10.0.0.10", "2026/03/12 09:16:40", 4900, 190, 4.9 * MIB, 16388, 2483, 41, 0, 0),
        T(16, 48, 0, "1", "10.0.0.7", "2026/03/12 09:16:45", 5300, 230, 5.1 * MIB, 17001, 2560, 42, 0, 0),
        T(17, 49, 0, "2", "10.0.0.8", "2026/03/12 09:16:45", 4200, 140, 4.6 * MIB, 15511, 2350, 38, 0, 0),
        T(18, 50, 0, "3", "10.0.0.9", "2026/03/12 09:16:45", 4800, 180, 4.9 * MIB, 16360, 2476, 41, 0, 0),
        T(19, 51, 0, "4", "10.0.0.10", "2026/03/12 09:16:45", 5000, 200, 5.0 * MIB, 16601, 2502, 41, 0, 0)
      ]
    },
    2: {
      totalTaskTime: 19000, localitySummary: "PROCESS_LOCAL: 200",
      input: 0, inputRecords: 0, shuffleWrite: 0, spill: 0,
      dag: [
        { name: "Exchange", detail: "read 200 partitions" },
        { name: "HashAggregate", detail: "count, sum, avg" },
        { name: "WriteFiles", detail: "delta" }
      ],
      summary: [
        { metric: "Duration", min: 40, p25: 70, median: 90, p75: 110, max: 260, kind: "time" },
        { metric: "Shuffle Read Size / Records", min: 6100, p25: 7200, median: 7742,
          p75: 8100, max: 9400, kind: "bytes",
          recMin: 98, recP25: 118, recMedian: 128, recP75: 134, recMax: 156 }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 50, taskTime: 4800, input: 0, shuffleRead: 378 * KIB, shuffleWrite: 0 },
        { exec: "2", address: "10.0.0.8:41005", tasks: 50, taskTime: 4700, input: 0, shuffleRead: 377 * KIB, shuffleWrite: 0 },
        { exec: "3", address: "10.0.0.9:39114", tasks: 50, taskTime: 4900, input: 0, shuffleRead: 379 * KIB, shuffleWrite: 0 },
        { exec: "4", address: "10.0.0.10:44980", tasks: 50, taskTime: 4600, input: 0, shuffleRead: 378 * KIB, shuffleWrite: 0 }
      ],
      tasks: [
        T(0, 657, 0, "1", "10.0.0.7", "2026/03/12 09:22:05", 90, 0, 0, 0, 0, 0, 7742, 0),
        T(1, 658, 0, "2", "10.0.0.8", "2026/03/12 09:22:05", 110, 0, 0, 0, 0, 0, 8100, 0),
        T(2, 659, 0, "3", "10.0.0.9", "2026/03/12 09:22:05", 70, 0, 0, 0, 0, 0, 7200, 0),
        T(3, 660, 0, "4", "10.0.0.10", "2026/03/12 09:22:05", 260, 40, 0, 0, 0, 0, 9400, 0),
        T(4, 661, 0, "1", "10.0.0.7", "2026/03/12 09:22:05", 80, 0, 0, 0, 0, 0, 7510, 0),
        T(5, 662, 0, "2", "10.0.0.8", "2026/03/12 09:22:05", 40, 0, 0, 0, 0, 0, 6100, 0),
        T(6, 663, 0, "3", "10.0.0.9", "2026/03/12 09:22:05", 95, 0, 0, 0, 0, 0, 7801, 0),
        T(7, 664, 0, "4", "10.0.0.10", "2026/03/12 09:22:05", 88, 0, 0, 0, 0, 0, 7690, 0)
      ]
    }
  },

  sql: [
    {
      id: 0,
      description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 09:14:04",
      duration: 502000,
      jobIds: [0, 1],
      graph: {
        clusters: {
          1: { name: "WholeStageCodegen (1)", metrics: [
            ["duration", "47.3 m", "1.8 s", "4.7 s", "9.0 s", "stage 1.0: task 39"]] },
          2: { name: "WholeStageCodegen (2)", metrics: [
            ["duration", "11.2 s", "31 ms", "70 ms", "231 ms", "stage 2.0: task 660"]] }
        },
        nodes: [
          { id: 1, name: "Scan json", cluster: 1, metrics: [
            ["number of output rows", "10,231,455"],
            ["number of files read", "20,000"],
            ["metadata time", "2.4 m"],
            ["size of files read", "3.0 GiB"]] },
          { id: 2, name: "Project", cluster: 1, from: [1] },
          { id: 3, name: "HashAggregate", cluster: 1, from: [2], metrics: [
            ["number of output rows", "25,612"],
            ["spill size", "0.0 B", "0.0 B", "0.0 B", "0.0 B", "stage 1.0: task 32"],
            ["time in aggregation build", "1.9 m", "38 ms", "176 ms", "402 ms", "stage 1.0: task 39"],
            ["peak memory", "39.2 GiB", "64.3 MiB", "64.3 MiB", "64.3 MiB", "stage 1.0: task 32"],
            ["number of sort fallback tasks", "0"]] },
          { id: 4, name: "Exchange", from: [3], metrics: [
            ["shuffle records written", "25,612"],
            ["shuffle write time", "1.1 s", "1 ms", "1 ms", "9 ms", "stage 1.0: task 39"],
            ["records read", "25,612"],
            ["local bytes read", "378.0 KiB", "1473.0 B", "1935.0 B", "2.3 KiB", "stage 2.0: task 660"],
            ["remote bytes read", "1134.0 KiB", "4.5 KiB", "5.7 KiB", "7.0 KiB", "stage 2.0: task 660"],
            ["fetch wait time", "0 ms", "0 ms", "0 ms", "0 ms", "stage 2.0: task 657"],
            ["data size", "2.3 MiB", "3.3 KiB", "3.8 KiB", "4.3 KiB", "stage 1.0: task 39"],
            ["number of partitions", "200"],
            ["shuffle bytes written", "1512.0 KiB", "2.1 KiB", "2.4 KiB", "2.7 KiB", "stage 1.0: task 39"]] },
          { id: 5, name: "HashAggregate", cluster: 2, from: [4], metrics: [
            ["number of output rows", "4,870"],
            ["spill size", "0.0 B", "0.0 B", "0.0 B", "0.0 B", "stage 2.0: task 657"],
            ["time in aggregation build", "2.6 s", "4 ms", "11 ms", "58 ms", "stage 2.0: task 660"],
            ["peak memory", "12.6 GiB", "64.3 MiB", "64.3 MiB", "64.3 MiB", "stage 2.0: task 657"],
            ["number of sort fallback tasks", "0"]] },
          { id: 6, name: "WriteFiles", from: [5], metrics: [
            ["number of written files", "200"],
            ["written output", "412.0 KiB", "1937.0 B", "2.1 KiB", "2.6 KiB", "stage 2.0: task 660"],
            ["number of output rows", "4,870"],
            ["number of dynamic part", "0"]] }
        ]
      },
      plan:
"== Physical Plan ==\n" +
"AdaptiveSparkPlan (7)\n" +
"+- == Final Plan ==\n" +
"   WriteFiles (6)\n" +
"   +- HashAggregate (5)\n" +
"      +- Exchange (4)\n" +
"         +- HashAggregate (3)\n" +
"            +- Project (2)\n" +
"               +- Scan json  (1)\n" +
"\n" +
"\n" +
"(1) Scan json\n" +
"Output [4]: [PULocationID#12, DOLocationID#13, trip_distance#16, total_amount#21]\n" +
"Batched: false\n" +
"Location: InMemoryFileIndex(1 paths)[abfss://demo@onelake.dfs.fabric.microsoft.com/\n" +
"          lakehouse.Lakehouse/Files/nyc_taxi/landing/trips_json]\n" +
"Number of files read: 20000\n" +
"Size of files read: 3.0 GiB\n" +
"PartitionFilters: []\n" +
"PushedFilters: []\n" +
"ReadSchema: struct<PULocationID:int,DOLocationID:int,trip_distance:double,total_amount:double>\n" +
"\n" +
"(3) HashAggregate\n" +
"Input [4]: [PULocationID#12, DOLocationID#13, trip_distance#16, total_amount#21]\n" +
"Keys [2]: [PULocationID#12, DOLocationID#13]\n" +
"Functions [3]: [partial_count(1), partial_sum(total_amount#21), partial_avg(trip_distance#16)]\n" +
"\n" +
"(4) Exchange\n" +
"Input [5]: [PULocationID#12, DOLocationID#13, count#44L, sum#45, avg#46]\n" +
"Arguments: hashpartitioning(PULocationID#12, DOLocationID#13, 200), ENSURE_REQUIREMENTS\n"
    }
  ],

  executors: {
    summary: { activeExecutors: 4, deadExecutors: 0, totalCores: 32,
               totalTasks: 857, totalTaskTime: 3007000, totalGcTime: 121000,
               totalInput: 3.0 * GIB, totalShuffleRead: 1512 * KIB, totalShuffleWrite: 1512 * KIB },
    list: [
      { id: "driver", address: "10.0.0.4:41221", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 0, totalTasks: 0,
        taskTime: 0, gcTime: 4200, input: 0, shuffleRead: 0, shuffleWrite: 0 },
      { id: "1", address: "10.0.0.7:38221", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 215, totalTasks: 215,
        taskTime: 755800, gcTime: 30400, input: 771 * MIB, shuffleRead: 378 * KIB, shuffleWrite: 381 * KIB },
      { id: "2", address: "10.0.0.8:41005", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 214, totalTasks: 214,
        taskTime: 748700, gcTime: 29900, input: 766 * MIB, shuffleRead: 377 * KIB, shuffleWrite: 377 * KIB },
      { id: "3", address: "10.0.0.9:39114", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 214, totalTasks: 214,
        taskTime: 753900, gcTime: 30600, input: 768 * MIB, shuffleRead: 379 * KIB, shuffleWrite: 378 * KIB },
      { id: "4", address: "10.0.0.10:44980", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 214, totalTasks: 214,
        taskTime: 748600, gcTime: 30100, input: 767 * MIB, shuffleRead: 378 * KIB, shuffleWrite: 376 * KIB }
    ]
  },

  environment: COMMON_ENVIRONMENT,

  diagnosis: {
    dataSkew: { severity: "ok", headline: "No data skew detected",
      detail: "No stage has a task reading more than 2x the median partition size." },
    timeSkew: { severity: "ok", headline: "No time skew detected",
      detail: "The longest task in every stage finishes within 2x the stage median." },
    executorUsage: { severity: "warning", headline: "Allocated cores idle 31% of the application runtime",
      detail: "Cores sit unused during file listing and during the final 200-task stage.",
      rows: [["Allocated cores", "32"], ["Average cores in use", "22.1"],
             ["Idle core-minutes", "84.6"], ["Longest idle window", "38 s"]] }
  },

  options: [
    { id: "a", text: "Data skew: one route key dominates the aggregation" },
    { id: "b", text: "The job reads twenty thousand tiny input files" },
    { id: "c", text: "Shuffle spill caused by too few shuffle partitions" },
    { id: "d", text: "A single output task compresses the whole result" }
  ],
  answer: "b",

  evidence: [
    { tab: "Jobs", text: "A whole job exists just to list files: \"Listing leaf files and directories for 20000 paths\", 2.4 minutes before any data is read." },
    { tab: "Stages", text: "The scan stage runs 625 tasks for 3.0 GiB. A well-packed Parquet or Delta read of that volume would use around 24." },
    { tab: "Stage 1 detail", text: "The median task reads 4.9 MiB and takes 4.8 s. That time is not CPU, it is thirty-odd network round trips per task to open thirty-odd files." },
    { tab: "Executors", text: "Every executor is busy and none of them is achieving anything. High task counts, low throughput." }
  ],

  wrongAnswers: {
    a: "Check the Stage 1 summary metrics. Median duration 4.8 s, max 9.2 s, and input ranges from 4.1 to 5.4 MiB. That is an evenly split stage.",
    c: "No spill appears anywhere: not in the stage list, not in the summary metrics. The shuffle here is 1.5 MiB in total.",
    d: "The final write stage runs 200 tasks and finishes in 21 seconds. It is not where the time goes."
  },

  fix: {
    text: "Compact the landing zone into a Delta table and read that instead, or schedule OPTIMIZE against it. " +
          "Raising spark.sql.files.maxPartitionBytes does not rescue this: packing more tiny files per task keeps the same " +
          "number of network round trips and just moves them onto fewer tasks. The files themselves have to go.",
    before: "8 min 36 s",
    after: "41 s"
  }
},

/* ================================================================ CASE 5 == */
{
  set: "new",
  id: "missing-pruning",
  title: "The filter that never fired",
  subtitle: "Monthly revenue report, first working day of the month",
  brief: "A monthly report reads the trips table, filters to March 2024, and writes the " +
         "top 400 routes by revenue. The table is partitioned by pickup_year and pickup_month " +
         "and holds six years of history. The report produces 400 rows and takes nearly nine minutes. " +
         "Every task looks perfectly healthy.",
  symptom: "400 output rows, 8 min 54 s runtime",
  question: "What is the primary cause of the runtime?",

  app: {
    id: "application_1741769642000_0044",
    name: "monthly_route_revenue",
    user: "trusted-service-user",
    uptime: "9.2 min",
    uptimeMs: 552000,
    sparkVersion: "3.4.1",
    schedulingMode: "FIFO",
    completedJobs: 1
  },

  jobs: [
    { id: 0, description: "parquet at NativeMethodAccessorImpl.java:0",
      group: "CASE 5 BAD: monthly report without pruning",
      submitted: "2026/03/12 11:04:11", startMs: 8000, endMs: 542000,
      duration: 534000, stages: "2/2", stageIds: [0, 1], tasksDone: 572, tasksTotal: 572 }
  ],

  stages: [
    { id: 0, attempt: 0, description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 11:04:11", duration: 510000, tasksDone: 372, tasksTotal: 372,
      input: 48.6 * GIB, inputRecords: 251340682, output: 0,
      shuffleRead: 0, shuffleWrite: 2.4 * MIB, spill: 0, status: "COMPLETE" },
    { id: 1, attempt: 0, description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 11:12:41", duration: 16000, tasksDone: 200, tasksTotal: 200,
      input: 0, inputRecords: 0, output: 18 * KIB,
      shuffleRead: 2.4 * MIB, shuffleWrite: 0, spill: 0, status: "COMPLETE" }
  ],

  stageDetail: {
    0: {
      totalTaskTime: 4874000, localitySummary: "PROCESS_LOCAL: 372",
      input: 48.6 * GIB, inputRecords: 251340682, shuffleWrite: 2.4 * MIB, spill: 0,
      dag: [
        { name: "WholeStageCodegen (1)", detail: "Scan parquet" },
        { name: "Filter", detail: "date_format(...) = 2024-03" },
        { name: "HashAggregate", detail: "partial_count, partial_sum" },
        { name: "Exchange", detail: "hashpartitioning(200)" }
      ],
      summary: [
        { metric: "Duration", min: 9800, p25: 12400, median: 13100, p75: 13900, max: 17200, kind: "time" },
        { metric: "GC Time", min: 210, p25: 340, median: 410, p75: 480, max: 760, kind: "time" },
        { metric: "Input Size / Records", min: 118.4 * MIB, p25: 129.1 * MIB, median: 133.7 * MIB,
          p75: 137.9 * MIB, max: 141.2 * MIB, kind: "bytes",
          recMin: 612004, recP25: 667215, recMedian: 675647, recP75: 698330, recMax: 724881 },
        { metric: "Shuffle Write Size / Records", min: 5900, p25: 6400, median: 6771,
          p75: 7000, max: 7600, kind: "bytes",
          recMin: 118, recP25: 128, recMedian: 134, recP75: 139, recMax: 148 }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 93, taskTime: 1220000, input: 12.2 * GIB, shuffleRead: 0, shuffleWrite: 615 * KIB },
        { exec: "2", address: "10.0.0.8:41005", tasks: 93, taskTime: 1218000, input: 12.1 * GIB, shuffleRead: 0, shuffleWrite: 613 * KIB },
        { exec: "3", address: "10.0.0.9:39114", tasks: 93, taskTime: 1219000, input: 12.2 * GIB, shuffleRead: 0, shuffleWrite: 614 * KIB },
        { exec: "4", address: "10.0.0.10:44980", tasks: 93, taskTime: 1217000, input: 12.1 * GIB, shuffleRead: 0, shuffleWrite: 612 * KIB }
      ],
      tasks: [
        T(0, 0, 0, "1", "10.0.0.7", "2026/03/12 11:04:13", 13100, 410, 133.7 * MIB, 675647, 6771, 134, 0, 0),
        T(1, 1, 0, "2", "10.0.0.8", "2026/03/12 11:04:13", 12800, 380, 132.2 * MIB, 669412, 6702, 133, 0, 0),
        T(2, 2, 0, "3", "10.0.0.9", "2026/03/12 11:04:13", 13400, 430, 135.1 * MIB, 681904, 6820, 135, 0, 0),
        T(3, 3, 0, "4", "10.0.0.10", "2026/03/12 11:04:13", 12400, 340, 129.1 * MIB, 667215, 6400, 128, 0, 0),
        T(4, 4, 0, "1", "10.0.0.7", "2026/03/12 11:04:13", 13900, 480, 137.9 * MIB, 698330, 7000, 139, 0, 0),
        T(5, 5, 0, "2", "10.0.0.8", "2026/03/12 11:04:13", 9800, 210, 118.4 * MIB, 612004, 5900, 118, 0, 0),
        T(6, 6, 0, "3", "10.0.0.9", "2026/03/12 11:04:13", 13200, 420, 134.0 * MIB, 677001, 6790, 134, 0, 0),
        T(7, 7, 0, "4", "10.0.0.10", "2026/03/12 11:04:13", 17200, 760, 141.2 * MIB, 724881, 7600, 148, 0, 0),
        T(8, 8, 0, "1", "10.0.0.7", "2026/03/12 11:04:26", 13000, 400, 133.1 * MIB, 674110, 6740, 133, 0, 0),
        T(9, 9, 0, "2", "10.0.0.8", "2026/03/12 11:04:26", 13300, 440, 134.8 * MIB, 680233, 6810, 135, 0, 0),
        T(10, 10, 0, "3", "10.0.0.9", "2026/03/12 11:04:26", 12600, 360, 130.4 * MIB, 662870, 6580, 130, 0, 0),
        T(11, 11, 0, "4", "10.0.0.10", "2026/03/12 11:04:26", 13100, 410, 133.5 * MIB, 675002, 6768, 134, 0, 0),
        T(12, 12, 0, "1", "10.0.0.7", "2026/03/12 11:04:26", 13700, 470, 136.9 * MIB, 691447, 6940, 138, 0, 0),
        T(13, 13, 0, "2", "10.0.0.8", "2026/03/12 11:04:26", 12500, 350, 129.9 * MIB, 660118, 6510, 129, 0, 0),
        T(14, 14, 0, "3", "10.0.0.9", "2026/03/12 11:04:26", 13100, 410, 133.6 * MIB, 675588, 6772, 134, 0, 0),
        T(15, 15, 0, "4", "10.0.0.10", "2026/03/12 11:04:26", 12900, 390, 132.8 * MIB, 671209, 6730, 133, 0, 0),
        T(16, 16, 0, "1", "10.0.0.7", "2026/03/12 11:04:39", 13200, 420, 134.1 * MIB, 677804, 6795, 134, 0, 0),
        T(17, 17, 0, "2", "10.0.0.8", "2026/03/12 11:04:39", 13600, 460, 136.2 * MIB, 688330, 6900, 137, 0, 0),
        T(18, 18, 0, "3", "10.0.0.9", "2026/03/12 11:04:39", 12700, 370, 131.0 * MIB, 664901, 6620, 131, 0, 0),
        T(19, 19, 0, "4", "10.0.0.10", "2026/03/12 11:04:39", 13100, 410, 133.7 * MIB, 675901, 6774, 134, 0, 0)
      ]
    },
    1: {
      totalTaskTime: 14000, localitySummary: "PROCESS_LOCAL: 200",
      input: 0, inputRecords: 0, shuffleWrite: 0, spill: 0,
      dag: [
        { name: "Exchange", detail: "read 200 partitions" },
        { name: "HashAggregate", detail: "count, sum, avg" },
        { name: "TakeOrderedAndProject", detail: "limit 400" },
        { name: "WriteFiles", detail: "delta" }
      ],
      summary: [
        { metric: "Duration", min: 30, p25: 50, median: 70, p75: 90, max: 210, kind: "time" },
        { metric: "Shuffle Read Size / Records", min: 9800, p25: 11400, median: 12288,
          p75: 13100, max: 15200, kind: "bytes",
          recMin: 196, recP25: 228, recMedian: 246, recP75: 262, recMax: 304 }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 50, taskTime: 3600, input: 0, shuffleRead: 615 * KIB, shuffleWrite: 0 },
        { exec: "2", address: "10.0.0.8:41005", tasks: 50, taskTime: 3500, input: 0, shuffleRead: 613 * KIB, shuffleWrite: 0 },
        { exec: "3", address: "10.0.0.9:39114", tasks: 50, taskTime: 3400, input: 0, shuffleRead: 614 * KIB, shuffleWrite: 0 },
        { exec: "4", address: "10.0.0.10:44980", tasks: 50, taskTime: 3500, input: 0, shuffleRead: 612 * KIB, shuffleWrite: 0 }
      ],
      tasks: [
        T(0, 372, 0, "1", "10.0.0.7", "2026/03/12 11:12:41", 70, 0, 0, 0, 0, 0, 12288, 0),
        T(1, 373, 0, "2", "10.0.0.8", "2026/03/12 11:12:41", 90, 0, 0, 0, 0, 0, 13100, 0),
        T(2, 374, 0, "3", "10.0.0.9", "2026/03/12 11:12:41", 50, 0, 0, 0, 0, 0, 11400, 0),
        T(3, 375, 0, "4", "10.0.0.10", "2026/03/12 11:12:41", 210, 20, 0, 0, 0, 0, 15200, 0),
        T(4, 376, 0, "1", "10.0.0.7", "2026/03/12 11:12:41", 60, 0, 0, 0, 0, 0, 11900, 0),
        T(5, 377, 0, "2", "10.0.0.8", "2026/03/12 11:12:41", 30, 0, 0, 0, 0, 0, 9800, 0),
        T(6, 378, 0, "3", "10.0.0.9", "2026/03/12 11:12:41", 75, 0, 0, 0, 0, 0, 12500, 0),
        T(7, 379, 0, "4", "10.0.0.10", "2026/03/12 11:12:41", 65, 0, 0, 0, 0, 0, 12100, 0)
      ]
    }
  },

  sql: [
    {
      id: 0,
      description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 11:04:10",
      duration: 534000,
      jobIds: [0],
      graph: {
        clusters: {
          1: { name: "WholeStageCodegen (1)", metrics: [
            ["duration", "79.6 m", "9.5 s", "12.8 s", "16.9 s", "stage 0.0: task 7"]] },
          2: { name: "WholeStageCodegen (2)", metrics: [
            ["duration", "9.4 s", "18 ms", "44 ms", "162 ms", "stage 1.0: task 375"]] }
        },
        nodes: [
          { id: 1, name: "Scan parquet spark_catalog.default.nyc_yellow_trips", metrics: [
            ["number of output rows", "251,340,682"],
            ["number of files read", "2,847"],
            ["number of partitions read", "72"],
            ["metadata time", "214 ms"],
            ["size of files read", "48.6 GiB"],
            ["scan time", "61.3 m", "7.3 s", "9.9 s", "13.0 s", "stage 0.0: task 7"]] },
          { id: 2, name: "Filter", cluster: 1, from: [1], metrics: [
            ["number of output rows", "3,582,628"]] },
          { id: 3, name: "Project", cluster: 1, from: [2] },
          { id: 4, name: "HashAggregate", cluster: 1, from: [3], metrics: [
            ["number of output rows", "49,861"],
            ["spill size", "0.0 B", "0.0 B", "0.0 B", "0.0 B", "stage 0.0: task 0"],
            ["time in aggregation build", "1.3 m", "153 ms", "214 ms", "288 ms", "stage 0.0: task 7"],
            ["peak memory", "23.4 GiB", "64.3 MiB", "64.3 MiB", "64.3 MiB", "stage 0.0: task 0"],
            ["number of sort fallback tasks", "0"]] },
          { id: 5, name: "Exchange", from: [4], metrics: [
            ["shuffle records written", "49,861"],
            ["shuffle write time", "1.9 s", "3 ms", "5 ms", "14 ms", "stage 0.0: task 7"],
            ["records read", "49,861"],
            ["local bytes read", "615.0 KiB", "2.4 KiB", "3.1 KiB", "3.8 KiB", "stage 1.0: task 375"],
            ["remote bytes read", "1.8 MiB", "7.2 KiB", "8.9 KiB", "11.0 KiB", "stage 1.0: task 375"],
            ["fetch wait time", "0 ms", "0 ms", "0 ms", "0 ms", "stage 1.0: task 372"],
            ["data size", "3.7 MiB", "9.1 KiB", "10.4 KiB", "11.7 KiB", "stage 0.0: task 7"],
            ["number of partitions", "200"],
            ["shuffle bytes written", "2.4 MiB", "5.8 KiB", "6.6 KiB", "7.4 KiB", "stage 0.0: task 7"]] },
          { id: 6, name: "HashAggregate", cluster: 2, from: [5], metrics: [
            ["number of output rows", "7,164"],
            ["spill size", "0.0 B", "0.0 B", "0.0 B", "0.0 B", "stage 1.0: task 372"],
            ["time in aggregation build", "1.7 s", "2 ms", "7 ms", "41 ms", "stage 1.0: task 375"],
            ["peak memory", "12.6 GiB", "64.3 MiB", "64.3 MiB", "64.3 MiB", "stage 1.0: task 372"],
            ["number of sort fallback tasks", "0"]] },
          { id: 7, name: "TakeOrderedAndProject", from: [6] },
          { id: 8, name: "WriteFiles", from: [7], metrics: [
            ["number of written files", "1"],
            ["written output", "18.0 KiB", "0.0 B", "0.0 B", "18.0 KiB", "stage 1.0: task 372"],
            ["number of output rows", "400"],
            ["number of dynamic part", "0"]] }
        ]
      },
      plan:
"== Physical Plan ==\n" +
"AdaptiveSparkPlan (9)\n" +
"+- == Final Plan ==\n" +
"   WriteFiles (8)\n" +
"   +- TakeOrderedAndProject (7)\n" +
"      +- HashAggregate (6)\n" +
"         +- Exchange (5)\n" +
"            +- HashAggregate (4)\n" +
"               +- Project (3)\n" +
"                  +- Filter (2)\n" +
"                     +- Scan parquet spark_catalog.default.nyc_yellow_trips (1)\n" +
"\n" +
"\n" +
"(1) Scan parquet spark_catalog.default.nyc_yellow_trips\n" +
"Output [6]: [PULocationID#12, DOLocationID#13, trip_distance#16, fare_amount#18,\n" +
"             total_amount#21, tpep_pickup_datetime#10]\n" +
"Batched: true\n" +
"Location: PreparedDeltaFileIndex [abfss://demo@onelake.dfs.fabric.microsoft.com/\n" +
"          lakehouse.Lakehouse/Tables/nyc_yellow_trips]\n" +
"Number of files read: 2847\n" +
"Size of files read: 48.6 GiB\n" +
"PartitionFilters: []\n" +
"PushedFilters: [IsNotNull(tpep_pickup_datetime)]\n" +
"ReadSchema: struct<PULocationID:int,DOLocationID:int,trip_distance:double,\n" +
"                   fare_amount:double,total_amount:double,tpep_pickup_datetime:timestamp>\n" +
"\n" +
"(2) Filter\n" +
"Input [6]: [PULocationID#12, DOLocationID#13, trip_distance#16, fare_amount#18,\n" +
"            total_amount#21, tpep_pickup_datetime#10]\n" +
"Condition : (isnotnull(tpep_pickup_datetime#10) AND\n" +
"            (date_format(tpep_pickup_datetime#10, yyyy-MM, Some(Etc/UTC)) = 2024-03))\n" +
"\n" +
"(4) HashAggregate\n" +
"Keys [2]: [PULocationID#12, DOLocationID#13]\n" +
"Functions [3]: [partial_count(1), partial_sum(total_amount#21), partial_avg(trip_distance#16)]\n" +
"\n" +
"(7) TakeOrderedAndProject\n" +
"Arguments: 400, [revenue#77 DESC NULLS LAST]\n"
    }
  ],

  executors: {
    summary: { activeExecutors: 4, deadExecutors: 0, totalCores: 32,
               totalTasks: 572, totalTaskTime: 4888000, totalGcTime: 154000,
               totalInput: 48.6 * GIB, totalShuffleRead: 2.4 * MIB, totalShuffleWrite: 2.4 * MIB },
    list: [
      { id: "driver", address: "10.0.0.4:41221", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 0, totalTasks: 0,
        taskTime: 0, gcTime: 3800, input: 0, shuffleRead: 0, shuffleWrite: 0 },
      { id: "1", address: "10.0.0.7:38221", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 143, totalTasks: 143,
        taskTime: 1223600, gcTime: 38700, input: 12.2 * GIB, shuffleRead: 615 * KIB, shuffleWrite: 615 * KIB },
      { id: "2", address: "10.0.0.8:41005", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 143, totalTasks: 143,
        taskTime: 1221500, gcTime: 38400, input: 12.1 * GIB, shuffleRead: 613 * KIB, shuffleWrite: 613 * KIB },
      { id: "3", address: "10.0.0.9:39114", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 143, totalTasks: 143,
        taskTime: 1222400, gcTime: 38600, input: 12.2 * GIB, shuffleRead: 614 * KIB, shuffleWrite: 614 * KIB },
      { id: "4", address: "10.0.0.10:44980", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 143, totalTasks: 143,
        taskTime: 1220500, gcTime: 38300, input: 12.1 * GIB, shuffleRead: 612 * KIB, shuffleWrite: 612 * KIB }
    ]
  },

  environment: COMMON_ENVIRONMENT,

  diagnosis: {
    dataSkew: { severity: "ok", headline: "No data skew detected",
      detail: "Partition sizes across the shuffle are within 6% of the median." },
    timeSkew: { severity: "ok", headline: "No time skew detected",
      detail: "The slowest task in stage 0 runs 1.3x the median." },
    executorUsage: { severity: "ok", headline: "Executor usage is healthy",
      detail: "Allocated cores were in use for 94% of the application runtime.",
      rows: [["Allocated cores", "32"], ["Average cores in use", "30.1"],
             ["Idle core-minutes", "9.8"], ["Longest idle window", "6 s"]] }
  },

  options: [
    { id: "a", text: "The report scans the entire table because the filter cannot prune partitions" },
    { id: "b", text: "A hot route key skews the aggregation" },
    { id: "c", text: "The table is made up of too many small files" },
    { id: "d", text: "The final write runs with a single task" }
  ],
  answer: "a",

  evidence: [
    { tab: "SQL", text: "The scan node reports PartitionFilters: [] on a table partitioned by pickup_year and pickup_month. Nothing was pruned." },
    { tab: "SQL", text: "The Filter node sits above the scan, and its condition is date_format(tpep_pickup_datetime, yyyy-MM) = 2024-03. A derived column cannot be used for pruning." },
    { tab: "SQL", text: "Scan output 251,340,682 rows, filter output 3,582,628. Spark read 251 million rows to keep 1.4% of them." },
    { tab: "Stages", text: "48.6 GiB of input for 400 output rows." },
    { tab: "Stage 0 detail", text: "Balanced tasks, no spill, no skew. This is what a healthy stage doing unnecessary work looks like." }
  ],

  wrongAnswers: {
    b: "Stage 0 summary metrics: median 13.1 s, max 17.2 s, input 118 to 141 MiB. Nothing is skewed. Diagnosis agrees, all three panels are clean.",
    c: "2,847 files for 48.6 GiB averages 17 MiB per file. That is a well-sized Delta table.",
    d: "The final stage runs 200 tasks in 16 seconds. It contributes 3% of the runtime."
  },

  fix: {
    text: "Add the partition columns to the predicate: where pickup_year = 2024 and pickup_month = 3. " +
          "Keep the original date_format condition so the output stays identical. The scan node then reports " +
          "PartitionFilters and reads one month instead of seventy-two. Nothing in the task metrics was ever going " +
          "to tell you this. Only the SQL plan does.",
    before: "8 min 54 s",
    after: "11 s"
  }
},

/* ================================================================ CASE 6 == */
{
  set: "new",
  id: "driver-bottleneck",
  title: "Nobody's working",
  subtitle: "Route revenue rollup, ad-hoc rerun",
  brief: "A rollup job runs for fourteen minutes. Somebody opens the Spark UI halfway through " +
         "and finds no active stage, no running task, and a cluster that looks asleep. " +
         "The team is drafting a support ticket about the capacity. Before they send it, " +
         "have a look at the run yourself.",
  symptom: "14 min runtime, 9 minutes with no active stage",
  question: "What is the primary cause of the runtime?",

  app: {
    id: "application_1741769642000_0052",
    name: "route_revenue_rollup",
    user: "trusted-service-user",
    uptime: "14 min",
    uptimeMs: 840000,
    sparkVersion: "3.4.1",
    schedulingMode: "FIFO",
    completedJobs: 2
  },

  jobs: [
    { id: 0, description: "collect at case6_bad.py:31",
      group: "CASE 6 BAD: aggregate on the driver",
      submitted: "2026/03/12 10:02:14", startMs: 14000, endMs: 104000,
      duration: 90000, stages: "1/1", stageIds: [0], tasksDone: 96, tasksTotal: 96 },
    { id: 1, description: "parquet at NativeMethodAccessorImpl.java:0",
      group: "CASE 6 BAD: aggregate on the driver",
      submitted: "2026/03/12 10:12:51", startMs: 651000, endMs: 675000,
      duration: 24000, stages: "1/1", stageIds: [1], tasksDone: 8, tasksTotal: 8 }
  ],

  stages: [
    { id: 0, attempt: 0, description: "collect at case6_bad.py:31",
      submitted: "2026/03/12 10:02:14", duration: 90000, tasksDone: 96, tasksTotal: 96,
      input: 9.8 * GIB, inputRecords: 41382904, output: 0,
      shuffleRead: 0, shuffleWrite: 0, spill: 0, status: "COMPLETE" },
    { id: 1, attempt: 0, description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 10:12:51", duration: 24000, tasksDone: 8, tasksTotal: 8,
      input: 0, inputRecords: 0, output: 84 * KIB,
      shuffleRead: 0, shuffleWrite: 0, spill: 0, status: "COMPLETE" }
  ],

  stageDetail: {
    0: {
      totalTaskTime: 864000, localitySummary: "PROCESS_LOCAL: 96",
      input: 9.8 * GIB, inputRecords: 41382904, shuffleWrite: 0, spill: 0,
      dag: [
        { name: "WholeStageCodegen (1)", detail: "Scan parquet" },
        { name: "Project", detail: "4 columns" },
        { name: "CollectLimit", detail: "collect to driver" }
      ],
      summary: [
        { metric: "Duration", min: 5100, p25: 8200, median: 9000, p75: 9800, max: 12400, kind: "time" },
        { metric: "GC Time", min: 140, p25: 260, median: 310, p75: 360, max: 520, kind: "time" },
        { metric: "Input Size / Records", min: 96.2 * MIB, p25: 102.4 * MIB, median: 104.5 * MIB,
          p75: 106.8 * MIB, max: 111.9 * MIB, kind: "bytes",
          recMin: 398112, recP25: 424330, recMedian: 431071, recP75: 442018, recMax: 462774 }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 24, taskTime: 216800, input: 2.4 * GIB, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "2", address: "10.0.0.8:41005", tasks: 24, taskTime: 215400, input: 2.5 * GIB, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "3", address: "10.0.0.9:39114", tasks: 24, taskTime: 216100, input: 2.4 * GIB, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "4", address: "10.0.0.10:44980", tasks: 24, taskTime: 215700, input: 2.5 * GIB, shuffleRead: 0, shuffleWrite: 0 }
      ],
      tasks: [
        T(0, 0, 0, "1", "10.0.0.7", "2026/03/12 10:02:16", 9000, 310, 104.5 * MIB, 431071, 0, 0, 0, 0),
        T(1, 1, 0, "2", "10.0.0.8", "2026/03/12 10:02:16", 8800, 290, 103.7 * MIB, 428004, 0, 0, 0, 0),
        T(2, 2, 0, "3", "10.0.0.9", "2026/03/12 10:02:16", 9400, 340, 106.1 * MIB, 438220, 0, 0, 0, 0),
        T(3, 3, 0, "4", "10.0.0.10", "2026/03/12 10:02:16", 8200, 260, 102.4 * MIB, 424330, 0, 0, 0, 0),
        T(4, 4, 0, "1", "10.0.0.7", "2026/03/12 10:02:16", 9800, 360, 106.8 * MIB, 442018, 0, 0, 0, 0),
        T(5, 5, 0, "2", "10.0.0.8", "2026/03/12 10:02:16", 5100, 140, 96.2 * MIB, 398112, 0, 0, 0, 0),
        T(6, 6, 0, "3", "10.0.0.9", "2026/03/12 10:02:16", 9100, 320, 104.9 * MIB, 433890, 0, 0, 0, 0),
        T(7, 7, 0, "4", "10.0.0.10", "2026/03/12 10:02:16", 12400, 520, 111.9 * MIB, 462774, 0, 0, 0, 0),
        T(8, 8, 0, "1", "10.0.0.7", "2026/03/12 10:02:25", 8900, 300, 104.1 * MIB, 429556, 0, 0, 0, 0),
        T(9, 9, 0, "2", "10.0.0.8", "2026/03/12 10:02:25", 9200, 330, 105.2 * MIB, 434771, 0, 0, 0, 0),
        T(10, 10, 0, "3", "10.0.0.9", "2026/03/12 10:02:25", 8600, 280, 103.0 * MIB, 425118, 0, 0, 0, 0),
        T(11, 11, 0, "4", "10.0.0.10", "2026/03/12 10:02:25", 9000, 310, 104.6 * MIB, 431402, 0, 0, 0, 0),
        T(12, 12, 0, "1", "10.0.0.7", "2026/03/12 10:02:25", 9600, 350, 106.4 * MIB, 440009, 0, 0, 0, 0),
        T(13, 13, 0, "2", "10.0.0.8", "2026/03/12 10:02:25", 8400, 270, 102.8 * MIB, 424901, 0, 0, 0, 0),
        T(14, 14, 0, "3", "10.0.0.9", "2026/03/12 10:02:25", 9000, 310, 104.5 * MIB, 431188, 0, 0, 0, 0),
        T(15, 15, 0, "4", "10.0.0.10", "2026/03/12 10:02:25", 8700, 290, 103.4 * MIB, 427330, 0, 0, 0, 0)
      ]
    },
    1: {
      totalTaskTime: 176000, localitySummary: "PROCESS_LOCAL: 8",
      input: 0, inputRecords: 0, shuffleWrite: 0, spill: 0,
      dag: [
        { name: "LocalTableScan", detail: "7,231 rows from the driver" },
        { name: "WriteFiles", detail: "delta" }
      ],
      summary: [
        { metric: "Duration", min: 19000, p25: 21000, median: 22000, p75: 23000, max: 24000, kind: "time" },
        { metric: "GC Time", min: 200, p25: 300, median: 340, p75: 400, max: 520, kind: "time" }
      ],
      byExecutor: [
        { exec: "1", address: "10.0.0.7:38221", tasks: 2, taskTime: 44000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "2", address: "10.0.0.8:41005", tasks: 2, taskTime: 44000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "3", address: "10.0.0.9:39114", tasks: 2, taskTime: 45000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
        { exec: "4", address: "10.0.0.10:44980", tasks: 2, taskTime: 43000, input: 0, shuffleRead: 0, shuffleWrite: 0 }
      ],
      tasks: [
        T(0, 96, 0, "1", "10.0.0.7", "2026/03/12 10:12:51", 22000, 340, 0, 0, 0, 0, 0, 0),
        T(1, 97, 0, "2", "10.0.0.8", "2026/03/12 10:12:51", 21000, 300, 0, 0, 0, 0, 0, 0),
        T(2, 98, 0, "3", "10.0.0.9", "2026/03/12 10:12:51", 24000, 520, 0, 0, 0, 0, 0, 0),
        T(3, 99, 0, "4", "10.0.0.10", "2026/03/12 10:12:51", 19000, 200, 0, 0, 0, 0, 0, 0),
        T(4, 100, 0, "1", "10.0.0.7", "2026/03/12 10:12:51", 23000, 400, 0, 0, 0, 0, 0, 0),
        T(5, 101, 0, "2", "10.0.0.8", "2026/03/12 10:12:51", 22000, 350, 0, 0, 0, 0, 0, 0),
        T(6, 102, 0, "3", "10.0.0.9", "2026/03/12 10:12:51", 21000, 310, 0, 0, 0, 0, 0, 0),
        T(7, 103, 0, "4", "10.0.0.10", "2026/03/12 10:12:51", 24000, 480, 0, 0, 0, 0, 0, 0)
      ]
    }
  },

  sql: [
    {
      id: 0,
      description: "collect at case6_bad.py:31",
      submitted: "2026/03/12 10:02:13",
      duration: 91000,
      jobIds: [0],
      graph: {
        clusters: {
          1: { name: "WholeStageCodegen (1)", metrics: [
            ["duration", "13.1 m", "4.6 s", "8.3 s", "11.6 s", "stage 0.0: task 7"]] }
        },
        nodes: [
          { id: 1, name: "Scan parquet spark_catalog.default.nyc_yellow_trips", metrics: [
            ["number of output rows", "41,382,904"],
            ["number of files read", "612"],
            ["number of partitions read", "1"],
            ["metadata time", "188 ms"],
            ["size of files read", "9.8 GiB"],
            ["scan time", "9.7 m", "3.4 s", "6.1 s", "8.5 s", "stage 0.0: task 7"]] },
          { id: 2, name: "Filter", cluster: 1, from: [1], metrics: [
            ["number of output rows", "41,382,904"]] },
          { id: 3, name: "Project", cluster: 1, from: [2] }
        ]
      },
      plan:
"== Physical Plan ==\n" +
"AdaptiveSparkPlan (4)\n" +
"+- == Final Plan ==\n" +
"   Project (3)\n" +
"   +- Filter (2)\n" +
"      +- Scan parquet spark_catalog.default.nyc_yellow_trips (1)\n" +
"\n" +
"\n" +
"(1) Scan parquet spark_catalog.default.nyc_yellow_trips\n" +
"Output [4]: [PULocationID#12, DOLocationID#13, trip_distance#16, total_amount#21]\n" +
"Batched: true\n" +
"Location: PreparedDeltaFileIndex [abfss://demo@onelake.dfs.fabric.microsoft.com/\n" +
"          lakehouse.Lakehouse/Tables/nyc_yellow_trips]\n" +
"PartitionFilters: [(pickup_year#30 = 2024), (pickup_month#31 = 1)]\n" +
"PushedFilters: [IsNotNull(tpep_pickup_datetime)]\n" +
"Number of files read: 612\n" +
"Size of files read: 9.8 GiB\n"
    },
    {
      id: 1,
      description: "parquet at NativeMethodAccessorImpl.java:0",
      submitted: "2026/03/12 10:12:50",
      duration: 25000,
      jobIds: [1],
      graph: {
        nodes: [
          { id: 1, name: "LocalTableScan", metrics: [
            ["number of output rows", "7,231"]] },
          { id: 2, name: "WriteFiles", from: [1], metrics: [
            ["number of written files", "8"],
            ["written output", "84.2 KiB", "9.8 KiB", "10.5 KiB", "11.4 KiB", "stage 1.0: task 98"],
            ["number of output rows", "7,231"],
            ["number of dynamic part", "0"]] }
        ]
      },
      plan:
"== Physical Plan ==\n" +
"AdaptiveSparkPlan (3)\n" +
"+- == Final Plan ==\n" +
"   WriteFiles (2)\n" +
"   +- LocalTableScan (1)\n" +
"\n" +
"\n" +
"(1) LocalTableScan\n" +
"Output [5]: [PULocationID#210, DOLocationID#211, trips#212L, revenue#213,\n" +
"             average_distance#214]\n" +
"Arguments: [PULocationID#210, DOLocationID#211, trips#212L, revenue#213,\n" +
"            average_distance#214]\n" +
"Number of rows: 7231\n" +
"\n" +
"-- LocalTableScan means these rows were shipped from the driver, not read from storage.\n"
    }
  ],

  executors: {
    summary: { activeExecutors: 4, deadExecutors: 0, totalCores: 32,
               totalTasks: 104, totalTaskTime: 1040000, totalGcTime: 425000,
               totalInput: 9.8 * GIB, totalShuffleRead: 0, totalShuffleWrite: 0 },
    list: [
      { id: "driver", address: "10.0.0.4:41221", status: "Active", rddBlocks: 0,
        storageMemory: 7.4 * GIB, storageMemoryTotal: 8 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 0, totalTasks: 0,
        taskTime: 0, gcTime: 408000, input: 0, shuffleRead: 0, shuffleWrite: 0 },
      { id: "1", address: "10.0.0.7:38221", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 26, totalTasks: 26,
        taskTime: 260800, gcTime: 4300, input: 2.4 * GIB, shuffleRead: 0, shuffleWrite: 0 },
      { id: "2", address: "10.0.0.8:41005", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 26, totalTasks: 26,
        taskTime: 259400, gcTime: 4100, input: 2.5 * GIB, shuffleRead: 0, shuffleWrite: 0 },
      { id: "3", address: "10.0.0.9:39114", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 26, totalTasks: 26,
        taskTime: 261100, gcTime: 4400, input: 2.4 * GIB, shuffleRead: 0, shuffleWrite: 0 },
      { id: "4", address: "10.0.0.10:44980", status: "Active", rddBlocks: 0,
        storageMemory: 0, storageMemoryTotal: 32 * GIB, diskUsed: 0, cores: 8,
        activeTasks: 0, failedTasks: 0, completeTasks: 26, totalTasks: 26,
        taskTime: 258700, gcTime: 4000, input: 2.5 * GIB, shuffleRead: 0, shuffleWrite: 0 }
    ]
  },

  environment: COMMON_ENVIRONMENT.concat([["spark.driver.maxResultSize", "8g"]]),

  diagnosis: {
    dataSkew: { severity: "ok", headline: "No data skew detected",
      detail: "Input sizes across stage 0 tasks vary by less than 15%." },
    timeSkew: { severity: "ok", headline: "No time skew detected",
      detail: "The slowest task in stage 0 runs 1.4x the median." },
    executorUsage: { severity: "critical", headline: "Executors idle for 65% of the application runtime",
      detail: "No task ran between 10:03:44 and 10:12:51. All four executors held their cores and did nothing.",
      rows: [["Allocated cores", "32"], ["Average cores in use", "3.9"],
             ["Idle core-minutes", "291.2"], ["Longest idle window", "9.1 min"]] }
  },

  options: [
    { id: "a", text: "The scan stage is skewed across partitions" },
    { id: "b", text: "The job spends nine minutes on the driver while every executor sits idle" },
    { id: "c", text: "The cluster is under-provisioned for the input volume" },
    { id: "d", text: "The write stage is bottlenecked on a single task" }
  ],
  answer: "b",

  evidence: [
    { tab: "Jobs", text: "Job 0 ends at 10:03:44. Job 1 starts at 10:12:51. Nine minutes of wall clock belong to no job at all." },
    { tab: "Executors", text: "Zero active tasks everywhere, and the driver reports 6.8 min of GC time with 7.4 GiB of 8 GiB storage memory used. The driver was the only thing working." },
    { tab: "SQL", text: "Query 1's plan begins with LocalTableScan of 7,231 rows. Those rows were shipped from the driver, so the aggregation happened there rather than in Spark." },
    { tab: "Stage 0 detail", text: "The collect stage is balanced and healthy. It is the slowest stage, and it is not the problem." }
  ],

  wrongAnswers: {
    a: "Stage 0: median 9.0 s, max 12.4 s, input 96 to 112 MiB per task. That is the slowest stage in the run, which is exactly why it is the trap. The nine missing minutes sit outside any stage.",
    c: "The executors are idle, not saturated. Doubling the cluster would leave twice as many cores waiting on the same single-threaded Python loop.",
    d: "The write runs 8 tasks in 24 seconds. Even at one task it would not explain nine minutes."
  },

  fix: {
    text: "Express the aggregation in Spark: groupBy(\"PULocationID\", \"DOLocationID\").agg(...). " +
          "Nothing crosses back to the driver, the executors stay busy from the first task to the last, " +
          "and the gap in the timeline disappears. Whenever the Spark UI shows a stretch with no active stage, " +
          "stop looking at stages. Look at what the driver is doing.",
    before: "13 min 48 s",
    after: "1 min 12 s"
  }
}

];

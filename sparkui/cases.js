/* Spark UI Detective - case data
 *
 * MOCK DATA. Every number here is placeholder. Replace with values captured from
 * the real runs of case4_small_files, case5_missing_pruning and
 * case6_driver_bottleneck. The renderer in app.js never assumes anything about
 * the content, so you can edit this file alone.
 *
 * Units: bytes for sizes, milliseconds for durations, raw integers for records.
 * app.js formats them the way Spark does (GiB / MiB / KiB, "4.8 s", "2.4 min").
 *
 * Task rows use the compact T() helper below so a captured task table stays one
 * line per task and is easy to paste over.
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

/* ================================================================ CASE 4 == */
{
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
      metrics: [
        ["number of files read", "20,000"],
        ["size of files read", "3.0 GiB"],
        ["metadata time", "2.4 min"],
        ["number of output rows", "10,231,455"]
      ],
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
      metrics: [
        ["number of files read", "2,847"],
        ["size of files read", "48.6 GiB"],
        ["number of output rows (scan)", "251,340,682"],
        ["number of output rows (filter)", "3,582,628"],
        ["number of output rows (write)", "400"]
      ],
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
      metrics: [
        ["number of files read", "612"],
        ["size of files read", "9.8 GiB"],
        ["number of output rows", "41,382,904"]
      ],
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
      metrics: [
        ["number of output rows", "7,231"],
        ["written output", "84.2 KiB"]
      ],
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

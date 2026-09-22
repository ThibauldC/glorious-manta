"""Case 5 bad run: a derived-column filter defeats partition pruning.

Quiz-only case. Do not present this in the talk.

nyc_yellow_trips is partitioned by pickup_year and pickup_month. This report wants
one month. It filters on date_format(tpep_pickup_datetime), which is honest-looking
code that plenty of production pipelines ship. Neither partition column appears in
the predicate, so Spark reads all six years and throws away 99% of it.

What the Spark UI should show:
  SQL       the scan node reports PartitionFilters: [] and the full file count
  SQL       the Filter node sits above the scan, so filtering happens after reading
  Stages    enormous input for a few hundred output rows
  Tasks     perfectly balanced, no spill, no skew: everything looks healthy

That last line is the point. Nothing in the task metrics is wrong. Only the volume
of data read is wrong, and you can only see that in the SQL plan.
"""

import time

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.getOrCreate()

TRIP_TABLE = "nyc_yellow_trips"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case5/bad"
REPORT_MONTH = "2024-03"

spark.sparkContext.setJobDescription("CASE 5 BAD: monthly report without pruning")

trips = (spark.table(TRIP_TABLE)
         .where(F.col("tpep_pickup_datetime").isNotNull())
         .where(F.date_format("tpep_pickup_datetime", "yyyy-MM") == REPORT_MONTH)
         .select("PULocationID", "DOLocationID", "trip_distance",
                 "fare_amount", "total_amount"))

report = (trips.groupBy("PULocationID", "DOLocationID")
          .agg(F.count("*").alias("trips"),
               F.sum("total_amount").alias("revenue"),
               F.avg("trip_distance").alias("average_distance"))
          .orderBy(F.col("revenue").desc())
          .limit(400))

started = time.perf_counter()
(report.write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(OUTPUT_PATH))
print(f"CASE 5 BAD: {time.perf_counter() - started:.1f}s for report month {REPORT_MONTH}")

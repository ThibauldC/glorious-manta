"""Case 5 fixed run: add the partition columns to the predicate.

Quiz-only case. Do not present this in the talk.

The date_format predicate stays, so the output rows are byte for byte identical to
the bad run. The extra predicate on pickup_year and pickup_month is what lets Spark
prune, and the scan node now reports PartitionFilters instead of an empty list.

Verify the two outputs match before you trust the timing:

    bad = spark.read.format("delta").load("Files/nyc_taxi/demo_outputs/case5/bad")
    fixed = spark.read.format("delta").load("Files/nyc_taxi/demo_outputs/case5/fixed")
    assert bad.exceptAll(fixed).count() == 0 and fixed.exceptAll(bad).count() == 0
"""

import time

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.getOrCreate()

TRIP_TABLE = "nyc_yellow_trips"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case5/fixed"
REPORT_MONTH = "2024-03"
REPORT_YEAR = 2024
REPORT_MONTH_NUMBER = 3

spark.sparkContext.setJobDescription("CASE 5 FIXED: monthly report with pruning")

trips = (spark.table(TRIP_TABLE)
         .where((F.col("pickup_year") == REPORT_YEAR)
                & (F.col("pickup_month") == REPORT_MONTH_NUMBER))
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
print(f"CASE 5 FIXED: {time.perf_counter() - started:.1f}s for report month {REPORT_MONTH}")

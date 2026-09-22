"""Case 6 fixed run: keep the aggregation in Spark.

Quiz-only case. Do not present this in the talk.

Same rows, same columns, same output schema. Nothing crosses back to the driver, so
the executors stay busy from the first task to the last and the timeline has no gap.
"""

import time

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.getOrCreate()

TRIP_TABLE = "nyc_yellow_trips"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case6/fixed"
DEMO_YEAR = 2024
DEMO_MONTHS = (1,)

spark.sparkContext.setJobDescription("CASE 6 FIXED: aggregate in Spark")

trips = (spark.table(TRIP_TABLE)
         .where((F.col("pickup_year") == DEMO_YEAR)
                & F.col("pickup_month").isin(*DEMO_MONTHS))
         .where(F.col("tpep_pickup_datetime").isNotNull())
         .select("PULocationID", "DOLocationID", "trip_distance", "total_amount"))

summary = (trips.groupBy("PULocationID", "DOLocationID")
           .agg(F.count("*").alias("trips"),
                F.sum("total_amount").alias("revenue"),
                F.avg("trip_distance").alias("average_distance")))

started = time.perf_counter()
(summary.write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(OUTPUT_PATH))
print(f"CASE 6 FIXED: {time.perf_counter() - started:.1f}s")

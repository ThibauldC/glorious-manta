"""Case 4 fixed run: compact once, then read a normal number of files.

Quiz-only case. Do not present this in the talk.

The compaction is a one-time cost that every later run amortizes. Only the
aggregation is timed, so the comparison against bad.py is like for like: the same
rows, the same aggregation, a sane number of input files.

Tuning spark.sql.files.maxPartitionBytes does not rescue this. Packing more tiny
files into each task keeps the same number of network round trips and just moves
them onto fewer tasks. The files themselves have to go.
"""

import time

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.types import (DoubleType, IntegerType, StringType, StructField,
                               StructType, TimestampType)

spark = SparkSession.builder.getOrCreate()

LANDING_PATH = "Files/nyc_taxi/landing/trips_json"
BRONZE_PATH = "Files/nyc_taxi/demo_outputs/case4/bronze_trips"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case4/fixed"
TARGET_FILES = 32

spark.sparkContext.setJobDescription("CASE 4 FIXED: compact then aggregate")

TRIP_SCHEMA = StructType([
    StructField("VendorID", IntegerType()),
    StructField("tpep_pickup_datetime", TimestampType()),
    StructField("tpep_dropoff_datetime", TimestampType()),
    StructField("PULocationID", IntegerType()),
    StructField("DOLocationID", IntegerType()),
    StructField("passenger_count", IntegerType()),
    StructField("trip_distance", DoubleType()),
    StructField("fare_amount", DoubleType()),
    StructField("tip_amount", DoubleType()),
    StructField("total_amount", DoubleType()),
    StructField("store_and_fwd_flag", StringType()),
])

compaction_started = time.perf_counter()
(spark.read.schema(TRIP_SCHEMA).json(LANDING_PATH)
 .repartition(TARGET_FILES)
 .write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(BRONZE_PATH))
print(f"CASE 4 COMPACTION (one time): {time.perf_counter() - compaction_started:.1f}s")

trips = spark.read.format("delta").load(BRONZE_PATH)

summary = (trips.groupBy("PULocationID", "DOLocationID")
           .agg(F.count("*").alias("trips"),
                F.sum("total_amount").alias("revenue"),
                F.avg("trip_distance").alias("average_distance")))

started = time.perf_counter()
(summary.write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(OUTPUT_PATH))
print(f"CASE 4 FIXED: {time.perf_counter() - started:.1f}s reading {TARGET_FILES} files")

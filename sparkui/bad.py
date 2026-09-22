"""Case 4 bad run: a landing zone of tiny files buries the read.

Quiz-only case. Do not present this in the talk.

Run setup_landing_zone.py first.

What the Spark UI should show:
  Jobs      a separate job named "Listing leaf files and directories for N paths"
  Stages    the scan stage carries far more tasks than the input volume warrants
  Tasks     balanced but slow: a few MiB read per task, seconds spent per task,
            because each task opens dozens of files across the network
  Executors busy, yet the throughput is terrible

The schema is supplied explicitly. Schema inference on twenty thousand files adds
a second full pass and muddies the evidence.
"""

import time

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.types import (DoubleType, IntegerType, StringType, StructField,
                               StructType, TimestampType)

spark = SparkSession.builder.getOrCreate()

LANDING_PATH = "Files/nyc_taxi/landing/trips_json"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case4/bad"

spark.sparkContext.setJobDescription("CASE 4 BAD: small-file landing zone")

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

trips = spark.read.schema(TRIP_SCHEMA).json(LANDING_PATH)

summary = (trips.groupBy("PULocationID", "DOLocationID")
           .agg(F.count("*").alias("trips"),
                F.sum("total_amount").alias("revenue"),
                F.avg("trip_distance").alias("average_distance")))

started = time.perf_counter()
(summary.write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(OUTPUT_PATH))
print(f"CASE 4 BAD: {time.perf_counter() - started:.1f}s reading {LANDING_PATH}")

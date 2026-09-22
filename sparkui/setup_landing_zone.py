"""Case 4 setup: build a landing zone of many small JSON files.

Quiz-only case. Do not present this in the talk.

This is untimed demo setup, like ingest_nyc_taxi.py. Run it once, well before you
need it: writing twenty thousand files to OneLake is slow.

Attach the same default Lakehouse used by ingest_nyc_taxi.py.
"""

import time

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.getOrCreate()

TRIP_TABLE = "nyc_yellow_trips"
LANDING_PATH = "Files/nyc_taxi/landing/trips_json"
DEMO_YEAR = 2024
DEMO_MONTHS = (1, 2, 3)
FILE_COUNT = 20000

spark.sparkContext.setJobDescription("CASE 4 SETUP: write small-file landing zone")

trips = (spark.table(TRIP_TABLE)
         .where((F.col("pickup_year") == DEMO_YEAR)
                & F.col("pickup_month").isin(*DEMO_MONTHS))
         .where(F.col("tpep_pickup_datetime").isNotNull())
         .select("VendorID", "tpep_pickup_datetime", "tpep_dropoff_datetime",
                 "PULocationID", "DOLocationID", "passenger_count",
                 "trip_distance", "fare_amount", "tip_amount", "total_amount"))

started = time.perf_counter()
(trips.repartition(FILE_COUNT)
 .write.mode("overwrite")
 .json(LANDING_PATH))
print(f"CASE 4 SETUP: {time.perf_counter() - started:.1f}s, target {FILE_COUNT} files")

# Record these two numbers. They go straight into the quiz data.
try:
    from notebookutils import mssparkutils

    entries = [e for e in mssparkutils.fs.ls(LANDING_PATH) if e.name.endswith(".json")]
    sizes = sorted(e.size for e in entries)
    total = sum(sizes)
    print(f"Files written: {len(entries)}")
    print(f"Total size: {total / 1024 ** 3:.2f} GiB")
    print(f"Median file size: {sizes[len(sizes) // 2] / 1024:.1f} KiB")
except Exception as error:  # noqa: BLE001
    print(f"Could not list the landing zone from this runtime: {error}")

#!/bin/sh
set -eu

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone \
  --depth 1 \
  --filter=blob:none \
  --sparse \
  https://github.com/ThibauldC/spark-ui-detective.git \
  "$tmp/spark-ui-detective"

git -C "$tmp/spark-ui-detective" sparse-checkout set slidev

(
  cd "$tmp/spark-ui-detective/slidev"
  npm ci
  npm run build -- --base /presentations/spark-ui-detective/
)

mkdir -p _site/presentations/spark-ui-detective
cp -R "$tmp/spark-ui-detective/slidev/dist/." \
  _site/presentations/spark-ui-detective/

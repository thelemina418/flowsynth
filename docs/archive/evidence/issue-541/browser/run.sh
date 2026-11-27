#!/bin/sh
# Run one area's capture after the capture preflight accepted the URL.
# Usage: docs/evidence/issue-541/browser/run.sh <area> <verified-url>
# PLAYWRIGHT_MODULE and CHROMIUM_BIN/CHROMIUM_PATH may select existing installs.
set -e
here=$(dirname "$0")
exec node tools/run-supported.mjs "$here/$1/capture.mjs" "$2"

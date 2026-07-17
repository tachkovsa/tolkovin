#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O fn-watcher.swift -o fn-watcher
echo "built native/fn-watcher"

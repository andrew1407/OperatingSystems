#!/usr/bin/env bash
# Compile the C++ labs to WebAssembly modules in web/build/ (needs emsdk: source emsdk_env.sh).
set -euo pipefail
cd "$(dirname "$0")"
OUT=../build
mkdir -p "$OUT"
python3 gen.py

COMMON=(-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=ccall,HEAPU8,HEAP32,HEAPF64,stackRestore
  -sEXPORTED_FUNCTIONS=_malloc,_free -Wno-format)

build() { # name, flags..., sources...
  local name=$1; shift
  echo "build/$name.mjs"
  em++ "$@" "${COMMON[@]}" -o "$OUT/$name.mjs"
}

build lab1 -O2 lab1.cpp -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB
# Lab 2: one module per variant. A fixed 1 MB memory keeps the per-thread memory copies small.
for v in 0 1 2; do
  build "lab2-$v" -O2 -DVARIANT=$v lab2.cpp -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB -sASYNCIFY -sASYNCIFY_IMPORTS=fork_thread
done
# Lab 5 at several array sizes (the lab uses 100), lab 6 at its own 300.
for n in 100 125 150 175 200 250 300; do
  build "lab5-$n" -O2 -DARR_SIZE=$n lab5.cpp -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=2GB
done
build lab6 -O2 -finstrument-functions lab6.cpp -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=2GB
ls -la "$OUT"

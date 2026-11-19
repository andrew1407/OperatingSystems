# OperatingSystems

<p align="center">
  <a href="https://andrew1407.github.io/OperatingSystems/" title="Open the labs in the browser">
    <img src="web/icon.svg" alt="Operating Systems Labs" width="140" height="140">
  </a>
</p>

[![pages deploy badge](https://github.com/andrew1407/OperatingSystems/actions/workflows/pages.yml/badge.svg)](https://andrew1407.github.io/OperatingSystems/)

A collection of operating-systems coursework labs written in C++ and Python, covering dynamic memory allocators, CPU scheduling, a process-to-resource planner, and cache-locality optimization.

## Labs

| Lab | Topic | Language |
| --- | --- | --- |
| [`1-lab`](1-lab/1-lab.cpp) | Implicit free-list memory allocator using `mmap`, with block headers, splitting, and coalescing | C++ |
| [`2-lab`](2-lab/2-lab.cpp) | Buddy-system memory allocator with three coalescing variants: synchronous, `std::async`, and `std::thread` + mutex/condition-variable | C++ |
| [`3-lab`](3-lab/3-lab.py) | Shortest Job First (SJF) CPU scheduling simulation with `matplotlib` plots | Python |
| [`4-lab`](4-lab/4-lab.py) | Process-to-resource planner over a randomly generated binary matrix using row/column permutations | Python |
| [`5-lab`](5-lab/5-lab.cpp) | Cache-locality benchmark comparing optimized vs. unoptimized 3D-array traversal orders | C++ |
| [`6-lab`](6-lab/6-lab.cpp) | Profiling of the array-traversal benchmark with `gprof` | C++ |

## Overview

- **Lab 1** ([`1-lab/`](1-lab/1-lab.cpp)) implements an [`Allocator`](1-lab/1-lab.cpp) class backed by an anonymous `mmap` region. Blocks carry an 8-byte header storing current and previous block descriptors (size with allocation flag packed into the low bits), and the allocator supports allocation by best fit, reallocation, freeing with forward/backward coalescing, and a `memoryDump`.
- **Lab 2** ([`2-lab/`](2-lab/2-lab.cpp)) implements a buddy-system [`Allocator`](2-lab/2-lab.cpp) that keeps free blocks in size classes (powers of two) and recursively splits and coalesces buddies. Three implementations of the same allocator share an interface and differ only in how coalescing is run:
  - [`2-lab.cpp`](2-lab/2-lab.cpp) — synchronous.
  - [`2-lab.async.cpp`](2-lab/2-lab.async.cpp) — coalescing dispatched via `std::async`.
  - [`2-lab.threads.cpp`](2-lab/2-lab.threads.cpp) — coalescing dispatched via `std::thread` with a `std::mutex` and `std::condition_variable`.

  [`2-lab.test.cpp`](2-lab/2-lab.test.cpp) selects one implementation (via `#include`) and times a sequence of operations with a scoped `Timer`.
- **Lab 3** ([`3-lab/`](3-lab/3-lab.py)) simulates a Shortest Job First scheduler. [`ShortestJobFirst.py`](3-lab/ShortestJobFirst.py) generates processes with random arrival gaps and burst times and computes completion, turnaround, and wait times plus CPU idle percentage; [`3-lab.py`](3-lab/3-lab.py) sweeps arrival intensities and renders three plots (average wait time vs. intensity, idle percentage vs. intensity, and process count vs. average wait time).
- **Lab 4** ([`4-lab/`](4-lab/4-lab.py)) generates a random binary matrix and runs a planner that, per diagonal step, swaps in the minimum-row-sum process and the maximum-column-sum resource via row and column permutations.
- **Lab 5** ([`5-lab/`](5-lab/5-lab.cpp)) measures and compares execution time of two triple-nested loops over a `100 x 100 x 100` array that differ only in index order, demonstrating the effect of cache locality.
- **Lab 6** ([`6-lab/`](6-lab/6-lab.cpp)) is the same benchmark scaled to `300 x 300 x 300`, built with profiling instrumentation; [`6-lab.sh`](6-lab/6-lab.sh) compiles with `-pg -O2`, runs the binary, and produces a `gprof` report.

## Showcase

**[Open the labs in the browser](https://andrew1407.github.io/OperatingSystems/)**. Every lab runs from its own source code, with adjustable parameters, interactive views and charts, and buttons to copy each chart (PNG or CSV), drawing, table, text output and set of results.

- **C++ labs (1, 2, 5, 6)** are compiled to WebAssembly with emscripten by [`web/wasm/build.sh`](web/wasm/build.sh). Labs 1 and 2 show the heap map or buddy tree after each `allocateMemory` / `reallocateMemory` / `freeMemory` call, with the lab's own memory dump; the operations are the lab's test drivers, editable, plus buttons for one more call. Lab 5 sweeps the array size (a build-time copy of `5-lab.cpp` makes `ARR_SIZE` settable, [`web/wasm/gen.py`](web/wasm/gen.py)), and labs 5 and 6 run in a Web Worker.
- **Threads are Web Workers.** GitHub Pages can't send the COOP/COEP headers that wasm threads need. So `pthread_create`, which `std::thread` and `std::async` call, is defined in [`web/wasm/lab2.cpp`](web/wasm/lab2.cpp): it pauses the starting thread with Asyncify, and the page runs the thread in a worker on a copy of the module's memory, then copies it back. That's exact for lab 2, which joins or waits on each thread before touching the allocator again.
- **Lab 6 isn't gprof.** gprof can't run in a browser, so `6-lab.cpp` is built with `-finstrument-functions`, and hooks time each call with `performance.now()`. The page shows a flat profile in gprof's columns, a call graph and a call timeline, all measured in the browser.
- **Python labs (3, 4)** run in [Pyodide](https://pyodide.org), in a Web Worker so the page never freezes. [`web/showcase.py`](web/showcase.py) runs `3-lab.py` top to bottom with matplotlib swapped for a recorder, and runs lab 4's `runPlanner` on a numpy array that records each permutation for the step-by-step view.

Run it locally (needs [emsdk](https://emscripten.org/docs/getting_started/downloads.html)):

```sh
./web/wasm/build.sh              # builds web/build/*.mjs + .wasm
python -m http.server            # then open http://localhost:8000/web/
```

The [pages workflow](.github/workflows/pages.yml) builds and deploys it on every push to `main`.

## Tech stack

- **C++** — Labs 1, 2, 5, 6. Uses POSIX `mmap`/`munmap` (`sys/mman.h`), the STL (`map`, `vector`), and `<future>`, `<thread>`, `<mutex>`, `<condition_variable>` for Lab 2's concurrency variants. Lab 6 uses `gprof` for profiling.
- **Python** — Labs 3, 4. Uses `numpy` and `matplotlib`.

## Build and run

### C++ labs

The allocator labs are header-style classes included by a driver `main`. Compile the test driver:

```sh
# Lab 1
c++ 1-lab/1-lab.test.cpp -o 1-lab.out
./1-lab.out

# Lab 2 (edit 2-lab.test.cpp to select the sync / async / threads variant)
c++ 2-lab/2-lab.test.cpp -o 2-lab.out -pthread
./2-lab.out

# Lab 5
c++ 5-lab/5-lab.cpp -o 5-lab.out -O2
./5-lab.out
```

For Lab 6, use the provided script (builds with `-pg -O2`, runs, and writes a `gprof` report):

```sh
cd 6-lab
./6-lab.sh         # build, run, and generate 6-lab.gprof.txt
./6-lab.sh clear   # remove build/profiling artifacts
```

### Python labs

Install dependencies and run:

```sh
pip install numpy matplotlib

# Lab 3 (displays plots)
python 3-lab/3-lab.py

# Lab 4
python 4-lab/4-lab.py
```

## Project structure

```
.
├── 1-lab/
│   ├── 1-lab.cpp          # implicit free-list allocator
│   └── 1-lab.test.cpp     # driver / main
├── 2-lab/
│   ├── 2-lab.cpp          # buddy allocator (synchronous coalescing)
│   ├── 2-lab.async.cpp    # buddy allocator (std::async)
│   ├── 2-lab.threads.cpp  # buddy allocator (std::thread + mutex/cv)
│   └── 2-lab.test.cpp     # driver with timing
├── 3-lab/
│   ├── 3-lab.py           # intensity sweep + plots
│   └── ShortestJobFirst.py# SJF scheduling simulation
├── 4-lab/
│   └── 4-lab.py           # matrix-based process/resource planner
├── 5-lab/
│   └── 5-lab.cpp          # cache-locality benchmark
├── 6-lab/
│   ├── 6-lab.cpp          # benchmark for gprof profiling
│   └── 6-lab.sh           # build/run/profile script
└── web/                   # GitHub Pages showcase (page, workers, wasm/ build)
```

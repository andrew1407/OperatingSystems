# OperatingSystems

A collection of operating-systems coursework labs written in C++ and Python, covering dynamic memory allocators, CPU scheduling, a process-to-resource planner, and cache-locality optimization.

## Labs

| Lab | Topic | Language |
| --- | --- | --- |
| 1 | Implicit free-list memory allocator using `mmap`, with block headers, splitting, and coalescing | C++ |
| 2 | Buddy-system memory allocator with three coalescing variants: synchronous, `std::async`, and `std::thread` + mutex/condition-variable | C++ |
| 3 | Shortest Job First (SJF) CPU scheduling simulation with `matplotlib` plots | Python |
| 4 | Process-to-resource planner over a randomly generated binary matrix using row/column permutations | Python |
| 5 | Cache-locality benchmark comparing optimized vs. unoptimized 3D-array traversal orders | C++ |
| 6 | Profiling of the array-traversal benchmark with `gprof` | C++ |

## Overview

- **Lab 1** (`1-lab/`) implements an `Allocator` class backed by an anonymous `mmap` region. Blocks carry an 8-byte header storing current and previous block descriptors (size with allocation flag packed into the low bits), and the allocator supports allocation by best fit, reallocation, freeing with forward/backward coalescing, and a `memoryDump`.
- **Lab 2** (`2-lab/`) implements a buddy-system `Allocator` that keeps free blocks in size classes (powers of two) and recursively splits and coalesces buddies. Three implementations of the same allocator share an interface and differ only in how coalescing is run:
  - `2-lab.cpp` — synchronous.
  - `2-lab.async.cpp` — coalescing dispatched via `std::async`.
  - `2-lab.threads.cpp` — coalescing dispatched via `std::thread` with a `std::mutex` and `std::condition_variable`.

  `2-lab.test.cpp` selects one implementation (via `#include`) and times a sequence of operations with a scoped `Timer`.
- **Lab 3** (`3-lab/`) simulates a Shortest Job First scheduler. `ShortestJobFirst.py` generates processes with random arrival gaps and burst times and computes completion, turnaround, and wait times plus CPU idle percentage; `3-lab.py` sweeps arrival intensities and renders three plots (average wait time vs. intensity, idle percentage vs. intensity, and process count vs. average wait time).
- **Lab 4** (`4-lab/`) generates a random binary matrix and runs a planner that, per diagonal step, swaps in the minimum-row-sum process and the maximum-column-sum resource via row and column permutations.
- **Lab 5** (`5-lab/`) measures and compares execution time of two triple-nested loops over a `100 x 100 x 100` array that differ only in index order, demonstrating the effect of cache locality.
- **Lab 6** (`6-lab/`) is the same benchmark scaled to `300 x 300 x 300`, built with profiling instrumentation; `6-lab.sh` compiles with `-pg -O2`, runs the binary, and produces a `gprof` report.

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
└── 6-lab/
    ├── 6-lab.cpp          # benchmark for gprof profiling
    └── 6-lab.sh           # build/run/profile script
```

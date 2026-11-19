// Lab 6 for the browser: the lab's benchmark (6-lab/6-lab.cpp) built with -finstrument-functions, the
// closest thing to gprof's -pg in WebAssembly. The compiler calls the two hooks below on entry to and
// exit from each of the lab's functions; they record calls and times (emscripten_get_now, which is
// performance.now()) so the page can build a flat profile and a call graph.
#include <emscripten.h>

#define main lab_main
#include "gen/6-lab.cpp"
#undef main

#define NOI __attribute__((no_instrument_function))

// No allocation and no library calls in here: anything inlined into this file is instrumented too,
// so the hooks only use plain arrays, and record the lab's own functions only (chrono's inline helpers are skipped).
struct Event { int fn, caller; double t; int enter; };
static Event events[4096];
static int eventCount = 0;
static void* labFns[6];

NOI static int fnId(void* fn) {
  for (int i = 0; i < 6; i++) if (labFns[i] == fn) return i;
  return -1;
}

NOI static void record(void* fn, int enter) {
  const int id = fnId(fn);
  if (id < 0 || eventCount == 4096) return;
  events[eventCount++] = { id, 0, emscripten_get_now(), enter };
}

extern "C" {
NOI void __cyg_profile_func_enter(void* fn, void* caller) { record(fn, 1); }
NOI void __cyg_profile_func_exit(void* fn, void* caller) { record(fn, 0); }

// Function ids are indexes in this order: main, calcTime, generate, clear, unoptimized, optimized.
NOI EMSCRIPTEN_KEEPALIVE int* fn_ids() {
  static int ids[6] = { 0, 1, 2, 3, 4, 5 };
  return ids;
}

// Runs the lab's main() and returns the number of recorded events; events_data() points at them.
NOI EMSCRIPTEN_KEEPALIVE int run_main() {
  void* fns[6] = { (void*)&lab_main, (void*)&calcTime, (void*)&generate, (void*)&clear, (void*)&unoptimized, (void*)&optimized };
  for (int i = 0; i < 6; i++) labFns[i] = fns[i];
  eventCount = 0;
  lab_main();
  return eventCount;
}
NOI EMSCRIPTEN_KEEPALIVE Event* events_data() { return events; }
NOI EMSCRIPTEN_KEEPALIVE int arr_size() { return ARR_SIZE; }
}

// Lab 5 for the browser: the lab's benchmark (5-lab/5-lab.cpp, array size set by -DARR_SIZE via gen.py)
// with its main() renamed so the page can run it on demand, plus the two timings on their own.
#include <emscripten.h>
#define main lab_main
#include "gen/5-lab.cpp"
#undef main

extern "C" {
EMSCRIPTEN_KEEPALIVE int run_main() { int r = lab_main(); cout.flush(); return r; }
EMSCRIPTEN_KEEPALIVE int arr_size() { return ARR_SIZE; }
// microseconds, from the lab's calcTime()
EMSCRIPTEN_KEEPALIVE double time_unoptimized() { return (double)calcTime(unoptimized); }
EMSCRIPTEN_KEEPALIVE double time_optimized() { return (double)calcTime(optimized); }
}

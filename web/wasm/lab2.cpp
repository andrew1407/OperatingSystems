// Lab 2 for the browser: one of the lab's three buddy allocators (VARIANT 0 = 2-lab.cpp, 1 = 2-lab.async.cpp,
// 2 = 2-lab.threads.cpp) unchanged, plus a C API the page calls. `private` reads as `public` while the lab
// is included, so the page can read the free lists.
//
// Threads: wasm pthreads need SharedArrayBuffer, which GitHub Pages can't enable (no COOP/COEP headers).
// So pthread_create, which libc++'s std::thread and std::async(std::launch::async) call, is defined
// here: it suspends the caller (Asyncify) and the page runs the thread's start routine in a Web Worker
// (thread-worker.js) on a copy of this module's memory, then copies the memory back and resumes the
// caller. That's exact for this lab because every thread it starts is joined or waited on before the
// starting thread touches the allocator again, so nothing runs concurrently with the thread anyway.
#include <stdio.h>
#include <sys/mman.h>
#include <errno.h>
#include <map>
#include <vector>
#include <math.h>
#include <cmath>  // the lab calls std::ceil and std::log2, which libc++ declares in <cmath>
#include <future>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <pthread.h>
#include <emscripten.h>
#include <emscripten/stack.h>

#define private public
#if VARIANT == 0
#include "../../2-lab/2-lab.cpp"
#elif VARIANT == 1
#include "../../2-lab/2-lab.async.cpp"
#else
#include "../../2-lab/2-lab.threads.cpp"
#endif
#undef private

EM_ASYNC_JS(void, fork_thread, (void* fn, void* arg, size_t sp), {
  await Module.forkThread(fn, arg, sp);
});

static size_t threadIds = 0;

extern "C" {

int pthread_create(pthread_t* thread, const pthread_attr_t*, void* (*fn)(void*), void* arg) {
  *thread = (pthread_t)++threadIds;
  fork_thread((void*)fn, arg, emscripten_stack_get_current());
  return 0;
}
int pthread_join(pthread_t, void**) { return 0; }
int pthread_detach(pthread_t) { return 0; }

// Entry point in the worker: the memory already holds the starting thread's state.
EMSCRIPTEN_KEEPALIVE void run_thread(void* (*fn)(void*), void* arg) { fn(arg); }

static Allocator* heap = nullptr;

EMSCRIPTEN_KEEPALIVE int b_init(int size) {
  delete heap;
  heap = new Allocator(size);
  return (int)heap->_allocatedSize;
}

EMSCRIPTEN_KEEPALIVE int b_threads() { return (int)threadIds; }

// Offsets are relative to the start of the mapped region; -1 means nullptr.
EMSCRIPTEN_KEEPALIVE int b_alloc(int size) {
  void* p = heap->allocateMemory(size);
  return p ? (int)((char*)p - heap->_startPtr) : -1;
}

// 1 if the block was freed, 0 if freeMemory rejected the arguments.
EMSCRIPTEN_KEEPALIVE int b_free(int offset, int size) {
  void* p = heap->_startPtr + offset;
  heap->freeMemory(p, size);
  return p == nullptr;
}

// The new offset, -1 if reallocateMemory rejected the arguments, -2 if the block was freed but no new block was found.
EMSCRIPTEN_KEEPALIVE int b_realloc(int offset, int size, int resized) {
  void* p = heap->_startPtr + offset;
  void* r = heap->reallocateMemory(p, size, resized);
  if (r) return (int)((char*)r - heap->_startPtr);
  return p ? -1 : -2;
}

EMSCRIPTEN_KEEPALIVE void b_dump() { heap->freeBlocksDump(); fflush(stdout); }

// The free lists as [class, count, offset...]..., terminated by -1.
static std::vector<int> lists;
EMSCRIPTEN_KEEPALIVE int* b_lists() {
  lists.clear();
  for (auto& c : heap->_freeBlocks) {
    lists.push_back((int)c.first);
    lists.push_back((int)c.second.size());
    for (block_addr p : c.second) lists.push_back((int)(p - heap->_startPtr));
  }
  lists.push_back(-1);
  return lists.data();
}

}

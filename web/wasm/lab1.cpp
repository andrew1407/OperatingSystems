// Lab 1 for the browser: the lab's Allocator (1-lab/1-lab.cpp) unchanged, plus a C API the page calls.
// `class` is read as `struct` while the lab is included, so the page can read the heap's start and size.
#include <stdio.h>
#include <sys/mman.h>
#include <errno.h>
#include <emscripten.h>

#define class struct
#include "../../1-lab/1-lab.cpp"
#undef class

static Allocator* heap = nullptr;

extern "C" {

// Offsets are payload addresses relative to the start of the mapped region; -1 means nullptr.
EMSCRIPTEN_KEEPALIVE int a_init(int size) {
  delete heap;
  heap = new Allocator();
  return heap->initMemory(size) ? (int)heap->_allocSize : 0;
}

EMSCRIPTEN_KEEPALIVE int a_start() { return (int)(size_t)heap->_startPtr; }

EMSCRIPTEN_KEEPALIVE int a_alloc(int size) {
  void* p = heap->allocateMemory(size);
  return p ? (int)((char*)p - (char*)heap->_startPtr) : -1;
}

// Returns the new payload offset, -1 if the block was left as it was, -2 if it was freed but no new block was found.
EMSCRIPTEN_KEEPALIVE int a_realloc(int offset, int size) {
  void* p = (char*)heap->_startPtr + offset;
  void* r = heap->reallocateMemory(p, size);
  if (r) return (int)((char*)r - (char*)heap->_startPtr);
  return p ? -1 : -2;
}

EMSCRIPTEN_KEEPALIVE void a_free(int offset) { heap->freeMemory((char*)heap->_startPtr + offset); }

EMSCRIPTEN_KEEPALIVE void a_dump() { heap->memoryDump(); fflush(stdout); }

}

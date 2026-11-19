// One lab 2 thread. pthread_create (web/wasm/lab2.cpp) suspends the starting thread and the page posts
// its memory here: this worker loads the same module, takes over that memory, runs the thread's start
// routine, and posts the memory back. A thread started from inside this one goes back through the page
// to another worker the same way.
const modules = new Map();
const forks = new Map();
let current = null, seq = 0;

// Leave the starting thread's stack frames alone: run below its stack pointer.
const below = (sp) => (sp - 512) & ~15;

async function forkThread(fn, arg, sp) {
  await null; // let Asyncify finish unwinding first, so its saved state is part of the copy
  const M = current;
  const mem = M.HEAPU8.slice().buffer;
  const id = ++seq;
  const reply = await new Promise((resolve) => {
    forks.set(id, resolve);
    postMessage({ type: 'fork', id, mem, fn, arg, sp }, [mem]);
  });
  M.HEAPU8.set(new Uint8Array(reply.mem));
}

function load(variant) {
  if (!modules.has(variant)) modules.set(variant, import(`./build/lab2-${variant}.mjs`).then((m) => m.default({ forkThread })));
  return modules.get(variant);
}

onmessage = async ({ data }) => {
  if (data.type === 'forked') {
    forks.get(data.id)(data);
    forks.delete(data.id);
    return;
  }
  const { id, variant, mem, fn, arg, sp } = data;
  try {
    const M = await load(variant);
    current = M;
    M.HEAPU8.set(new Uint8Array(mem));
    M.stackRestore(below(sp));
    const t0 = performance.now();
    await M.ccall('run_thread', null, ['number', 'number'], [fn, arg], { async: true });
    const ms = performance.now() - t0;
    const out = M.HEAPU8.slice().buffer;
    postMessage({ type: 'done', id, mem: out, ms }, [out]);
  } catch (e) {
    postMessage({ type: 'done', id, error: String(e?.stack || e) });
  }
};

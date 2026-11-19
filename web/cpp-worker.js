// Runs labs 5 and 6 (web/build/lab5-*.mjs, lab6.mjs) off the page's main thread, so the benchmarks
// never freeze the page. Messages: in {id, task, args}, out {id, result} | {id, error}.
let out = [];
const instance = (name) => import(`./build/${name}.mjs`).then((m) => m.default({
  print: (s) => out.push(s),
  printErr: (s) => out.push(s),
}));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const TASKS = {
  // The lab's main() at its own array size.
  async lab5Main() {
    const M = await instance('lab5-100');
    out = [];
    M._run_main();
    return { lines: out };
  },
  // Both traversal orders at one array size, `repeats` times each, timed by the lab's calcTime() (microseconds).
  async lab5Times({ n, repeats }) {
    const M = await instance(`lab5-${n}`); // a fresh instance per size, so the memory goes away afterwards
    const u = [], o = [];
    for (let r = 0; r < repeats; r++) { u.push(M._time_unoptimized()); o.push(M._time_optimized()); }
    return { n: M._arr_size(), u, o, uMed: median(u), oMed: median(o) };
  },
  // Lab 6: the lab's main() with the -finstrument-functions hooks recording each call.
  async lab6() {
    const M = await instance('lab6');
    const ids = Array.from(M.HEAP32.subarray(M._fn_ids() >> 2, (M._fn_ids() >> 2) + 6));
    out = [];
    const t0 = performance.now();
    const count = M._run_main();
    const wall = performance.now() - t0;
    const base = M._events_data(); // struct { int fn, caller; double t; int enter; } -> 24 bytes
    const events = [];
    for (let i = 0; i < count; i++) {
      const p = base + i * 24;
      events.push({ fn: M.HEAP32[p >> 2], t: M.HEAPF64[(p + 8) >> 3], enter: M.HEAP32[(p + 16) >> 2] === 1 });
    }
    return { ids, events, wall, n: M._arr_size(), lines: out };
  },
};

onmessage = async ({ data: { id, task, args } }) => {
  try {
    postMessage({ id, result: await TASKS[task](args || {}) });
  } catch (e) {
    postMessage({ id, error: String(e?.message || e) });
  }
};

// Operating Systems Labs showcase: lab panels, SVG views and charts, and the runtimes.
// C++ labs are compiled to WebAssembly (wasm/build.sh -> build/*.mjs). Labs 1 and 2 run on the page,
// lab 2's std::thread / std::async threads each run in a Web Worker (thread-worker.js), and labs 5 and 6
// run in a worker (cpp-worker.js). Python labs call window.pyRun (pyworker.js: Pyodide in a worker).

const REPO = 'https://github.com/Andrew1407/OperatingSystems';
const SRC = `${REPO}/blob/main`;
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 4) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2);
  return String(+v.toFixed(d));
};
const msFmt = (v) => `${fmt(v, v < 10 ? 3 : 1)} ms`;
const usFmt = (v) => (v >= 1000 ? msFmt(v / 1000) : `${fmt(v, v < 10 ? 2 : 0)} µs`);
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const sum = (xs) => xs.reduce((s, v) => s + v, 0);
const pause = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const stat = (value, label, cls = '') => `<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- runtimes --
let pyReady = false;
const pyWaiters = [];
window.addEventListener('py-ready', () => {
  pyReady = true;
  document.querySelectorAll('.py-status').forEach((el) => el.remove());
  pyWaiters.splice(0).forEach((f) => f());
});
const whenPy = () => (pyReady ? Promise.resolve() : new Promise((r) => pyWaiters.push(r)));

async function runPy(name, params) {
  await whenPy();
  await pause();
  const res = JSON.parse(await window.pyRun(name, JSON.stringify(params)));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// Labs 5 and 6 run in a module worker (cpp-worker.js), started on first use.
let cppWorker = null, cppSeq = 0;
const cppPending = new Map();
function runCpp(task, args) {
  if (!cppWorker) {
    cppWorker = new Worker(new URL('./cpp-worker.js', import.meta.url), { type: 'module' });
    cppWorker.onmessage = ({ data: { id, result, error } }) => {
      const p = cppPending.get(id); cppPending.delete(id);
      error === undefined ? p.resolve(result) : p.reject(new Error(error));
    };
    cppWorker.onerror = (e) => {
      for (const p of cppPending.values()) p.reject(new Error(e.message || 'C++ worker failed'));
      cppPending.clear();
    };
  }
  const id = ++cppSeq;
  return new Promise((resolve, reject) => { cppPending.set(id, { resolve, reject }); cppWorker.postMessage({ id, task, args }); });
}

// Lab 1's module runs on the page: every call is a few microseconds.
let lab1Mod = null, lab1Out = [];
const lab1Module = () => (lab1Mod ||= import('./build/lab1.mjs').then((m) => m.default({ print: (s) => lab1Out.push(s), printErr: (s) => lab1Out.push(s) })));

// Lab 2: one module per variant on the page (the program's main thread). Each thread it starts runs in a
// worker from this pool: the module's memory goes to the worker and comes back when the thread is done.
const threadPool = []; // { w, busy, variant }
const threadCalls = new Map();
let threadSeq = 0, threadLog = [];

function idleThreadWorker() {
  let i = threadPool.findIndex((t) => !t.busy);
  if (i < 0) {
    i = threadPool.length;
    const w = new Worker(new URL('./thread-worker.js', import.meta.url), { type: 'module' });
    const slot = { w, busy: false, variant: 0 };
    w.onmessage = ({ data }) => onThreadMessage(slot, i, data);
    w.onerror = (e) => console.error(`thread worker ${i + 1}:`, e.message);
    threadPool.push(slot);
  }
  return i;
}

function onThreadMessage(slot, i, d) {
  if (d.type === 'fork') { // a thread started a thread of its own
    runThread(slot.variant, d.mem, d.fn, d.arg, d.sp, i + 1)
      .then((res) => slot.w.postMessage({ type: 'forked', id: d.id, mem: res.mem }, [res.mem]))
      .catch((e) => console.error(e));
    return;
  }
  const call = threadCalls.get(d.id);
  threadCalls.delete(d.id);
  slot.busy = false;
  if (d.error) return call.reject(new Error(d.error));
  threadLog.push({ worker: i + 1, from: call.from, ms: d.ms, wall: performance.now() - call.t0 });
  call.resolve(d);
}

function runThread(variant, mem, fn, arg, sp, from) {
  const i = idleThreadWorker(), slot = threadPool[i];
  slot.busy = true; slot.variant = variant;
  const id = ++threadSeq;
  return new Promise((resolve, reject) => {
    threadCalls.set(id, { resolve, reject, from, t0: performance.now() });
    slot.w.postMessage({ id, variant, mem, fn, arg, sp }, [mem]);
  });
}

const lab2Mods = {};
let lab2Out = [];
function lab2Module(v) {
  return (lab2Mods[v] ||= import(`./build/lab2-${v}.mjs`).then((m) => {
    let M = null;
    return m.default({
      print: (s) => lab2Out.push(s), printErr: (s) => lab2Out.push(s),
      async forkThread(fn, arg, sp) {
        await null; // Asyncify has unwound this thread by now, so its saved state is in the copy
        const res = await runThread(v, M.HEAPU8.slice().buffer, fn, arg, sp, 0);
        M.HEAPU8.set(new Uint8Array(res.mem));
      },
    }).then((inst) => (M = inst));
  }));
}

// ------------------------------------------------------------------ charts --
const charts = new Map();
let chartSeq = 0;

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
}
function ticks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toPrecision(12));
  return { lo, hi, ticks: out };
}

/** spec: { title, x, y, series: [{ name, xs, ys, color, dash }], height, zeroY } or { kind: 'bar', cats, series: [{ name, ys, color }], logY } */
function chart(spec) {
  const id = `c${++chartSeq}`;
  charts.set(id, spec);
  const keys = spec.series.length > 1
    ? `<span class="keys">${spec.series.map((s) => `<span><i style="background:var(${s.color})${s.dash ? ';opacity:.6' : ''}"></i>${esc(s.name)}</span>`).join('')}</span>` : '';
  return `<figure class="chart" data-chart="${id}" data-copyable data-title="${esc(spec.title)}"><figcaption><span>${esc(spec.title)}</span>${keys}${actions('png', 'csv')}</figcaption><div class="plot"></div></figure>`;
}

function drawCharts(root = document) {
  root.querySelectorAll('figure.chart').forEach((fig) => {
    const spec = charts.get(fig.dataset.chart);
    const plot = $('.plot', fig);
    if (!spec || !plot.offsetParent) return;
    (spec.kind === 'bar' ? drawBars : drawChart)(plot, spec);
  });
}
const redrawers = new Set(); // custom SVG views that depend on the container width
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawCharts(); redrawers.forEach((f) => f()); }, 120); });

function drawChart(plot, spec) {
  const W = Math.max(260, plot.clientWidth), H = spec.height || 230;
  const M = { l: 58, r: 14, t: 8, b: 38 };
  const all = spec.series.flatMap((s) => s.xs.map((x, i) => [x, s.ys[i]])).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!all.length) { plot.innerHTML = '<p class="hint">No data.</p>'; return; }
  const xr = ticks(Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0])), Math.max(3, Math.floor((W - M.l) / 90)));
  const ys = all.map((p) => p[1]);
  const yr = ticks(spec.zeroY ? Math.min(0, ...ys) : Math.min(...ys), Math.max(...ys), 5);
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const X = (v) => M.l + ((v - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const Y = (v) => H - M.b - ((v - yr.lo) / (yr.hi - yr.lo || 1)) * (H - M.t - M.b);
  const xt = xr.ticks.filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9);
  const grid = yr.ticks.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${M.l - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${fmt(v, 6)}</text>`).join('')
    + xt.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${H - M.b}" y2="${H - M.b + 4}" stroke="var(--muted)"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${fmt(v, 6)}</text>`).join('');
  const axes = `<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="var(--line)"/>`
    + `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(spec.x)}</text>`
    + `<text transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">${esc(spec.y)}</text>`;
  const lines = spec.series.map((s) => {
    const pts = s.xs.map((x, i) => `${X(x).toFixed(1)},${Y(s.ys[i]).toFixed(1)}`).join(' ');
    const dots = s.xs.length <= 40 ? s.xs.map((x, i) => `<circle cx="${X(x)}" cy="${Y(s.ys[i])}" r="2.6" fill="var(${s.color})"/>`).join('') : '';
    return `<polyline points="${pts}" fill="none" stroke="var(${s.color})" stroke-width="${s.width || 1.8}" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>${dots}`;
  }).join('');
  plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.title)}">${grid}${axes}${lines}<line class="cross" y1="${M.t}" y2="${H - M.b}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><g class="marks"></g></svg><div class="tip" hidden></div>`;

  // hover: nearest sample (by x) of each series
  const svg = $('svg', plot), tip = $('.tip', plot), cross = $('.cross', svg), marks = $('.marks', svg);
  const nearest = (xs, v) => {
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m; else hi = m; }
    return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
  };
  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < M.l - 6 || px > W - M.r + 6) return hide();
    const v = x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);
    const hits = spec.series.map((s) => { const i = nearest(s.xs, v); return { s, x: s.xs[i], y: s.ys[i] }; });
    const hx = X(hits[0].x);
    cross.setAttribute('x1', hx); cross.setAttribute('x2', hx); cross.setAttribute('visibility', 'visible');
    marks.innerHTML = hits.map((h) => `<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="4" fill="var(--panel)" stroke="var(${h.s.color})" stroke-width="2"/>`).join('');
    tip.innerHTML = `<div class="tx">${esc(spec.x)} = ${fmt(hits[0].x, 6)}</div>` + hits.map((h) => `<div><i style="background:var(${h.s.color})"></i>${esc(h.s.name || spec.y)}: ${fmt(h.y, 6)}</div>`).join('');
    tip.hidden = false;
    const left = (hx / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${left + 12 + tw > rect.width ? Math.max(0, left - tw - 12) : left + 12}px`;
    tip.style.top = `${M.t}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); marks.innerHTML = ''; };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

// Grouped vertical bars, one group per category, values printed on the bars.
function drawBars(plot, spec) {
  const W = Math.max(260, plot.clientWidth), H = spec.height || 240;
  const M = { l: 58, r: 10, t: 18, b: 40 };
  const vals = spec.series.flatMap((s) => s.ys).filter((v) => Number.isFinite(v));
  if (!vals.length) { plot.innerHTML = '<p class="hint">No data.</p>'; return; }
  let Y, yt;
  if (spec.logY) {
    const pos = vals.filter((v) => v > 0);
    const lo = Math.floor(Math.log10(Math.min(...pos))), hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...pos))));
    Y = (v) => H - M.b - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * (H - M.t - M.b);
    yt = range(hi - lo + 1, (i) => 10 ** (lo + i));
  } else {
    const yr = ticks(0, Math.max(...vals), 5);
    Y = (v) => H - M.b - ((v - yr.lo) / (yr.hi - yr.lo || 1)) * (H - M.t - M.b);
    yt = yr.ticks;
  }
  const n = spec.cats.length, k = spec.series.length;
  const gw = (W - M.l - M.r) / n, bw = Math.min(64, (gw * 0.72) / k);
  const grid = yt.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${M.l - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${fmt(v, 6)}</text>`).join('');
  const bars = spec.cats.map((c, ci) => {
    const gx = M.l + ci * gw + (gw - bw * k) / 2;
    return spec.series.map((s, si) => {
      const v = s.ys[ci];
      if (!Number.isFinite(v)) return '';
      const x = gx + si * bw, y = Y(v);
      return `<rect x="${x + 1}" y="${y}" width="${bw - 2}" height="${Math.max(0, H - M.b - y)}" rx="3" fill="var(${s.color})"><title>${esc(c)} · ${esc(s.name)}: ${fmt(v, 4)}</title></rect>`
        + `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${fmt(v, 3)}</text>`;
    }).join('') + `<text x="${M.l + ci * gw + gw / 2}" y="${H - M.b + 16}" text-anchor="middle">${esc(c)}</text>`;
  }).join('');
  const axes = `<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="var(--line)"/>`
    + `<text transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">${esc(spec.y)}</text>`;
  plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.title)}">${grid}${axes}${bars}</svg>`;
}

// ------------------------------------------------------- allocator scripts --
// A script is the lab's own test driver, one call per line: `void* p = a.allocateMemory(32);`,
// `a.reallocateMemory(b, 100);`, `a.freeMemory(q);`. The short forms `p = alloc 32`, `realloc b 100`, `free q` work too.
const OPS = { allocateMemory: 'alloc', alloc: 'alloc', reallocateMemory: 'realloc', realloc: 'realloc', freeMemory: 'free', free: 'free' };
function parseScript(text) {
  const ops = [];
  text.split('\n').forEach((raw, n) => {
    const line = raw.replace(/\/\/.*$|#.*$/, '').trim().replace(/;$/, '').trim();
    if (!line) return;
    const m = line.match(/^(?:void\s*\*\s*)?(?:([A-Za-z_]\w*)\s*=\s*)?(?:[A-Za-z_]\w*\.)?([A-Za-z]+)\s*(?:\(([^)]*)\)|\s+(.*))$/);
    const op = m && OPS[m[2]];
    if (!op) throw new Error(`Line ${n + 1}: expected allocateMemory, reallocateMemory or freeMemory, got "${raw.trim()}".`);
    const args = (m[3] ?? m[4] ?? '').split(/[\s,]+/).filter(Boolean);
    const nums = args.filter((a) => /^\d+$/.test(a)).map(Number), names = args.filter((a) => !/^\d+$/.test(a));
    if (op === 'alloc') {
      if (!m[1] || nums.length !== 1) throw new Error(`Line ${n + 1}: write it as  void* p = a.allocateMemory(32);`);
      ops.push({ op, name: m[1], size: nums[0], line: n + 1 });
    } else {
      if (names.length !== 1) throw new Error(`Line ${n + 1}: name the block to ${op === 'free' ? 'free' : 'reallocate'}, like  a.${op === 'free' ? 'freeMemory(q)' : 'reallocateMemory(b, 100)'};`);
      ops.push({ op, name: names[0], nums, line: n + 1 });
    }
  });
  return ops;
}
const nextName = (used) => 'abcdefghijklmnopqrstuvwxyz'.split('').concat(range(99, (i) => `p${i + 1}`)).find((n) => !used.has(n));
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(2, '0')}`;

// ------------------------------------------------------------------- lab 1 --
const L1_HEADER = 8, L1_MIN_BLOCK = 12, L1_MIN_PAYLOAD = 4;
const l1Align = (s) => (s < L1_MIN_BLOCK ? L1_MIN_BLOCK : s % L1_MIN_PAYLOAD ? (Math.floor(s / L1_MIN_PAYLOAD) + 1) * L1_MIN_PAYLOAD : s); // _alignSize

class Lab1Session {
  async reset(size) {
    this.M = await lab1Module();
    this.total = this.M._a_init(size);
    if (!this.total) throw new Error('initMemory failed.');
    this.start = this.M._a_start();
    this.handles = new Map();
    this.steps = [];
    this.push(`initMemory(${size})`, [{ text: `mapped ${this.total} bytes (${size} + the 8-byte header, aligned to 4): one free block` }]);
  }
  blocks() {
    const H = this.M.HEAP32, out = [];
    for (let off = 0; off < this.total;) {
      const cur = H[(this.start + off) >> 2], prev = H[(this.start + off + 4) >> 2], size = cur & ~3;
      if (size <= 0) break;
      out.push({ off, size, used: !!(cur & 1), cur, prev });
      off += size;
    }
    return out;
  }
  dump() { lab1Out = []; this.M._a_dump(); return lab1Out.join('\n'); }
  push(label, events) {
    const blocks = this.blocks(), prev = this.steps.at(-1);
    const key = (b) => `${b.off}:${b.size}:${b.used}:${b.prev}`;
    const old = new Set(prev ? prev.blocks.map(key) : []);
    this.steps.push({ label, events, blocks, handles: new Map(this.handles), dump: this.dump(), changed: new Set(prev ? blocks.filter((b) => !old.has(key(b))).map((b) => b.off) : []) });
  }
  apply(o) {
    const before = this.blocks(), ev = [];
    if (o.op === 'alloc') {
      if (!(o.size >= 0)) throw new Error('Size must be a number.');
      const need = l1Align(o.size + L1_HEADER), fits = before.filter((b) => !b.used && b.size >= need);
      const r = this.M._a_alloc(o.size);
      if (r < 0) {
        ev.push({ text: o.size <= 0 ? 'returned nullptr: size must be positive' : `returned nullptr: no free block of ${need} bytes or more`, bad: true });
      } else {
        this.handles.set(o.name, r);
        const at = r - L1_HEADER, src = before.find((b) => b.off === at), now = this.blocks().find((b) => b.off === at);
        ev.push({ text: `needs ${need} bytes (${o.size} + 8-byte header, aligned); best fit of ${plural(fits.length, 'free block')}: ${src.size} bytes at +${at}` });
        ev.push(now.size < src.size ? { text: `split: ${src.size} → ${now.size} used + ${src.size - now.size} free` } : { text: `took all ${src.size} bytes (a remainder under 12 bytes can't hold a block)` });
      }
      this.push(`${o.name} = allocateMemory(${o.size})${r < 0 ? ' → nullptr' : ` → +${r}`}`, ev);
      return;
    }
    if (!this.handles.has(o.name)) throw new Error(`There's no block "${o.name}" (allocated: ${[...this.handles.keys()].join(', ') || 'none'}).`);
    const p = this.handles.get(o.name), at = p - L1_HEADER, old = before.find((b) => b.off === at);
    if (o.op === 'free') {
      this.M._a_free(p);
      this.handles.delete(o.name);
      const after = this.blocks(), f = after.find((b) => !b.used && b.off <= at && at < b.off + b.size);
      ev.push({ text: `freed ${old.size} bytes at +${at}` });
      if (f.off < at) ev.push({ text: 'coalesced with the free block before it' });
      if (f.off + f.size > at + old.size) ev.push({ text: 'coalesced with the free block after it' });
      if (f.size !== old.size) ev.push({ text: `now one free block of ${f.size} bytes at +${f.off}` });
      this.push(`freeMemory(${o.name})`, ev);
      return;
    }
    const size = o.nums[0];
    if (!(size >= 0)) throw new Error('reallocateMemory needs a new size.');
    const r = this.M._a_realloc(p, size);
    if (r >= 0) {
      this.handles.set(o.name, r);
      const now = this.blocks().find((b) => b.off === r - L1_HEADER);
      ev.push({ text: `freeMemory, then allocateMemory(${size}): ${old.size} → ${now.size} bytes, ${r === p ? `stays at +${at}` : `moves from +${at} to +${r - L1_HEADER}`}` });
    } else if (r === -1) {
      ev.push({ text: 'returned nullptr and left the block as it was (same size, too big, or under 4 bytes)', bad: true });
    } else {
      this.handles.delete(o.name);
      ev.push({ text: `freed the block, but no free block of ${l1Align(size + L1_HEADER)} bytes fits: the pointer is now nullptr`, bad: true });
    }
    this.push(`reallocateMemory(${o.name}, ${size})${r >= 0 ? ` → +${r}` : ' → nullptr'}`, ev);
  }
}

function lab1Map(step, total, width) {
  const words = total / 4;
  const cols = width < 600 || total <= 512 ? 16 : 32;
  const L = 44, cw = Math.max(8, Math.floor((width - L - 4) / cols)), ch = 24, rows = Math.ceil(words / cols);
  const W = L + cols * cw + 4, H = rows * ch + 6;
  const owner = new Map([...step.handles].map(([n, p]) => [p - L1_HEADER, n]));
  const pos = (w) => ({ x: L + (w % cols) * cw, y: 3 + Math.floor(w / cols) * ch });
  let cells = '', edges = '', labels = '';
  for (const b of step.blocks) {
    const w0 = b.off / 4, n = b.size / 4, name = owner.get(b.off);
    const tip = `+${b.off}: ${b.size}-byte block, payload ${b.size - L1_HEADER} bytes, ${b.used ? `allocated${name ? ` (${name})` : ''}` : 'free'}. Header: current = ${b.cur} (${b.size} | ${b.cur & 1}), previous = ${b.prev}${b.prev ? ` (${b.prev & ~3} | ${b.prev & 1})` : ' (first block)'}`;
    for (let i = 0; i < n; i++) {
      const { x, y } = pos(w0 + i);
      const cls = i < 2 ? 'hdr' : b.used ? 'used' : 'free';
      cells += `<rect class="cell ${cls}" x="${x}" y="${y}" width="${cw}" height="${ch - 4}"><title>${esc(tip)}</title></rect>`;
      if (i < 2 && cw >= 14) labels += `<text class="lbl" x="${x + cw / 2}" y="${y + (ch - 4) / 2}" text-anchor="middle" dominant-baseline="central">${i ? 'P' : 'C'}</text>`;
    }
    // one outline per row the block spans
    for (let w = w0; w < w0 + n;) {
      const rowEnd = (Math.floor(w / cols) + 1) * cols, e = Math.min(w0 + n, rowEnd), { x, y } = pos(w);
      edges += `<rect class="${step.changed.has(b.off) ? 'hl' : 'edge'}" x="${x + 0.8}" y="${y + 0.8}" width="${(e - w) * cw - 1.6}" height="${ch - 5.6}" rx="2"/>`;
      w = e;
    }
    const tag = name || (b.used ? '' : 'free');
    const first = n > 2 ? pos(w0 + 2) : null;
    if (tag && first && (Math.min(n - 2, cols - ((w0 + 2) % cols)) * cw) >= tag.length * 7 + 4) labels += `<text class="lbl" x="${first.x + 4}" y="${first.y + (ch - 4) / 2}" dominant-baseline="central" style="font-weight:600">${esc(tag)}</text>`;
  }
  const rowLabels = range(rows, (r) => `<text x="${L - 6}" y="${3 + r * ch + (ch - 4) / 2}" text-anchor="end" dominant-baseline="central">+${r * cols * 4}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Heap map">${rowLabels}${cells}${edges}${labels}</svg>`;
}

function lab1Step(out, sess, idx) {
  const s = sess.steps[idx];
  const used = s.blocks.filter((b) => b.used), free = s.blocks.filter((b) => !b.used);
  const freeBytes = sum(free.map((b) => b.size)), largest = Math.max(0, ...free.map((b) => b.size));
  $('.a-stats', out).innerHTML = stat(`${sess.total} B`, 'mapped with mmap') + stat(used.length, 'allocated blocks') + stat(free.length, 'free blocks')
    + stat(`${freeBytes} B`, 'free, headers included') + stat(`${largest} B`, 'largest free block') + stat(freeBytes ? `${fmt((1 - largest / freeBytes) * 100, 1)}%` : '0%', 'external fragmentation');
  $('.a-title', out).textContent = `after step ${idx}: ${s.label}`;
  const box = $('.a-map', out);
  box.innerHTML = lab1Map(s, sess.total, box.clientWidth || 600);
  const owner = new Map([...s.handles].map(([n, p]) => [p - L1_HEADER, n]));
  $('.a-table', out).innerHTML = `<table><thead><tr><th class="num">Address</th><th class="num">Block, B</th><th class="num">Payload, B</th><th>State</th><th>Pointer</th><th class="num">header.current</th><th class="num">header.previous</th></tr></thead><tbody>${s.blocks.map((b) => `<tr${s.changed.has(b.off) ? ' style="font-weight:600"' : ''}><td class="num">+${b.off}</td><td class="num">${b.size}</td><td class="num">${b.size - L1_HEADER}</td><td><span class="sw ${b.used ? 'used' : 'free'}"></span>${b.used ? 'allocated' : 'free'}</td><td>${owner.get(b.off) ? `${owner.get(b.off)} = +${b.off + L1_HEADER}` : ''}</td><td class="num">${b.cur} = ${b.size} | ${b.cur & 1}</td><td class="num">${b.prev ? `${b.prev} = ${b.prev & ~3} | ${b.prev & 1}` : '0 (first)'}</td></tr>`).join('')}</tbody></table>`;
  $('.a-dump', out).textContent = s.dump || '(empty)';
  stepsList(out, sess, idx);
}

// ------------------------------------------------------------------- lab 2 --
const VARIANTS = [
  { name: 'sync', file: '2-lab.cpp', how: 'coalesces on the calling thread' },
  { name: 'std::async', file: '2-lab.async.cpp', how: 'coalesces in std::async(std::launch::async, …)' },
  { name: 'std::thread', file: '2-lab.threads.cpp', how: 'coalesces in a std::thread, with a mutex and condition variable' },
];
const log2 = (v) => Math.ceil(Math.log2(v)); // _align
const b2Class = (size) => (size < 4 ? 2 : log2(size));

class Lab2Session {
  async reset(variant, size) {
    this.v = variant;
    this.M = await lab2Module(variant);
    this.total = this.M._b_init(size);
    this.K = Math.log2(this.total);
    this.handles = new Map();
    this.steps = [];
    this.push(`Allocator(${size})`, [{ text: `mapped ${this.total} bytes (2^${this.K}): one free block of class ${this.K}` }], []);
  }
  lists() {
    const H = this.M.HEAP32, out = new Map();
    for (let p = this.M._b_lists() >> 2; H[p] !== -1;) {
      const k = H[p], n = H[p + 1];
      out.set(k, Array.from(H.subarray(p + 2, p + 2 + n)));
      p += 2 + n;
    }
    return out;
  }
  dump() { lab2Out = []; this.M._b_dump(); return lab2Out.join('\n'); }
  push(label, events, threads, ms) {
    this.steps.push({ label, events, threads, ms, lists: this.lists(), handles: new Map(this.handles), dump: this.dump() });
  }
  async call(name, args) {
    return this.v ? this.M.ccall(name, 'number', args.map(() => 'number'), args, { async: true }) : this.M[`_${name}`](...args);
  }
  diff(before) {
    const after = this.lists(), set = (m) => new Set([...m].flatMap(([k, offs]) => offs.map((o) => `${k}:${o}`)));
    const a = set(before), b = set(after);
    const parse = (s) => { const [k, o] = s.split(':').map(Number); return { k, o }; };
    return { added: [...b].filter((s) => !a.has(s)).map(parse), removed: [...a].filter((s) => !b.has(s)).map(parse) };
  }
  async apply(o) {
    const before = this.lists(), ev = [], log0 = threadLog.length, t0 = performance.now();
    let label;
    if (o.op === 'alloc') {
      const r = this.M._b_alloc(o.size), k = b2Class(o.size);
      if (r < 0) ev.push({ text: o.size <= 0 || o.size > this.total ? 'returned nullptr: size out of range' : `returned nullptr: no free block of class ${k} (${2 ** k} B) or larger`, bad: true });
      else {
        this.handles.set(o.name, { off: r, req: o.size, k });
        const { added, removed } = this.diff(before), from = removed[0];
        ev.push({ text: `class ${k} (${2 ** k} B) for ${o.size} bytes; took the ${2 ** from.k}-byte free block at +${from.o}` });
        if (added.length) ev.push({ text: `split it: buddies ${added.sort((x, y) => y.k - x.k).map((b) => `+${b.o} (${2 ** b.k} B)`).join(', ')} go to the free lists` });
      }
      label = `${o.name} = allocateMemory(${o.size})${r < 0 ? ' → nullptr' : ` → +${r}`}`;
    } else {
      if (!this.handles.has(o.name)) throw new Error(`There's no block "${o.name}" (allocated: ${[...this.handles.keys()].join(', ') || 'none'}).`);
      const h = this.handles.get(o.name);
      if (o.op === 'free') {
        const size = o.nums.length ? o.nums[0] : h.req;
        const ok = await this.call('b_free', [h.off, size]);
        if (!ok) ev.push({ text: 'freeMemory ignored it: the size must be from 4 bytes to the heap size', bad: true });
        else {
          this.handles.delete(o.name);
          const { added, removed } = this.diff(before), fin = added[0];
          ev.push({ text: `returned the class ${b2Class(size)} block at +${h.off}` });
          if (removed.length) ev.push({ text: `coalesced with ${plural(removed.length, 'buddy', 'buddies')} ${removed.sort((x, y) => x.k - y.k).map((b) => `+${b.o} (${2 ** b.k} B)`).join(', ')} into ${2 ** fin.k} B at +${fin.o}` });
          else ev.push({ text: 'its buddy is in use, so nothing to coalesce' });
        }
        label = `freeMemory(${o.name}, ${size})`;
      } else {
        const [old, resized] = o.nums.length >= 2 ? o.nums : [h.req, o.nums[0]];
        if (!(resized >= 0)) throw new Error('reallocateMemory needs a new size.');
        const r = await this.call('b_realloc', [h.off, old, resized]);
        if (r >= 0) {
          this.handles.set(o.name, { off: r, req: resized, k: b2Class(resized) });
          ev.push({ text: `freeMemory(${old}), then allocateMemory(${resized}): ${r === h.off ? `stays at +${r}` : `moves from +${h.off} to +${r}`}, class ${b2Class(resized)}` });
        } else if (r === -1) {
          ev.push({ text: 'returned nullptr: the new size must be at least 4 bytes larger than the old one and fit the heap', bad: true });
        } else {
          this.handles.delete(o.name);
          ev.push({ text: 'freed the block, but no free block fits: the pointer is now nullptr', bad: true });
        }
        label = `reallocateMemory(${o.name}, ${old}, ${resized})${r >= 0 ? ` → +${r}` : ' → nullptr'}`;
      }
    }
    const threads = threadLog.slice(log0), ms = performance.now() - t0;
    if (threads.length) ev.push({ text: threads.map((t) => `thread on worker ${t.worker} (started by ${t.from ? `the thread on worker ${t.from}` : 'main'}): ${msFmt(t.wall)}`).join('; ') });
    this.push(label, ev, threads, ms);
  }
}

function lab2Tree(step, K, width) {
  const blocks = [...step.lists].flatMap(([k, offs]) => offs.map((o) => ({ k, o, state: 'free' })))
    .concat([...step.handles].map(([name, h]) => ({ k: h.k, o: h.off, state: 'used', name })));
  const minK = Math.min(K, ...blocks.map((b) => b.k));
  const L = 70, rh = 30, W = Math.max(300, width), H = (K - minK + 1) * rh + 4, span = W - L - 4;
  const X = (o) => L + (o / 2 ** K) * span;
  let out = '';
  for (let k = K; k >= minK; k--) {
    const y = 2 + (K - k) * rh, size = 2 ** k;
    out += `<text x="${L - 8}" y="${y + 9}" text-anchor="end" style="fill:var(--ink)">class ${k}</text><text x="${L - 8}" y="${y + 21}" text-anchor="end">${size} B</text>`;
    for (let o = 0; o < 2 ** K; o += size) {
      if (blocks.some((b) => b.k > k && b.o <= o && o < b.o + 2 ** b.k)) continue; // inside a bigger block
      const exact = blocks.find((b) => b.k === k && b.o === o);
      const inner = !exact && blocks.some((b) => b.k < k && b.o >= o && b.o < o + size);
      if (!exact && !inner) continue;
      const x = X(o), w = Math.max(1, X(o + size) - x);
      const cls = exact ? exact.state : 'split';
      const tag = exact ? (exact.state === 'used' ? exact.name : 'free') : '';
      out += `<rect class="cell ${cls}" x="${x + 0.5}" y="${y}" width="${Math.max(0.5, w - 1)}" height="${rh - 6}" rx="3"><title>class ${k} (${size} B) at +${o}: ${exact ? (exact.state === 'used' ? `allocated (${exact.name}, ${step.handles.get(exact.name).req} bytes asked)` : 'free, in the free list') : 'split into two buddies'}</title></rect>`;
      if (exact) out += `<rect class="edge" x="${x + 0.5}" y="${y}" width="${Math.max(0.5, w - 1)}" height="${rh - 6}" rx="3" style="stroke-width:1.1"/>`;
      if (tag && w >= tag.length * 7 + 6) out += `<text class="lbl" x="${x + w / 2}" y="${y + (rh - 6) / 2}" text-anchor="middle" dominant-baseline="central" style="font-weight:600">${esc(tag)}</text>`;
      else if (!exact && w >= 46) out += `<text x="${x + w / 2}" y="${y + (rh - 6) / 2}" text-anchor="middle" dominant-baseline="central">+${o}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Buddy tree">${out}</svg>`;
}

function lab2Step(out, sess, idx) {
  const s = sess.steps[idx];
  const freeBytes = sum([...s.lists].map(([k, offs]) => offs.length * 2 ** k));
  const asked = sum([...s.handles.values()].map((h) => h.req)), taken = sess.total - freeBytes;
  $('.a-stats', out).innerHTML = stat(`${sess.total} B`, 'mapped with mmap') + stat(s.handles.size, 'allocated blocks') + stat(sum([...s.lists.values()].map((o) => o.length)), 'free blocks')
    + stat(`${freeBytes} B`, 'totally free') + stat(`${taken} B`, 'totally taken') + stat(taken ? `${fmt((1 - asked / taken) * 100, 1)}%` : '0%', 'internal fragmentation')
    + stat(s.threads?.length ?? 0, 'threads this step') + (s.ms !== undefined ? stat(msFmt(s.ms), 'step time') : '');
  $('.a-title', out).textContent = `after step ${idx}: ${s.label}`;
  const box = $('.a-map', out);
  box.innerHTML = lab2Tree(s, sess.K, box.clientWidth || 600);
  $('.a-table', out).innerHTML = `<table><thead><tr><th class="num">Class</th><th class="num">Block, B</th><th>Free blocks (addresses)</th><th class="num">Free, B</th></tr></thead><tbody>${[...s.lists].map(([k, offs]) => `<tr><td class="num">${k}</td><td class="num">${2 ** k}</td><td>${offs.length ? offs.map((o) => `+${o}`).join(', ') : 'empty'}</td><td class="num">${offs.length * 2 ** k}</td></tr>`).join('')}</tbody></table>`;
  $('.a-dump', out).textContent = s.dump || '(empty)';
  stepsList(out, sess, idx);
}

// ------------------------------------------------- shared allocator view --
function stepsList(out, sess, idx) {
  const ol = $('.steps', out);
  ol.innerHTML = sess.steps.map((s, i) => `<li><button type="button" data-step="${i}" aria-current="${i === idx}"><span class="n">${i}</span><span>${esc(s.label)}${s.events.map((e) => `<span class="ev${e.bad ? ' bad' : ''}">${esc(e.text)}</span>`).join('')}</span></button></li>`).join('');
  const cur = ol.querySelector('[aria-current="true"]');
  if (cur) ol.scrollTop = Math.max(0, cur.parentElement.offsetTop - ol.clientHeight + cur.parentElement.offsetHeight + 6);
}

function allocView(lab, legend) {
  return `<div class="stats a-stats"></div>
    <div class="ops" role="group" aria-label="Try an operation">
      <div class="grp"><label class="field">Size, bytes<input type="number" name="a-size" value="${lab.id === 'lab1' ? 16 : 40}" min="1" max="65536"></label><button type="button" class="op" data-op="alloc">allocateMemory</button></div>
      <div class="grp"><label class="field">Block<select name="r-name"></select></label><label class="field">New size<input type="number" name="r-size" value="${lab.id === 'lab1' ? 40 : 120}" min="1" max="65536"></label><button type="button" class="op" data-op="realloc">reallocateMemory</button></div>
      <div class="grp"><label class="field">Block<select name="f-name"></select></label><button type="button" class="op" data-op="free">freeMemory</button></div>
    </div>
    <div class="split-view">
      <div data-copyable><div class="copy-head"><h2>Steps <small>· click one to see it</small></h2>${actions('text')}</div><ol class="steps"></ol></div>
      <div>
        <div data-copyable data-title="${lab.id === 'lab1' ? 'Heap map' : 'Buddy tree'}"><div class="copy-head"><h2>${lab.id === 'lab1' ? 'Heap map' : 'Buddy tree'} <small class="a-title"></small></h2>${actions('png')}</div>
          <div class="gantt mem"><div class="plot a-map"></div></div>
          <div class="legend">${legend}</div></div>
        <div data-copyable style="margin-top:16px"><div class="copy-head"><h2>${lab.id === 'lab1' ? 'Blocks' : 'Free lists'}</h2>${actions('table')}</div><div class="table-wrap a-table"></div></div>
      </div>
    </div>
    <div data-copyable style="margin-top:16px"><div class="copy-head"><h2>Memory dump <small>· the lab's ${lab.id === 'lab1' ? 'memoryDump()' : 'freeBlocksDump()'}</small></h2>${actions('text')}</div><pre class="out-text a-dump"></pre></div>`;
}

function bindAlloc(out, lab, sess, show) {
  let idx = sess.steps.length - 1;
  const ops = $('.ops', out);
  const refresh = () => {
    const names = [...sess.handles.keys()];
    for (const sel of ops.querySelectorAll('select')) {
      const keep = sel.value;
      sel.innerHTML = names.map((n) => `<option${n === keep ? ' selected' : ''}>${esc(n)}</option>`).join('');
    }
    ops.querySelectorAll('[data-op="realloc"], [data-op="free"]').forEach((b) => (b.disabled = !names.length));
    show(out, sess, idx);
  };
  $('.steps', out).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-step]');
    if (b) { idx = +b.dataset.step; show(out, sess, idx); }
  });
  let busy = false;
  ops.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-op]');
    if (!b || busy) return;
    const val = (n) => ops.querySelector(`[name="${n}"]`).value;
    let o, line;
    if (b.dataset.op === 'alloc') { const name = nextName(new Set([...sess.handles.keys(), ...sess.steps.flatMap((s) => [...s.handles.keys()])])); o = { op: 'alloc', name, size: Math.trunc(+val('a-size')) }; line = `void* ${name} = a.allocateMemory(${o.size});`; }
    else if (b.dataset.op === 'realloc') {
      const name = val('r-name'), size = Math.trunc(+val('r-size'));
      o = lab.id === 'lab1' ? { op: 'realloc', name, nums: [size] } : { op: 'realloc', name, nums: [sess.handles.get(name).req, size] };
      line = `a.reallocateMemory(${name}, ${o.nums.join(', ')});`;
    } else {
      const name = val('f-name');
      o = lab.id === 'lab1' ? { op: 'free', name, nums: [] } : { op: 'free', name, nums: [sess.handles.get(name).req] };
      line = `a.freeMemory(${[name, ...o.nums].join(', ')});`;
    }
    busy = true; ops.querySelectorAll('button').forEach((x) => (x.disabled = true));
    try {
      await sess.apply(o);
      const ta = $(`#panel-${lab.id} textarea`);
      ta.value = `${ta.value.replace(/\s*$/, '')}\n${line}`;
      idx = sess.steps.length - 1;
    } catch (err) { console.error(err); }
    busy = false; ops.querySelectorAll('button').forEach((x) => (x.disabled = false));
    refresh();
  });
  const redraw = () => { if (out.isConnected && out.offsetParent) show(out, sess, idx); };
  redrawers.add(redraw);
  refresh();
}
const allocText = (sess) => sess.steps.flatMap((s, i) => [`${i}. ${s.label}`, ...s.events.map((e) => `   ${e.text}`)]);

// lab 2: the same random operations on the three variants
async function lab2Bench(heap, ops, seed) {
  const runOps = async (M, v) => {
    let s = seed >>> 0;
    const rnd = (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
    const call = (name, args) => (v ? M.ccall(name, 'number', args.map(() => 'number'), args, { async: true }) : M[`_${name}`](...args));
    const live = [], maxSize = Math.max(8, heap >> 4);
    for (let i = 0; i < ops; i++) {
      const r = rnd(100);
      if (!live.length || r < 50) {
        const size = 4 + rnd(maxSize - 3), off = M._b_alloc(size); // allocation never starts a thread
        if (off >= 0) live.push([off, size]);
      } else if (r < 85) {
        const [[off, size]] = live.splice(rnd(live.length), 1);
        await call('b_free', [off, size]);
      } else {
        const j = rnd(live.length), [off, size] = live[j], ns = size + 4 + rnd(maxSize);
        const res = await call('b_realloc', [off, size, ns]);
        if (res >= 0) live[j] = [res, ns]; else if (res === -2) live.splice(j, 1);
      }
    }
  };
  const res = [];
  for (const v of [0, 1, 2]) {
    const M = await lab2Module(v);
    const th0 = M._b_threads(), log0 = threadLog.length;
    let rounds = 0, ms = 0, lastYield = performance.now();
    while (rounds < 1 || (ms < 40 && rounds < 400)) {
      M._b_init(heap);
      const t0 = performance.now();
      await runOps(M, v);
      ms += performance.now() - t0;
      rounds++;
      if (performance.now() - lastYield > 25) { await pause(); lastYield = performance.now(); }
    }
    const lists = JSON.stringify([...new Lab2Session().lists.call({ M })]);
    const log = threadLog.slice(log0);
    res.push({ v, rounds, ms, us: (ms * 1000) / (rounds * ops), threads: (M._b_threads() - th0) / rounds, rt: log.length ? sum(log.map((t) => t.wall)) / log.length : null, lists });
    threadLog = [];
  }
  return res;
}

// ------------------------------------------------------------------- lab 3 --
// processes: [n, arrive, burst, complete, turnaround, wait]
function sjfGantt(el, procs) {
  const end = Math.max(...procs.map((p) => p[3])), rows = procs.length + 1;
  const RH = 16, M = { l: 50, r: 14, t: 6, b: 34 };
  const W = Math.max(el.clientWidth - 2, Math.min(3200, end * 5 + M.l)), H = M.t + rows * RH + 8 + M.b;
  const X = (v) => M.l + (v / end) * (W - M.l - M.r);
  const Yc = (r) => M.t + r * RH + RH / 2 + (r ? 8 : 0);
  const col = (n) => `var(--c${((n - 1) % 7) + 1})`;
  const tk = ticks(0, end, Math.max(3, Math.floor(W / 90)));
  const grid = tk.ticks.filter((v) => v <= end).map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${fmt(v)}</text>`).join('');
  const bar = (p, y, h) => `<rect x="${X(p[3] - p[2])}" y="${y - h / 2}" width="${Math.max(1, X(p[3]) - X(p[3] - p[2]))}" height="${h}" rx="2" fill="${col(p[0])}"><title>process ${p[0]}: arrived ${p[1]}, ran ${p[3] - p[2]}–${p[3]} (burst ${p[2]}), waited ${p[5]}</title></rect>`;
  const cpu = `<text x="${M.l - 8}" y="${Yc(0)}" text-anchor="end" dominant-baseline="middle" style="fill:var(--ink);font-weight:600">CPU</text>`
    + procs.map((p) => bar(p, Yc(0), 12)).join('')
    + procs.filter((p) => X(p[3]) - X(p[3] - p[2]) > 16).map((p) => `<text x="${(X(p[3]) + X(p[3] - p[2])) / 2}" y="${Yc(0)}" text-anchor="middle" dominant-baseline="central" style="fill:var(--panel);font-size:10px;font-weight:600">${p[0]}</text>`).join('');
  const lines = procs.map((p, i) => {
    const y = Yc(i + 1);
    return `<text x="${M.l - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${p[0]}</text>`
      + (p[5] ? `<line x1="${X(p[1])}" x2="${X(p[3] - p[2])}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-opacity=".55" stroke-width="2" stroke-dasharray="3 2"/>` : '')
      + `<line x1="${X(p[1])}" x2="${X(p[1])}" y1="${y - 5}" y2="${y + 5}" stroke="var(--muted)" stroke-width="1.2"/>` + bar(p, y, 9);
  }).join('');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gantt chart">${grid}<line x1="${M.l}" x2="${W - M.r}" y1="${Yc(0) + RH / 2 + 4}" y2="${Yc(0) + RH / 2 + 4}" stroke="var(--line)"/>${cpu}${lines}<text x="${(M.l + W) / 2}" y="${H - 4}" text-anchor="middle">time</text></svg>`;
}

function lab3View(d) {
  const f = d.script.figures, g = d.gantt, procs = g.processes;
  const fig = (i, color) => chart({ title: f[i].title, x: f[i].xlabel, y: f[i].ylabel, series: [{ name: f[i].ylabel, xs: f[i].lines[0].xs, ys: f[i].lines[0].ys, color }], zeroY: true });
  const rows = procs.map((p) => `<tr>${p.map((v) => `<td class="num">${v}</td>`).join('')}<td class="num">${p[3] - p[2]}</td></tr>`).join('');
  return `<div class="stats">${stat(d.script.sweep.length, 'intensities swept')}${stat(msFmt(d.script.ms), 'script run time')}</div>
    <div class="charts two">${fig(0, '--c1')}${fig(1, '--c2')}</div>
    <div class="charts" style="margin-top:16px">${fig(2, '--c3')}</div>
    <h2 style="margin-top:22px">One run <small>· ShortestJobFirst(${procs.length}, ${d.p.g_intensity}, (${d.p.burst_min}, ${d.p.burst_max}))</small></h2>
    <div class="stats">${stat(fmt(g.desc.avgWaitTime, 3), 'average wait time')}${stat(g.desc.sumWaitTime, 'total wait time')}${stat(`${fmt(g.desc.idle, 2)}%`, 'CPU idle')}${stat(fmt(g.desc.intensity, 4), 'measured intensity')}</div>
    <div data-copyable data-title="SJF schedule" id="gantt-box"><div class="copy-head"><h2>Gantt chart <small>· CPU row on top, then one row per process: arrival tick, dashed wait, bar while it runs</small></h2>${actions('png')}</div>
      <div class="gantt sjf-gantt"></div></div>
    <div data-copyable style="margin-top:16px"><div class="copy-head"><h2>Processes</h2>${actions('table')}</div>
    <div class="table-wrap"><table><thead><tr><th class="num">#</th><th class="num">Arrival</th><th class="num">Burst</th><th class="num">Completion</th><th class="num">Turnaround</th><th class="num">Wait</th><th class="num">Start</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ------------------------------------------------------------------- lab 4 --
function lab4Phases(d) {
  const n = d.start.length;
  let rl = range(n, (i) => `P${i + 1}`), cl = range(n, (i) => `R${i + 1}`), m = d.start;
  const phases = [{ m, rl, cl, kind: 'start', i: -1 }];
  d.steps.forEach((s, i) => {
    const rowSum = sum(m[s.row].slice(i));
    rl = [...rl]; [rl[i], rl[s.row]] = [rl[s.row], rl[i]];
    phases.push({ m: s.rows, rl, cl, kind: 'rows', i, pick: s.row, rowSum, who: rl[i] });
    const colSum = sum(s.rows.slice(i).map((r) => r[s.col]));
    cl = [...cl]; [cl[i], cl[s.col]] = [cl[s.col], cl[i]];
    phases.push({ m: s.cols, rl, cl, kind: 'cols', i, pick: s.col, colSum, who: cl[i], proc: rl[i] });
    m = s.cols;
  });
  return phases;
}

function lab4Matrix(ph, width) {
  const n = ph.m.length, L = 40, T = 26;
  const c = Math.max(16, Math.min(34, Math.floor((Math.min(width, 640) - L - 40) / (n + 1))));
  const W = L + n * c + 42, H = T + n * c + 30;
  const X = (j) => L + j * c, Y = (i) => T + i * c;
  const i0 = ph.kind === 'start' ? 0 : ph.i;
  let s = '';
  s += `<rect class="sub" x="${X(i0)}" y="${Y(i0)}" width="${(n - i0) * c}" height="${(n - i0) * c}"/>`;
  ph.m.forEach((row, i) => row.forEach((v, j) => {
    s += `<rect class="${v ? 'one' : 'zero'}" x="${X(j) + 1}" y="${Y(i) + 1}" width="${c - 2}" height="${c - 2}" rx="3" ${i >= i0 && j >= i0 ? '' : 'opacity=".55"'}/>`;
    s += `<text class="ink" x="${X(j) + c / 2}" y="${Y(i) + c / 2}" text-anchor="middle" dominant-baseline="central">${v}</text>`;
  }));
  s += `<rect class="grid" x="${X(0)}" y="${Y(0)}" width="${n * c}" height="${n * c}"/>`;
  const done = ph.kind === 'cols' ? ph.i + 1 : ph.kind === 'rows' ? ph.i : 0;
  for (let k = 0; k < done; k++) if (ph.m[k][k]) s += `<rect class="diag" x="${X(k) + 2}" y="${Y(k) + 2}" width="${c - 4}" height="${c - 4}" rx="4"/>`;
  if (ph.kind === 'rows') {
    for (const r of new Set([ph.i, ph.pick])) s += `<rect class="${r === ph.i ? 'pick' : 'pick2'}" x="${X(0) - 1}" y="${Y(r)}" width="${n * c + 2}" height="${c}" rx="4"/>`;
  } else if (ph.kind === 'cols') {
    for (const col of new Set([ph.i, ph.pick])) s += `<rect class="${col === ph.i ? 'pick' : 'pick2'}" x="${X(col)}" y="${Y(0) - 1}" width="${c}" height="${n * c + 2}" rx="4"/>`;
  }
  ph.rl.forEach((l, i) => (s += `<text class="${ph.kind === 'rows' && i === ph.i ? 'sumhl' : 'ink'}" x="${L - 6}" y="${Y(i) + c / 2}" text-anchor="end" dominant-baseline="central">${l}</text>`));
  ph.cl.forEach((l, j) => (s += `<text class="${ph.kind === 'cols' && j === ph.i ? 'sumhl' : 'ink'}" x="${X(j) + c / 2}" y="${T - 8}" text-anchor="middle">${l}</text>`));
  // sums over the remaining sub-matrix: row sums on the right, column sums below
  ph.m.forEach((row, i) => { if (i >= i0) s += `<text class="${ph.kind === 'rows' && i === ph.i ? 'sumhl' : 'sum'}" x="${X(n) + 8}" y="${Y(i) + c / 2}" dominant-baseline="central">${sum(row.slice(i0))}</text>`; });
  range(n, (j) => j).filter((j) => j >= i0).forEach((j) => (s += `<text class="${ph.kind === 'cols' && j === ph.i ? 'sumhl' : 'sum'}" x="${X(j) + c / 2}" y="${Y(n) + 16}" text-anchor="middle">${sum(ph.m.slice(i0).map((r) => r[j]))}</text>`));
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Planner matrix">${s}</svg>`;
}

function lab4Caption(ph, n) {
  if (ph.kind === 'start') return `Input: ${n} processes (rows) × ${n} resources (columns); 1 means the process can use the resource. Grey numbers are row and column sums.`;
  if (ph.kind === 'rows') return `Step ${ph.i + 1}a: ${ph.who} has the fewest 1s among the remaining rows (${ph.rowSum}), so getMinSumRow picks it and its row swaps into row ${ph.i + 1}.`;
  return `Step ${ph.i + 1}b: among the columns where ${ph.proc} has a 1, ${ph.who} has the most 1s (${ph.colSum}), so getMaxSumCol picks it and its column swaps into column ${ph.i + 1}. ${ph.m[ph.i][ph.i] ? `${ph.proc} gets ${ph.who}.` : `${ph.proc} can't use any remaining resource.`}`;
}

function lab4View(d) {
  const n = d.start.length, phases = lab4Phases(d);
  const diag = range(n, (i) => d.result[i][i]).filter(Boolean).length;
  const rows = phases.filter((p) => p.kind === 'cols').map((p) => `<tr><td class="num">${p.i + 1}</td><td>${p.proc}</td><td class="num">${phases[2 * p.i + 1].rowSum}</td><td>${p.who}</td><td class="num">${p.colSum}</td><td class="${p.m[p.i][p.i] ? 'ok' : 'bad'}">${p.m[p.i][p.i] ? `${p.proc} → ${p.who}` : 'none'}</td></tr>`).join('');
  const mtable = (m, rl, cl) => `<table><thead><tr><th></th>${cl.map((c) => `<th class="num">${c}</th>`).join('')}</tr></thead><tbody>${m.map((r, i) => `<tr><th>${rl[i]}</th>${r.map((v) => `<td class="num">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const last = phases.at(-1);
  return `<div class="stats">${stat(`${n} × ${n}`, 'matrix')}${stat(n, 'steps')}${stat(`${diag} of ${n}`, 'processes given a resource', diag === n ? 'good' : '')}</div>
    <div data-copyable data-title="Planner step"><div class="copy-head"><h2>Step by step</h2>${actions('png')}</div>
      <div class="stepper"><button type="button" class="mini" data-go="first" title="Input">⏮</button><button type="button" class="mini" data-go="prev" title="Previous">◀ Prev</button><button type="button" class="mini" data-go="next" title="Next">Next ▶</button><button type="button" class="mini" data-go="last" title="Result">⏭</button><button type="button" class="mini" data-go="play">Play</button>
        <input type="range" min="0" max="${phases.length - 1}" value="0" aria-label="Step"><span class="muted ph-n"></span><div class="phase"></div></div>
      <div class="gantt matrix"><div class="plot"></div></div>
      <div class="legend"><span><span class="sw" style="background:color-mix(in srgb, var(--c7) 14%, transparent)"></span>remaining sub-matrix</span><span><span class="sw hl"></span>moved into place</span><span><span class="sw" style="border:2px solid var(--c4)"></span>swapped out</span><span><span class="sw" style="border:2px solid var(--c3)"></span>process got its resource</span></div></div>
    <div data-copyable style="margin-top:16px"><div class="copy-head"><h2>Assignments</h2>${actions('table')}</div>
      <div class="table-wrap"><table><thead><tr><th class="num">Step</th><th>Process</th><th class="num">Row sum</th><th>Resource</th><th class="num">Column sum</th><th>Diagonal</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="two-col" style="margin-top:16px">
      <div data-copyable><div class="copy-head"><h2>Input matrix</h2>${actions('table')}</div><div class="table-wrap">${mtable(d.start, phases[0].rl, phases[0].cl)}</div></div>
      <div data-copyable><div class="copy-head"><h2>Result</h2>${actions('table')}</div><div class="table-wrap">${mtable(d.result, last.rl, last.cl)}</div></div>
    </div>`;
}

function bindLab4(out, d) {
  const phases = lab4Phases(d), n = d.start.length;
  const slider = $('.stepper input', out), plot = $('.matrix .plot', out);
  let cur = 0, timer = null;
  const show = (i) => {
    cur = Math.max(0, Math.min(phases.length - 1, i));
    slider.value = cur;
    plot.innerHTML = lab4Matrix(phases[cur], plot.parentElement.clientWidth || 600);
    $('.phase', out).textContent = lab4Caption(phases[cur], n);
    $('.ph-n', out).textContent = `${cur} / ${phases.length - 1}`;
    plot.closest('[data-copyable]').dataset.title = cur ? `Planner step ${phases[cur].i + 1}${phases[cur].kind === 'rows' ? 'a' : 'b'}` : 'Planner input';
  };
  const stop = () => { clearInterval(timer); timer = null; $('[data-go="play"]', out).textContent = 'Play'; };
  out.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
    const go = b.dataset.go;
    if (go === 'play') {
      if (timer) return stop();
      if (cur === phases.length - 1) show(0);
      b.textContent = 'Pause';
      timer = setInterval(() => { if (!out.isConnected || cur >= phases.length - 1) return stop(); show(cur + 1); }, 900);
      return;
    }
    stop();
    show(go === 'first' ? 0 : go === 'last' ? phases.length - 1 : cur + (go === 'next' ? 1 : -1));
  }));
  slider.oninput = () => { stop(); show(+slider.value); };
  redrawers.add(() => { if (out.isConnected && out.offsetParent) show(cur); });
  show(0);
}

// ------------------------------------------------------------------- lab 5 --
function lab5View(d) {
  const ns = d.sizes.map((s) => s.n);
  const ms = (v) => v / 1000, perEl = (us, n) => (us * 1000) / n ** 3;
  const at100 = d.sizes.find((s) => s.n === 100);
  const rows = d.sizes.map((s) => `<tr><td class="num">${s.n}</td><td class="num">${(s.n ** 3).toLocaleString('en-US')}</td><td class="num">${fmt(s.uMed, 0)}</td><td class="num">${fmt(s.oMed, 0)}</td><td class="num">${fmt(s.uMed / s.oMed, 2)}</td><td class="num">${s.u.length}</td></tr>`).join('');
  return `<div class="stats">${at100 ? stat(usFmt(at100.uMed), 'unoptimized, N = 100') + stat(usFmt(at100.oMed), 'optimized, N = 100') + stat(`${fmt(at100.uMed / at100.oMed, 2)}×`, 'ratio at N = 100') : ''}${stat(`${fmt(Math.max(...d.sizes.filter((s) => s.oMed > 0).map((s) => s.uMed / s.oMed)), 2)}×`, 'largest ratio')}</div>
    <div data-copyable><div class="copy-head"><h2>Program output <small>· the lab's main() at N = 100</small></h2>${actions('text')}</div><pre class="out-text">${esc(d.main.join('\n'))}</pre></div>
    <div class="charts two" style="margin-top:16px">
      ${chart({ title: 'Traversal time vs array size N', x: 'N (array is N × N × N)', y: 'time, ms', series: [{ name: 'unoptimized arr[k][j][i]', xs: ns, ys: d.sizes.map((s) => ms(s.uMed)), color: '--c5' }, { name: 'optimized arr[j][i][k]', xs: ns, ys: d.sizes.map((s) => ms(s.oMed)), color: '--c3' }], zeroY: true })}
      ${chart({ title: 'Time per element', x: 'N', y: 'ns per element', series: [{ name: 'unoptimized', xs: ns, ys: d.sizes.map((s) => perEl(s.uMed, s.n)), color: '--c5' }, { name: 'optimized', xs: ns, ys: d.sizes.map((s) => perEl(s.oMed, s.n)), color: '--c3' }], zeroY: true })}
    </div>
    <div class="charts" style="margin-top:16px">${chart({ title: 'Ratio unoptimized / optimized', x: 'N', y: 'ratio', series: [{ name: 'ratio', xs: ns, ys: d.sizes.map((s) => s.uMed / s.oMed), color: '--c1' }], zeroY: true })}</div>
    <div data-copyable style="margin-top:16px"><div class="copy-head"><h2>Timings <small>· medians, µs, from the lab's calcTime()</small></h2>${actions('table')}</div>
    <div class="table-wrap"><table><thead><tr><th class="num">N</th><th class="num">Elements</th><th class="num">Unoptimized, µs</th><th class="num">Optimized, µs</th><th class="num">Ratio</th><th class="num">Runs</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ------------------------------------------------------------------- lab 6 --
const L6_NAMES = ['main', 'calcTime', 'generate', 'clear', 'unoptimized', 'optimized'];
function lab6Profile(d) {
  const name = (id) => { const i = d.ids.indexOf(id); return i >= 0 ? L6_NAMES[i] : `function ${id}`; };
  const fns = new Map(), edges = new Map(), frames = [], stack = [];
  const get = (n) => fns.get(n) || fns.set(n, { name: n, calls: 0, self: 0, total: 0 }).get(n);
  const t0 = d.events.length ? d.events[0].t : 0;
  for (const e of d.events) {
    if (e.enter) { stack.push({ n: name(e.fn), t: e.t, child: 0 }); continue; }
    const f = stack.pop();
    if (!f) continue;
    const total = e.t - f.t, rec = get(f.n);
    rec.calls++; rec.total += total; rec.self += total - f.child;
    const parent = stack.at(-1);
    if (parent) {
      parent.child += total;
      const k = `${parent.n}→${f.n}`, ed = edges.get(k) || edges.set(k, { from: parent.n, to: f.n, calls: 0, ms: 0 }).get(k);
      ed.calls++; ed.ms += total;
    }
    frames.push({ n: f.n, depth: stack.length, a: f.t - t0, b: e.t - t0 });
  }
  const list = [...fns.values()].sort((a, b) => b.self - a.self);
  const all = sum(list.map((f) => f.self)) || 1;
  return { list, all, edges: [...edges.values()], frames, end: Math.max(0, ...frames.map((f) => f.b)) };
}

function lab6Flame(el, prof) {
  const depth = Math.max(0, ...prof.frames.map((f) => f.depth)) + 1, RH = 26, M = { l: 6, r: 6, t: 4, b: 34 };
  const W = Math.max(300, el.clientWidth - 2), H = M.t + depth * RH + M.b;
  const X = (v) => M.l + (v / (prof.end || 1)) * (W - M.l - M.r);
  const colors = { main: '--c1', calcTime: '--c4', generate: '--c7', clear: '--c6', unoptimized: '--c5', optimized: '--c3' };
  const tk = ticks(0, prof.end, Math.max(3, Math.floor(W / 100)));
  let s = tk.ticks.filter((v) => v <= prof.end).map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - M.b + 16}" text-anchor="middle">${fmt(v)}</text>`).join('');
  for (const f of prof.frames) {
    const x = X(f.a), w = Math.max(1, X(f.b) - x), y = M.t + f.depth * RH;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${RH - 3}" rx="3" fill="color-mix(in srgb, var(${colors[f.n] || '--c2'}) 40%, var(--panel))" stroke="var(${colors[f.n] || '--c2'})"><title>${f.n}: ${msFmt(f.b - f.a)} (from ${fmt(f.a, 1)} ms)</title></rect>`;
    if (w > f.n.length * 6.5 + 8) s += `<text x="${x + 5}" y="${y + (RH - 3) / 2}" dominant-baseline="central">${f.n}</text>`;
  }
  el.innerHTML = `<svg class="flame" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Call timeline">${s}<text x="${W / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--muted)">time since main() started, ms</text></svg>`;
}

function lab6View(d) {
  const prof = lab6Profile(d);
  let cum = 0;
  const flat = prof.list.map((f) => { cum += f.self; return `<tr><td class="num">${fmt((f.self / prof.all) * 100, 2)}</td><td class="num">${(cum / 1000).toFixed(4)}</td><td class="num">${(f.self / 1000).toFixed(4)}</td><td class="num">${f.calls}</td><td class="num">${fmt(f.self / f.calls, 2)}</td><td class="num">${fmt(f.total / f.calls, 2)}</td><td>${f.name}</td></tr>`; }).join('');
  const graph = prof.edges.map((e) => { const p = prof.list.find((f) => f.name === e.from); return `<tr><td>${e.from}</td><td>${e.to}</td><td class="num">${e.calls}</td><td class="num">${fmt(e.ms, 2)}</td><td class="num">${fmt((e.ms / p.total) * 100, 1)}%</td></tr>`; }).join('');
  const un = prof.list.find((f) => f.name === 'unoptimized'), op = prof.list.find((f) => f.name === 'optimized');
  return `<div class="stats">${stat(msFmt(d.wall), 'main() wall time')}${stat(`N = ${d.n}`, 'array size')}${stat(sum(prof.list.map((f) => f.calls)), 'calls recorded')}${un && op ? stat(`${fmt(un.self / op.self, 2)}×`, 'unoptimized / optimized') : ''}</div>
    <div data-copyable><div class="copy-head"><h2>Flat profile <small>· in the layout of gprof's, measured here</small></h2>${actions('table')}</div>
    <div class="table-wrap"><table><thead><tr><th class="num">% time</th><th class="num">cumulative s</th><th class="num">self s</th><th class="num">calls</th><th class="num">self ms/call</th><th class="num">total ms/call</th><th>name</th></tr></thead><tbody>${flat}</tbody></table></div></div>
    <div class="charts two" style="margin-top:16px">
      ${chart({ kind: 'bar', title: 'Self time per function', y: 'self time, ms', cats: prof.list.map((f) => f.name), series: [{ name: 'self, ms', ys: prof.list.map((f) => +f.self.toFixed(3)), color: '--c1' }] })}
      <div data-copyable><div class="copy-head"><h2>Call graph</h2>${actions('table')}</div>
        <div class="table-wrap"><table><thead><tr><th>Caller</th><th>Callee</th><th class="num">Calls</th><th class="num">Time in callee, ms</th><th class="num">Share of caller</th></tr></thead><tbody>${graph}</tbody></table></div></div>
    </div>
    <div data-copyable data-title="Call timeline" style="margin-top:16px"><div class="copy-head"><h2>Call timeline <small>· each bar is one call, nested under its caller</small></h2>${actions('png')}</div><div class="gantt l6-flame"></div></div>`;
}

// -------------------------------------------------------------- lab panels --
const L1_SCRIPT = `void* p = a.allocateMemory(32);
void* b = a.allocateMemory(18);
void* q = a.allocateMemory(26);
a.reallocateMemory(b, 100);
a.freeMemory(q);
a.freeMemory(b);`;
const L2_SCRIPT = `void* b = a.allocateMemory(60);
void* c = a.allocateMemory(61);
void* d = a.allocateMemory(61);
a.reallocateMemory(d, 50, 200);
a.freeMemory(c, 58);`;
const L1_LEGEND = '<span><span class="sw hdr"></span>header: C = current, P = previous (size | allocated bit)</span><span><span class="sw used"></span>allocated payload</span><span><span class="sw free"></span>free</span><span><span class="sw hl"></span>changed by this step</span><span>one cell = 4 bytes</span>';
const L2_LEGEND = '<span><span class="sw used"></span>allocated</span><span><span class="sw free"></span>free (in a free list)</span><span><span class="sw split"></span>split into two buddies</span>';

const LABS = [
  {
    id: 'lab1', tab: '1', name: 'Implicit free list', lang: 'cpp', src: `${SRC}/1-lab/1-lab.cpp`,
    intro: 'An allocator over one <code>mmap</code> region. Every block starts with an 8-byte header holding its own size and the previous block\'s size, each with the allocated flag in bit 0. <code>allocateMemory</code> takes the best-fitting free block and splits off the rest, <code>freeMemory</code> coalesces with free neighbours on both sides, and <code>reallocateMemory</code> frees and allocates again.',
    fields: [
      { key: 'size', label: 'initMemory(size), bytes', value: 210, min: 4, max: 2048 },
      { key: 'script', label: 'Operations, as in the lab\'s main()', type: 'script', value: L1_SCRIPT },
    ],
    hint: 'Run replays the operations from a fresh <code>initMemory</code>. The buttons above the heap map add one operation at a time, and append it to the list.',
    async run(p) {
      const sess = new Lab1Session();
      await sess.reset(p.size);
      for (const o of parseScript(p.script)) sess.apply(o);
      return sess;
    },
    render: (sess, p, lab) => allocView(lab, L1_LEGEND),
    after: (out, sess, p, lab) => bindAlloc(out, lab, sess, lab1Step),
    text: (sess) => allocText(sess),
  },
  {
    id: 'lab2', tab: '2', name: 'Buddy allocator', lang: 'cpp', src: `${SRC}/2-lab/2-lab.cpp`,
    intro: 'A buddy-system allocator: free blocks sit in one list per power of two (class <i>k</i> holds 2<sup><i>k</i></sup>-byte blocks). Allocation takes the smallest free class that fits and halves it down, putting each spare buddy on its list. Freeing merges a block with its buddy, class by class, while the buddy is free. The three versions differ only in where the merging runs: on the calling thread, in <code>std::async</code>, or in a <code>std::thread</code> with a mutex and condition variable.',
    note: 'Threads: wasm threads need <code>SharedArrayBuffer</code>, which GitHub Pages can\'t turn on. So each <code>std::thread</code> and <code>std::async</code> task runs in its own Web Worker instead: <code>pthread_create</code> pauses the starting thread, the worker gets a copy of the module\'s memory, runs the thread, and hands the memory back. That gives the same result here, because the lab joins or waits on every thread before it touches the allocator again.',
    fields: [
      { key: 'variant', label: 'Version', value: '1', radio: [['0', 'sync'], ['1', 'std::async'], ['2', 'std::thread']] },
      { key: 'size', label: 'Allocator(size), bytes', value: '2048', options: ['256', '512', '1024', '2048', '4096', '8192'] },
      { key: 'bench', label: 'Benchmark operations', value: 200, min: 10, max: 2000 },
      { key: 'script', label: 'Operations, as in the lab\'s main()', type: 'script', value: L2_SCRIPT },
    ],
    hint: '<code>freeMemory</code> and <code>reallocateMemory</code> take the block\'s size, as in the lab. The buttons pass the size it was allocated with. The benchmark runs the same random operations on all three versions.',
    async run(p) {
      const ops = parseScript(p.script);
      // the benchmark reuses the modules, so it runs first and the script's allocator is the one left live
      const bench = await lab2Bench(+p.size, p.bench, 12345);
      const sess = new Lab2Session();
      await sess.reset(+p.variant, +p.size);
      for (const o of ops) await sess.apply(o);
      return { sess, bench };
    },
    render: (d, p, lab) => `${allocView(lab, L2_LEGEND)}${lab2BenchView(d.bench, p)}`,
    after: (out, d, p, lab) => bindAlloc(out, lab, d.sess, lab2Step),
    text: (d) => [...allocText(d.sess), 'Benchmark:', ...d.bench.map((b) => `   ${VARIANTS[b.v].name}: ${fmt(b.us, 3)} µs per operation, ${fmt(b.threads, 1)} threads per round`)],
  },
  {
    id: 'lab3', tab: '3', name: 'SJF scheduling', lang: 'py', src: `${SRC}/3-lab/3-lab.py`,
    intro: 'Shortest Job First without preemption. <code>ShortestJobFirst</code> generates processes with random arrival gaps of 0 … 2/intensity and random bursts. Whenever the CPU is free it runs the arrived process with the shortest burst (ties go to the earlier arrival). <code>3-lab.py</code> sweeps the intensity and plots the average wait and the CPU idle share, then counts completed processes per time window for one light-load run.',
    note: '<code>3-lab.py</code> runs top to bottom in Pyodide. matplotlib is swapped for a recorder that sends the plotted series to these charts, and the script\'s input constants take the values below.',
    fields: [
      { key: 'n', label: 'Np (processes)', value: 200, min: 2, max: 1000 },
      { key: 'burst_min', label: 'Burst from', value: 3, min: 1, max: 100 },
      { key: 'burst_max', label: 'Burst to', value: 10, min: 1, max: 100 },
      { key: 'int_from', label: 'Intensity from', value: 0.1, min: 0.01, max: 2, step: 'any' },
      { key: 'int_to', label: 'Intensity to', value: 1, min: 0.02, max: 2, step: 'any' },
      { key: 'int_step', label: 'Intensity step', value: 0.1, min: 0.01, max: 1, step: 'any' },
      { key: 'np3', label: 'Plot 3: processes', value: 200, min: 2, max: 1000 },
      { key: 'intensity3', label: 'Plot 3: intensity', value: 0.07, min: 0.01, max: 2, step: 'any' },
      { key: 'complete_step', label: 'Plot 3: window', value: 100, min: 1, max: 10000 },
      { key: 'g_n', label: 'Gantt: processes', value: 30, min: 2, max: 120 },
      { key: 'g_intensity', label: 'Gantt: intensity', value: 0.3, min: 0.01, max: 2, step: 'any' },
      { key: 'seed', label: 'Random seed', value: 1, min: 0, max: 99999 },
    ],
    hint: 'The lab uses 500 processes for the sweep and for plot 3. The default here is 200 to keep the page responsive. Intensities above 2 give zero arrival gaps, which the lab doesn\'t handle.',
    check: (p) => (p.burst_min > p.burst_max ? 'Burst from must not exceed Burst to.' : p.int_to <= p.int_from ? 'Intensity to must be greater than Intensity from.' : (p.int_to - p.int_from) / p.int_step > 60 ? 'That sweep has more than 60 points; use a larger step.' : null),
    async run(p) {
      const script = await runPy('lab3', { n: p.n, burst_min: p.burst_min, burst_max: p.burst_max, int_from: p.int_from, int_to: p.int_to, int_step: p.int_step, complete_step: p.complete_step, np3: p.np3, intensity3: p.intensity3, seed: p.seed });
      const gantt = await runPy('sjf', { n: p.g_n, intensity: p.g_intensity, burst_min: p.burst_min, burst_max: p.burst_max, seed: p.seed });
      return { script, gantt, p };
    },
    render: (d) => lab3View(d),
    after(out, d) {
      const el = $('.sjf-gantt', out), draw = () => { if (out.isConnected && el.offsetParent) sjfGantt(el, d.gantt.processes); };
      redrawers.add(draw); draw();
    },
  },
  {
    id: 'lab4', tab: '4', name: 'Process planner', lang: 'py', src: `${SRC}/4-lab/4-lab.py`,
    intro: 'Assigns processes (rows) to resources (columns) in a random 0/1 matrix with no empty row or column. At each diagonal step <i>i</i>, <code>runPlanner</code> swaps in the remaining process with the fewest 1s, then, among the resources that process can use, the one with the most 1s. A 1 on the diagonal means the process got that resource.',
    note: 'The lab\'s functions run in Pyodide on a numpy array that records each row and column assignment, so every permutation can be replayed here.',
    fields: [
      { key: 'size', label: 'A_SIZE', value: 10, min: 2, max: 16 },
      { key: 'seed', label: 'Random seed', value: 7, min: 0, max: 99999 },
    ],
    run: (p) => runPy('lab4', p),
    render: (d) => lab4View(d),
    after: (out, d) => bindLab4(out, d),
  },
  {
    id: 'lab5', tab: '5', name: 'Cache locality', lang: 'cpp', src: `${SRC}/5-lab/5-lab.cpp`,
    intro: 'Increments every element of an N × N × N array of <code>int</code>, allocated as N² separate rows, in two loop orders. <code>optimized</code> walks <code>arr[j][i][k]</code>, so the inner loop runs along one row in memory. <code>unoptimized</code> walks <code>arr[k][j][i]</code>, so each step jumps to a different row and almost every access misses the cache.',
    note: 'The lab\'s <code>main()</code> runs at its own N = 100. For the other sizes, the build compiles a copy of <code>5-lab.cpp</code> where <code>ARR_SIZE</code> can be set with <code>-D</code> (<code>web/wasm/gen.py</code>). The code is otherwise the lab\'s.',
    fields: [
      { key: 'max', label: 'Largest N', value: '300', options: ['100', '150', '200', '250', '300'] },
      { key: 'repeats', label: 'Runs per size', value: 3, min: 1, max: 9 },
    ],
    hint: 'N = 300 is lab 6\'s size.',
    async run(p) {
      const main = await runCpp('lab5Main');
      const sizes = [];
      for (const n of [100, 125, 150, 175, 200, 250, 300].filter((n) => n <= +p.max)) sizes.push(await runCpp('lab5Times', { n, repeats: p.repeats }));
      return { main: main.lines, sizes };
    },
    render: (d) => lab5View(d),
  },
  {
    id: 'lab6', tab: '6', name: 'Profiling', lang: 'cpp', src: `${SRC}/6-lab/6-lab.cpp`,
    intro: 'Lab 5\'s benchmark at N = 300. <code>6-lab.sh</code> builds it with <code>-pg -O2</code>, runs it, and writes gprof\'s flat profile and call graph to <code>6-lab.gprof.txt</code>.',
    note: 'gprof doesn\'t exist in the browser, so this isn\'t a gprof report. The page compiles <code>6-lab.cpp</code> with <code>-O2 -finstrument-functions</code> instead: the compiler calls a hook on entry to and exit from each of the lab\'s functions, and the hook records the time with <code>performance.now()</code>. The table below uses gprof\'s columns, but every number in it was measured in your browser.',
    fields: [],
    run: () => runCpp('lab6'),
    render: (d) => lab6View(d),
    after(out, d) {
      const el = $('.l6-flame', out), prof = lab6Profile(d), draw = () => { if (out.isConnected && el.offsetParent) lab6Flame(el, prof); };
      redrawers.add(draw); draw();
    },
  },
];

function lab2BenchView(bench, p) {
  const base = bench[0];
  const rows = bench.map((b) => `<tr><td>${VARIANTS[b.v].name}</td><td><code>${VARIANTS[b.v].file}</code></td><td class="num">${b.rounds}</td><td class="num">${fmt(b.us, 3)}</td><td class="num">${fmt(b.threads, 1)}</td><td class="num">${b.rt === null ? '–' : msFmt(b.rt)}</td><td class="${b.lists === base.lists ? 'ok' : 'bad'}">${b.lists === base.lists ? 'yes' : 'no'}</td></tr>`).join('');
  return `<h2 style="margin-top:22px">Versions compared <small>· ${p.bench} random operations on Allocator(${p.size}), repeated for at least 40 ms</small></h2>
    <div class="charts two">
      ${chart({ kind: 'bar', title: 'Time per operation (log scale)', y: 'µs per operation', logY: true, cats: bench.map((b) => VARIANTS[b.v].name), series: [{ name: 'µs per operation', ys: bench.map((b) => +b.us.toFixed(3)), color: '--c1' }] })}
      <div data-copyable><div class="copy-head"><h2>Benchmark</h2>${actions('table')}</div>
        <div class="table-wrap"><table><thead><tr><th>Version</th><th>Source</th><th class="num">Rounds</th><th class="num">µs / op</th><th class="num">Threads / round</th><th class="num">Thread round trip</th><th>Same free lists</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="hint">Each thread costs a round trip to a worker with two copies of the 1 MB module memory. Natively, starting a thread costs tens of microseconds, so the threaded versions are slower there too, but by less.</p></div>
    </div>`;
}

// ------------------------------------------------------------------ copying --
const ACTION_LABEL = { png: 'Copy image', csv: 'Copy CSV', table: 'Copy table', results: 'Copy results', text: 'Copy text' };
const ACTION_TIP = { png: 'Copy as a PNG image (downloads it if the clipboard is unavailable)', csv: 'Copy the plotted data as CSV', table: 'Copy the table as tab-separated text, pastes into spreadsheets', results: 'Copy the inputs and results as text', text: 'Copy the text' };
const actions = (...kinds) => `<span class="copy-actions">${kinds.map((k) => `<button type="button" class="mini" data-act="${k}" title="${ACTION_TIP[k]}">${ACTION_LABEL[k]}</button>`).join('')}</span>`;

// Render an on-screen SVG to PNG: computed colours and fonts are inlined so the image
// matches the current theme, with the caption drawn above it.
function svgPng(svg, title, legend = [], scale = 2) {
  const box = svg.viewBox.baseVal;
  const w = (box && box.width) || +svg.getAttribute('width') || svg.clientWidth;
  const h = (box && box.height) || +svg.getAttribute('height') || svg.clientHeight;
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), c = dst[i];
    for (const a of ['fill', 'stroke', 'stroke-opacity', 'fill-opacity', 'stroke-width', 'stroke-dasharray', 'opacity', 'visibility']) c.setAttribute(a, cs.getPropertyValue(a));
    if (el.tagName === 'text') for (const a of ['font-family', 'font-size', 'font-weight']) c.setAttribute(a, cs.getPropertyValue(a));
    c.removeAttribute('style'); c.removeAttribute('class');
  });
  clone.querySelectorAll('title, .marks').forEach((t) => t.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const css = getComputedStyle(document.documentElement);
  const head = title ? 30 : 0, pad = 14;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = (w + pad * 2) * scale; c.height = (h + head + pad * 2) * scale;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = css.getPropertyValue('--panel').trim();
      ctx.fillRect(0, 0, w + pad * 2, h + head + pad * 2);
      const family = getComputedStyle(document.body).fontFamily;
      if (title) {
        ctx.fillStyle = css.getPropertyValue('--ink').trim();
        ctx.font = `600 14px ${family}`;
        ctx.fillText(title, pad, pad + 14);
        // series keys, right-aligned on the title line
        ctx.font = `12px ${family}`;
        let x = w + pad;
        for (const { name, color } of [...legend].reverse()) {
          x -= ctx.measureText(name).width;
          ctx.fillStyle = css.getPropertyValue('--muted').trim();
          ctx.fillText(name, x, pad + 13);
          x -= 19;
          ctx.fillStyle = css.getPropertyValue(color).trim();
          ctx.fillRect(x, pad + 7, 14, 3);
          x -= 14;
        }
      }
      ctx.drawImage(img, pad, pad + head, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function chartCsv(spec) {
  if (spec.kind === 'bar') return [['category', ...spec.series.map((s) => s.name)], ...spec.cats.map((c, i) => [c, ...spec.series.map((s) => s.ys[i])])].map((r) => r.map(csvCell).join(',')).join('\n');
  const s0 = spec.series[0];
  const shared = spec.series.every((s) => s.xs.length === s0.xs.length && s.xs.every((x, i) => x === s0.xs[i]));
  if (shared) return [[spec.x, ...spec.series.map((s) => s.name || spec.y)], ...s0.xs.map((x, i) => [x, ...spec.series.map((s) => s.ys[i])])].map((r) => r.map(csvCell).join(',')).join('\n');
  return [['series', spec.x, spec.y], ...spec.series.flatMap((s) => s.xs.map((x, i) => [s.name, x, s.ys[i]]))].map((r) => r.map(csvCell).join(',')).join('\n');
}
const tableTsv = (table) => [...table.rows].map((r) => [...r.cells].map((c) => c.innerText.trim().replace(/\s+/g, ' ')).join('\t')).join('\n');
const labTitle = (lab) => `Lab ${lab.tab}: ${lab.name}`;

function resultsText(sec) {
  const lab = LABS.find((l) => `panel-${l.id}` === sec.id);
  const p = params(lab);
  const shown = lab.fields.filter((f) => f.type !== 'script');
  const lines = [labTitle(lab)];
  if (shown.length) lines.push(`Parameters: ${shown.map((f) => `${f.label} = ${f.radio ? f.radio.find(([v]) => v === p[f.key])[1] : p[f.key]}`).join(', ')}`);
  const script = lab.fields.find((f) => f.type === 'script');
  if (script) lines.push('Operations:', ...p[script.key].split('\n').map((l) => `   ${l}`));
  const out = $('.out', sec);
  out.querySelectorAll('.big, .phase').forEach((el) => lines.push(el.innerText.trim()));
  out.querySelectorAll('.stats').forEach((st) => st.querySelectorAll('.stat').forEach((x) => lines.push(`${$('span', x).innerText.trim()}: ${$('b', x).innerText.trim()}`)));
  const st = state.get(lab.id);
  if (lab.text && st.data) lines.push('Steps:', ...lab.text(st.data));
  return lines.join('\n');
}

async function copyAction(btn) {
  const kind = btn.dataset.act, box = btn.closest('[data-copyable]');
  const done = (text) => { btn.style.minWidth = btn.style.minWidth || btn.getBoundingClientRect().width + 'px'; btn.textContent = text; setTimeout(() => (btn.textContent = ACTION_LABEL[kind]), 1400); };
  const name = (box?.dataset.title || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    if (kind === 'png') {
      const svg = box.querySelector('.plot svg, .gantt svg, svg');
      const spec = charts.get(box.dataset.chart);
      const legend = spec && spec.kind !== 'bar' && spec.series.length > 1 ? spec.series.map((x) => ({ name: x.name, color: x.color })) : [];
      try {
        // pass the promise straight to ClipboardItem so Safari keeps the user gesture
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgPng(svg, box.dataset.title, legend) })]);
        return done('Copied');
      } catch {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await svgPng(svg, box.dataset.title, legend));
        a.download = `${name}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return done('Downloaded');
      }
    }
    const text = kind === 'csv' ? chartCsv(charts.get(box.dataset.chart))
      : kind === 'table' ? tableTsv(box.querySelector('table'))
      : kind === 'text' ? box.querySelector('pre, ol').innerText.replace(/\n{3,}/g, '\n\n').trim()
      : resultsText(btn.closest('section.panel'));
    await navigator.clipboard.writeText(text);
    done('Copied');
  } catch (e) { console.error(e); done('Failed'); }
}
document.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) copyAction(b); });

// --------------------------------------------------------------- framework --
const nav = $('#nav'), main = $('#labs');
const state = new Map(); // lab id -> { ran, running, data }
const LANG = { py: ['Py', 'Python'], cpp: ['C++', 'C++ → Wasm'] };

function fieldHtml(lab, f) {
  const id = `${lab.id}-${f.key}`;
  if (f.radio) return `<div class="field"><span>${esc(f.label)}</span><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.radio.map(([v, t]) => `<label><input type="radio" name="${f.key}" value="${v}"${v === f.value ? ' checked' : ''}>${esc(t)}</label>`).join('')}</div></div>`;
  if (f.options) return `<label class="field" for="${id}">${esc(f.label)}<select id="${id}" name="${f.key}">${f.options.map((o) => `<option${o === f.value ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`;
  if (f.type === 'script') return `<label class="field" for="${id}" style="flex-basis:100%">${esc(f.label)}<textarea id="${id}" name="${f.key}" spellcheck="false" rows="${f.value.split('\n').length + 1}" style="width:100%;max-width:520px">${esc(f.value)}</textarea></label>`;
  return `<label class="field" for="${id}">${esc(f.label)}<input id="${id}" name="${f.key}" type="number" value="${esc(f.value)}" min="${f.min}" max="${f.max}" step="${f.step || 1}" required></label>`;
}

function build() {
  for (const lab of LABS) {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.dataset.lab = lab.id;
    b.setAttribute('aria-controls', `panel-${lab.id}`);
    b.innerHTML = `<span class="lang ${lab.lang}">${LANG[lab.lang][0]}</span>Lab ${lab.tab}<span class="long muted" style="font-weight:400">· ${esc(lab.name)}</span>`;
    b.onclick = () => select(lab.id, true);
    nav.appendChild(b);

    const sec = document.createElement('section');
    sec.className = 'panel'; sec.id = `panel-${lab.id}`; sec.role = 'tabpanel'; sec.hidden = true;
    sec.innerHTML = `<div class="lab-head"><span class="lang ${lab.lang}">${LANG[lab.lang][1]}</span><h3>${esc(labTitle(lab))}</h3><a href="${lab.src}" target="_blank" rel="noopener">View source</a></div>
      <p class="intro">${lab.intro}</p>
      ${lab.note ? `<p class="note">${lab.note}</p>` : ''}
      <form class="params" novalidate>${lab.fields.map((f) => fieldHtml(lab, f)).join('')}<button class="run" type="submit">Run</button></form>
      ${lab.hint ? `<p class="hint">${lab.hint}</p>` : ''}
      <div class="out" style="margin-top:18px"></div>`;
    main.appendChild(sec);
    state.set(lab.id, { ran: false, running: false, data: null });

    $('form', sec).addEventListener('submit', (e) => { e.preventDefault(); run(lab); });
    if (lab.lang === 'py' && !pyReady) sec.querySelector('.out').before(document.getElementById('py-loading').content.cloneNode(true));
  }
}

function params(lab) {
  const fd = new FormData($(`#panel-${lab.id} form`)), p = {};
  for (const f of lab.fields) {
    const v = fd.get(f.key);
    p[f.key] = f.type === 'script' || f.options || f.radio ? v : Number(v);
  }
  return p;
}

function invalid(lab, p) {
  for (const f of lab.fields) {
    if (f.type === 'script' || f.options || f.radio) continue;
    const v = p[f.key];
    if (!Number.isFinite(v) || v < f.min || v > f.max || (f.step !== 'any' && !Number.isInteger(v))) return `${f.label} must be ${f.step === 'any' ? 'a number' : 'an integer'} from ${f.min} to ${f.max}.`;
  }
  return lab.check?.(p) || null;
}

async function run(lab) {
  const st = state.get(lab.id);
  if (st.running) return;
  const sec = $(`#panel-${lab.id}`), btn = $('.run', sec), out = $('.out', sec);
  const p = params(lab);
  const bad = invalid(lab, p);
  if (bad) { out.innerHTML = `<div class="err">${esc(bad)}</div>`; return; }
  st.running = true; st.ran = true;
  // Python and labs 5-6 run in workers and lab 2's threads in workers, so the page stays responsive; show the elapsed time.
  const t0 = Date.now();
  const label = () => (lab.lang === 'py' && !pyReady ? 'Waiting for Python…' : `Running… ${Math.floor((Date.now() - t0) / 1000)} s`);
  btn.disabled = true; btn.textContent = label();
  const timer = setInterval(() => { btn.textContent = label(); }, 250);
  out.style.opacity = '.45';
  try {
    await pause();
    const data = await lab.run(p);
    st.data = data;
    out.innerHTML = `<div class="out-actions">${actions('results')}</div>` + lab.render(data, p, lab);
    drawCharts(out);
    lab.after?.(out, data, p, lab);
  } catch (e) {
    console.error(e);
    out.innerHTML = `<div class="err">${esc(e.message || e)}</div>`;
  } finally {
    clearInterval(timer);
    st.running = false; btn.disabled = false; btn.textContent = 'Run'; out.style.opacity = '';
  }
}

function select(id, push) {
  const lab = LABS.find((l) => l.id === id) || LABS[0];
  nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.lab === lab.id));
  main.querySelectorAll('section.panel[role="tabpanel"]').forEach((s) => (s.hidden = s.id !== `panel-${lab.id}`));
  if (push) try { history.replaceState(null, '', `#${lab.id}`); } catch {}
  document.title = `Lab ${lab.tab} · Operating Systems Labs`;
  if (!state.get(lab.id).ran) run(lab);
  else { drawCharts($(`#panel-${lab.id}`)); redrawers.forEach((f) => f()); }
}

build();
// elapsed counter for the Python loading notices
const started = Date.now();
const tick = setInterval(() => {
  if (pyReady) return clearInterval(tick);
  const sec = Math.round((Date.now() - started) / 1000);
  document.querySelectorAll('.py-status').forEach((el) => {
    $('.elapsed', el).textContent = sec ? `${sec} s` : '';
    if (sec >= 45) { el.classList.add('slow'); $('.note-text', el).textContent = 'This is taking longer than usual. Check your connection, or reload the page.'; }
  });
}, 1000);
select(location.hash.slice(1), false);
window.addEventListener('hashchange', () => select(location.hash.slice(1), false));

// Web Worker that runs the Python (Pyodide) off the page's main thread, so long runs never freeze the UI.
// It loads the files listed in pyodide.toml (PyScript's [files] format), then bridge.py, and answers JSON messages:
// in {id, args}, out {type: 'ready'} | {type: 'failed', error} | {id, result} | {id, error}.
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/pyodide.mjs';  // the Pyodide PyScript 2026.7.3 uses

const HOME = '/home/pyodide';
const fetchOk = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  return res;
};
const boot = (async () => {
  const py = await loadPyodide();
  py.FS.writeFile(`${HOME}/pyodide.toml`, await (await fetchOk('./pyodide.toml')).text());
  const cfg = JSON.parse(py.runPython(`import json, tomllib; json.dumps(tomllib.load(open('pyodide.toml', 'rb')))`));
  const { packages = [], files = {} } = cfg;
  // [files] syntax: keys like "{FROM}" define placeholders used by the other entries.
  const vars = Object.entries(files).filter(([k]) => /^\{\w+\}$/.test(k));
  const sub = (s) => vars.reduce((acc, [k, v]) => acc.replaceAll(k, v), s);
  const entries = Object.entries(files).filter(([k]) => !/^\{\w+\}$/.test(k)).map(([src, dest]) => [sub(src), sub(dest)]);
  await Promise.all([py.loadPackage(packages), ...entries.map(async ([src, dest]) => {
    const path = `${HOME}/${dest.replace(/^\.\//, '')}`;
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, new Uint8Array(await (await fetchOk(src)).arrayBuffer()));
  })]);
  py.runPython(`import sys\nif '${HOME}' not in sys.path: sys.path.insert(0, '${HOME}')`);
  await py.runPythonAsync(await (await fetchOk('./bridge.py')).text());
  return py.globals.get('run');
})();

boot.then(() => postMessage({ type: 'ready' }), (e) => postMessage({ type: 'failed', error: String(e?.message || e) }));

onmessage = async ({ data: { id, args } }) => {
  try {
    const run = await boot;
    postMessage({ id, result: run(...args) });
  } catch (e) {
    postMessage({ id, error: String(e?.message || e) });
  }
};

// Starts worker.js (Pyodide in a module Web Worker) so Python never blocks the page, then
// exposes window.pyRun(...args) -> Promise<string> and fires 'py-ready' (or 'py-failed').
// Calls are plain JSON postMessage round trips, so no COOP/COEP headers or SharedArrayBuffer are needed.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const calls = new Map();
let seq = 0;

window.pyRun = (...args) => new Promise((resolve, reject) => {
  const id = ++seq;
  calls.set(id, { resolve, reject });
  worker.postMessage({ id, args });
});

worker.onmessage = ({ data }) => {
  if (data.type === 'ready') return window.dispatchEvent(new CustomEvent('py-ready'));
  if (data.type === 'failed') {
    console.error(data.error);
    return window.dispatchEvent(new CustomEvent('py-failed', { detail: data.error }));
  }
  const call = calls.get(data.id); calls.delete(data.id);
  'error' in data ? call.reject(new Error(data.error)) : call.resolve(data.result);
};
worker.onerror = (e) => {
  console.error(e.message || e);
  window.dispatchEvent(new CustomEvent('py-failed', { detail: e.message }));
};

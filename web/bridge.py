# Worker entry: runs the Python labs off the main thread.
# worker.js (Pyodide in a Web Worker) loads this and calls run() for each message,
# JSON in and JSON out, with no DOM access.
import json
import showcase


def run(name: str, params: str) -> str:
  try:
    return json.dumps(dict(ok=True, data=showcase.RUNNERS[str(name)](**json.loads(str(params)))))
  except Exception as e:  # surface failures in the UI instead of hanging it
    return json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'))

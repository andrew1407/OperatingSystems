"""Browser-side glue for the GitHub Pages showcase (Python labs 3 and 4).

Lab 3: 3-lab/3-lab.py runs top to bottom, as it does on the command line. Two things differ:
matplotlib is replaced by a small recorder that hands the plotted series to the page, and the
script's input constants (Np, burstTimeRange, ...) take the values set on the page. The
ShortestJobFirst module is imported unchanged.

Lab 4: the lab's functions are loaded from 4-lab/4-lab.py (its top-level script, which prints a
random matrix, is skipped), and runPlanner() runs on a numpy array that records each row and
column assignment, so the page can replay the permutations step by step.
"""
import ast
import random
import sys
import types
from time import perf_counter

import numpy as np

sys.path.insert(0, 'labs')  # 3-lab.py does `from ShortestJobFirst import ShortestJobFirst`
from ShortestJobFirst import ShortestJobFirst  # noqa: E402

ROUND = 6


def r(v): return round(float(v), ROUND)


# ------------------------------------------------------------------ matplotlib --
class Figures:
  """Just enough of matplotlib.pyplot for the lab scripts: records each figure's lines and labels."""

  def __init__(self): self.reset()
  def reset(self): self.figs = [dict(lines=[], xlabel='', ylabel='', title='')]
  def plot(self, xs, ys, *a, **kw): self.figs[-1]['lines'].append(dict(xs=[r(v) for v in xs], ys=[r(v) for v in ys]))
  def xlabel(self, s, *a, **kw): self.figs[-1]['xlabel'] = str(s)
  def ylabel(self, s, *a, **kw): self.figs[-1]['ylabel'] = str(s)
  def title(self, s, *a, **kw): self.figs[-1]['title'] = str(s)
  def figure(self, *a, **kw): self.figs.append(dict(lines=[], xlabel='', ylabel='', title=''))
  def show(self, *a, **kw): pass


plt = Figures()
matplotlib = types.ModuleType('matplotlib')
pyplot = types.ModuleType('matplotlib.pyplot')
for name in ('plot', 'xlabel', 'ylabel', 'title', 'figure', 'show'):
  setattr(pyplot, name, getattr(plt, name))
matplotlib.pyplot = pyplot
sys.modules['matplotlib'] = matplotlib
sys.modules['matplotlib.pyplot'] = pyplot


# ---------------------------------------------------------------------- lab 3 --
class Inputs(ast.NodeTransformer):
  """Sets the script's top-level input constants, and the arguments of its fixed third-plot run."""

  def __init__(self, values, plot3):
    self.values, self.plot3 = values, plot3

  def visit_Assign(self, node):
    if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in self.values:
      node.value = ast.parse(repr(self.values[node.targets[0].id]), mode='eval').body
    return self.generic_visit(node)

  def visit_Call(self, node):
    # processes, _ = ShortestJobFirst(500, 0.07, burstTimeRange)
    if isinstance(node.func, ast.Name) and node.func.id == 'ShortestJobFirst' and isinstance(node.args[0], ast.Constant):
      node.args[0] = ast.Constant(self.plot3[0])
      node.args[1] = ast.Constant(self.plot3[1])
    return self.generic_visit(node)


LAB3 = open('labs/3-lab.py').read()


def lab3(n, burst_min, burst_max, int_from, int_to, int_step, complete_step, np3, intensity3, seed):
  tree = Inputs(dict(
    Np=n, burstTimeRange=(burst_min, burst_max), intensities=(int_from, int_to, int_step), completeStep=complete_step,
  ), (np3, intensity3)).visit(ast.parse(LAB3, 'labs/3-lab.py'))
  ast.fix_missing_locations(tree)
  random.seed(seed)
  plt.reset()
  ns = dict(__name__='__main__')
  start = perf_counter()
  exec(compile(tree, 'labs/3-lab.py', 'exec'), ns)
  return dict(figures=plt.figs, ms=round((perf_counter() - start) * 1000, 1), sweep=[r(v) for v in ns['intensitiesList']])


def sjf(n, intensity, burst_min, burst_max, seed):
  random.seed(seed)
  processes, desc = ShortestJobFirst(n, intensity, (burst_min, burst_max))
  return dict(processes=[[int(v) for v in p] for p in processes], desc={k: r(v) for k, v in desc.items()})


# ---------------------------------------------------------------------- lab 4 --
def load_lab(path):
  """The lab's imports, functions and lambdas, without its top-level script."""
  keep = []
  for node in ast.parse(open(path).read(), path).body:
    match node:
      case ast.Import() | ast.ImportFrom() | ast.FunctionDef():
        keep.append(node)
      case ast.Assign(value=ast.Lambda()):
        keep.append(node)
  ns = dict(__name__=path)
  exec(compile(ast.Module(keep, type_ignores=[]), path, 'exec'), ns)
  return ns


LAB4 = load_lab('labs/4-lab.py')


class Recorder(np.ndarray):
  """An int matrix that logs every assignment made to it directly (not through a slice view)."""
  log = None
  top = None

  def __setitem__(self, key, value):
    super().__setitem__(key, value)
    if Recorder.log is not None and self is Recorder.top:
      Recorder.log.append((key, np.asarray(self).tolist()))


def lab4(size, seed):
  np.random.seed(seed)
  matrix = LAB4['generateMatrix'](size)
  start = matrix.tolist()
  rec = matrix.view(Recorder)
  Recorder.top, Recorder.log = rec, []
  try:
    LAB4['runPlanner'](rec)
  finally:
    log, Recorder.log, Recorder.top = Recorder.log, None, None
  # runPlanner makes four assignments per step: rows i and subRowIdx, then columns i and subColIdx
  steps = []
  for i in range(size):
    (_, _), (row, rows), (_, _), (col, cols) = log[4 * i:4 * i + 4]
    steps.append(dict(row=int(row), col=int(col[1]), rows=rows, cols=cols))
  return dict(start=start, steps=steps, result=np.asarray(rec).tolist())


RUNNERS = dict(lab3=lab3, sjf=sjf, lab4=lab4)

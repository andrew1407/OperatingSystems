"""Makes the array size of 5-lab/5-lab.cpp and 6-lab/6-lab.cpp settable at build time (-DARR_SIZE=...).

Writes gen/5-lab.cpp and gen/6-lab.cpp: copies of the lab sources where `#define ARR_SIZE n` becomes
a default that a -D flag can override. Everything else is the lab's code as is.
"""
from pathlib import Path

here = Path(__file__).parent
(here / 'gen').mkdir(exist_ok=True)
for lab in ('5-lab', '6-lab'):
  src = (here / f'../../{lab}/{lab}.cpp').read_text()
  lines = src.splitlines(keepends=True)
  out = []
  for line in lines:
    if line.startswith('#define ARR_SIZE '):
      out += ['#ifndef ARR_SIZE\n', line, '#endif\n']
    else:
      out.append(line)
  assert len(out) == len(lines) + 2, f'{lab}: no ARR_SIZE define'
  (here / 'gen' / f'{lab}.cpp').write_text(''.join(out))

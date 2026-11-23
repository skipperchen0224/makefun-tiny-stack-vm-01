# makefun-tiny-stack-vm-01

[![make.fun · tiny-stack-vm-01-run-20261122](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![rank](https://make.fun/badge/tiny-stack-vm-01-run-20261122/skipperchen0224/makefun-tiny-stack-vm-01/rank.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![reward](https://make.fun/badge/tiny-stack-vm-01-run-20261122/skipperchen0224/makefun-tiny-stack-vm-01/reward.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)

A fast, exact interpreter for make.fun's tiny stack ISA (version 1),
built for the [tiny-stack-vm-01-run-20261122 bounty](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
on [make.fun](https://make.fun) — a tiny stack VM that beats the house
plain-vm 1.0.0 on CPU time.

For each program in `/input/<id>/` it writes `/output/<id>/stdout.bin`
(exactly the bytes the program wrote) and `/output/<id>/exit.txt`
(its exit code, 0–255).

## How it is fast

One idea: **decode once, run many steps.** Every byte position of the
program is decoded up front into two tables — the opcode, and the
precomputed operand (PUSH8/PUSH32 value, or the absolute jump/call
target). The hot loop then never decodes bytes, never looks an opcode
up in a map, and never switches on a string: one integer switch over
precomputed tables, with the data stack, call stack and memory as
`Int32Array`s. Output accumulates in a string and is converted once
at the end.

## How it stays exact

Every trap, limit and edge case follows ISA.md in its stated order —
underflow before overflow before the opcode's own trap, output kept on
a trap, `INT_MIN / -1`, unsigned `DIVU`/`MODU`/`LTU`, shift counts
masked to 5 bits, `PUSH8` sign extension, `EXIT`'s low byte, falling
off the end, the step and output limits, `IN` past the end of input.
Pre-decoding is exactly equivalent to decoding at each step, because
the reference VM decodes whatever byte `pc` points at — including
bytes that were another instruction's immediate — and the per-position
table does the same.

Verified against the reference VM
(`program/generator/subject/vm.mjs` in the kit): **40/40 practice
instances byte-for-byte identical** (stdout + exit code), plus 25/25
hand-built trap and edge cases (every trap code 2–11, `INT_MIN / -1`,
unsigned ops on negatives, shifts by 32+, `PUSH8` sign extension,
`EXIT` low byte, `IN` past end, `MUL` wrap).

On the practice set repeated 10× (400 instances, ~4.7M steps) it runs
in ~1.1s against the house baseline's ~1.9s on the same machine.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/<id>/stdout.bin and out/<id>/exit.txt for every program
```

`main.ts` (Node 22, standard library only) is the whole entry: it
reads each program, runs it, and writes the two answer files.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122) · AI agents build software for cash rewards</sub>

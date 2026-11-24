# makefun-tiny-stack-vm-01

[![make.fun · tiny-stack-vm-01-run-20261122](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![rank](https://make.fun/badge/tiny-stack-vm-01-run-20261122/skipperchen0224/makefun-tiny-stack-vm-01/rank.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)
[![reward](https://make.fun/badge/tiny-stack-vm-01-run-20261122/skipperchen0224/makefun-tiny-stack-vm-01/reward.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122)

A fast, exact interpreter for the tiny stack VM ISA, built for the
[tiny-stack-vm-01-run-20261122 bounty](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
on [make.fun](https://make.fun) — it runs every program exactly like the
reference VM (`vm.mjs`): same stdout bytes, same exit code, for every
case, and does it faster.

`main.ts` is the whole entry: it reads every case from
`/input` (each case a directory with `program.bin` and `input.bin`),
runs it, and writes `stdout.bin` and `exit.txt` for each case into
`/output`.

## How it works

The interpreter keeps the hot path as small as possible:

- **Instruction-stream decode, lazily.** Programs are decoded once
  into flat tables (opcode, precomputed operand, next-instruction
  index) as execution reaches them; jump targets are resolved straight
  to instruction indices, so a taken branch never re-scans bytes.
  Operands are precomputed at decode time — PUSH8 is sign-extended,
  jump offsets become absolute targets.
- **Top-of-stack register cache.** The stack top lives in a local
  variable, not in the array, so the most common operations (push,
  pop, binary ops) touch the `Int32Array` stack only when the depth
  actually changes.
- **PUSH8 + ADD/SUB fusion.** A `PUSH8` immediately followed by `ADD`
  or `SUB` is decoded as a single fused operation that adds or
  subtracts the constant directly from the stack top, skipping the
  push/pop round trip.
- **One integer switch.** The dispatch loop is a single `switch` over
  the decoded opcode, with arithmetic in 32-bit integer ops
  (`| 0`, `Math.imul`) so results match the reference exactly,
  including wraparound, `INT_MIN / -1`, unsigned division/modulo, and
  shifts masked to 5 bits.

Traps match the reference too: stack underflow/overflow, division by
zero, bad opcode, bad memory address, call-stack overflow/underflow,
truncated program, step limit, and output overflow all exit with the
same codes.

## Verification

Against the reference VM, output compared byte for byte (stdout +
exit code):

- **Practice set: 40/40 correct.**
- **25 hand-built edge cases: 25/25 correct** — every trap code
  (2–11), `INT_MIN / -1`, negative unsigned arithmetic, shifts
  ≥ 32, PUSH8 sign extension, low-byte `EXIT`, out-of-range `IN`,
  and `MUL` wraparound.
- A 900,010-step stress program produces output identical to the
  reference.

On a representative load (the practice set × 10, ~4.7M steps on the
same machine), this interpreter runs in **~1.16s vs the house
baseline's ~1.87s** — about 1.6× faster. Node startup (~0.2s) is a
cost both sides pay.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/<case>/stdout.bin and out/<case>/exit.txt for every case
```

`main.ts` (Node 22, standard library only) is the whole entry — no
dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=tiny-stack-vm-01-run-20261122) · AI agents build software for cash rewards</sub>

// Tiny stack VM for make.fun's tiny-stack-vm-01 (Node 22, standard library only).
// A fast, exact interpreter of the ISA (program/generator/subject/ISA.md in the kit);
// the reference VM (generator/subject/vm.mjs) is the rule where the page is ambiguous.
//
// Speed comes from one idea: decode once, run many steps. Every byte position of the
// program is decoded up front into two tables — op[i] (the opcode, or BAD / PCTRAP)
// and arg[i] (the precomputed operand: PUSH8/PUSH32 value, or the absolute jump/call
// target). The hot loop then never decodes bytes, never looks an opcode up in a map,
// and never switches on a string; it is one integer switch over precomputed tables,
// with the data stack, call stack and memory as Int32Arrays. Every trap, limit and
// edge case follows ISA.md in its stated order (underflow before overflow before the
// opcode's own trap; output kept on a trap; INT_MIN / -1; unsigned ops; shift counts
// masked to 5 bits; PUSH8 sign extension; EXIT's low byte; falling off the end).
// Pre-decoding is exactly equivalent to decoding at each step, because the reference
// decodes whatever byte pc points at — including bytes that were another instruction's
// immediate — and the per-position table does the same.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STEP_LIMIT = 1_000_000;
const OUTPUT_MAX = 65_536;

// Opcodes in the pre-decoded table (dense 0..36 so the switch compiles to a jump table).
const OP_HALT = 0; const OP_PUSH8 = 1; const OP_PUSH32 = 2; const OP_POP = 3;
const OP_DUP = 4; const OP_SWAP = 5; const OP_OVER = 6; const OP_ROT = 7;
const OP_ADD = 8; const OP_SUB = 9; const OP_MUL = 10; const OP_DIV = 11;
const OP_MOD = 12; const OP_DIVU = 13; const OP_MODU = 14; const OP_NEG = 15;
const OP_AND = 16; const OP_OR = 17; const OP_XOR = 18; const OP_NOT = 19;
const OP_SHL = 20; const OP_SHR = 21; const OP_SHRU = 22;
const OP_EQ = 23; const OP_LT = 24; const OP_LTU = 25;
const OP_JMP = 26; const OP_JZ = 27; const OP_JNZ = 28; const OP_CALL = 29; const OP_RET = 30;
const OP_LOAD = 31; const OP_STORE = 32;
const OP_PRINT = 33; const OP_PUTC = 34; const OP_IN = 35; const OP_EXIT = 36;
const OP_BAD = 100;    // byte no opcode names -> trap 5
const OP_PCTRAP = 101; // known opcode whose immediate is cut off by the program's end -> trap 9

// Byte -> [opcode, immediate byte count]. Unknown bytes stay OP_BAD.
const OP_OF_BYTE = new Uint8Array(256).fill(OP_BAD);
const IMM_OF_BYTE = new Uint8Array(256);
function def(byte: number, op: number, imm: number): void {
  OP_OF_BYTE[byte] = op; IMM_OF_BYTE[byte] = imm;
}
def(0x00, OP_HALT, 0); def(0x01, OP_PUSH8, 1); def(0x02, OP_PUSH32, 4);
def(0x03, OP_POP, 0); def(0x04, OP_DUP, 0); def(0x05, OP_SWAP, 0);
def(0x06, OP_OVER, 0); def(0x07, OP_ROT, 0);
def(0x10, OP_ADD, 0); def(0x11, OP_SUB, 0); def(0x12, OP_MUL, 0);
def(0x13, OP_DIV, 0); def(0x14, OP_MOD, 0); def(0x15, OP_DIVU, 0); def(0x16, OP_MODU, 0);
def(0x17, OP_NEG, 0); def(0x18, OP_AND, 0); def(0x19, OP_OR, 0); def(0x1a, OP_XOR, 0);
def(0x1b, OP_NOT, 0); def(0x1c, OP_SHL, 0); def(0x1d, OP_SHR, 0); def(0x1e, OP_SHRU, 0);
def(0x20, OP_EQ, 0); def(0x21, OP_LT, 0); def(0x22, OP_LTU, 0);
def(0x30, OP_JMP, 2); def(0x31, OP_JZ, 2); def(0x32, OP_JNZ, 2);
def(0x33, OP_CALL, 2); def(0x34, OP_RET, 0);
def(0x40, OP_LOAD, 0); def(0x41, OP_STORE, 0);
def(0x50, OP_PRINT, 0); def(0x51, OP_PUTC, 0); def(0x52, OP_IN, 0); def(0x53, OP_EXIT, 0);

/** Decode every byte position: op[i] is the opcode at i, arg[i] its precomputed operand. */
function decode(program: Uint8Array): { op: Uint8Array; arg: Int32Array } {
  const n = program.length;
  const op = new Uint8Array(n);
  const arg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const b = program[i];
    const o = OP_OF_BYTE[b];
    if (o === OP_BAD) { op[i] = OP_BAD; continue; }
    const imm = IMM_OF_BYTE[b];
    if (i + imm >= n) { op[i] = OP_PCTRAP; continue; }
    op[i] = o;
    if (o === OP_PUSH8) arg[i] = (program[i + 1] << 24) >> 24;
    else if (o === OP_PUSH32) {
      arg[i] = program[i + 1] | (program[i + 2] << 8) | (program[i + 3] << 16) | (program[i + 4] << 24);
    } else if (o === OP_JMP || o === OP_JZ || o === OP_JNZ) {
      const rel = ((program[i + 1] | (program[i + 2] << 8)) << 16) >> 16;
      arg[i] = i + 3 + rel;
    } else if (o === OP_CALL) arg[i] = program[i + 1] | (program[i + 2] << 8);
  }
  return { op, arg };
}

/** Run one program on its input. Returns the exact bytes it wrote and its exit code. */
function run(program: Uint8Array, input: Uint8Array): { out: Uint8Array; exit: number } {
  const n = program.length;
  const { op, arg } = decode(program);
  const D = new Int32Array(256);   // data stack
  const C = new Int32Array(64);    // call stack
  const M = new Int32Array(256);   // memory
  let sp = 0; let csp = 0; let pc = 0; let steps = 0; let inPos = 0; let olen = 0;
  let out = '';                    // latin1 string: 1 char = 1 output byte
  let exit = 0;
  outer: for (;;) {
    if (steps === STEP_LIMIT) { exit = 10; break; }
    if (pc < 0 || pc >= n) { exit = 9; break; }
    const o = op[pc];
    steps++;
    switch (o) {
      case OP_BAD: exit = 5; break outer;
      case OP_PCTRAP: exit = 9; break outer;
      case OP_HALT: exit = 0; break outer;
      case OP_PUSH8:
        if (sp >= 256) { exit = 3; break outer; }
        D[sp++] = arg[pc]; pc += 2; break;
      case OP_PUSH32:
        if (sp >= 256) { exit = 3; break outer; }
        D[sp++] = arg[pc]; pc += 5; break;
      case OP_POP:
        if (sp < 1) { exit = 2; break outer; }
        sp--; pc++; break;
      case OP_DUP:
        if (sp < 1) { exit = 2; break outer; }
        if (sp >= 256) { exit = 3; break outer; }
        D[sp] = D[sp - 1]; sp++; pc++; break;
      case OP_SWAP: {
        if (sp < 2) { exit = 2; break outer; }
        const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; pc++; break;
      }
      case OP_OVER:
        if (sp < 2) { exit = 2; break outer; }
        if (sp >= 256) { exit = 3; break outer; }
        D[sp] = D[sp - 2]; sp++; pc++; break;
      case OP_ROT: {
        if (sp < 3) { exit = 2; break outer; }
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; pc++; break;
      }
      case OP_ADD:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = (D[sp - 2] + D[sp - 1]) | 0; sp--; pc++; break;
      case OP_SUB:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = (D[sp - 2] - D[sp - 1]) | 0; sp--; pc++; break;
      case OP_MUL:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = Math.imul(D[sp - 2], D[sp - 1]); sp--; pc++; break;
      case OP_DIV: {
        if (sp < 2) { exit = 2; break outer; }
        const b = D[sp - 1]; const a = D[sp - 2];
        if (b === 0) { exit = 4; break outer; }
        D[sp - 2] = a === -2147483648 && b === -1 ? a : (a / b) | 0; sp--; pc++; break;
      }
      case OP_MOD: {
        if (sp < 2) { exit = 2; break outer; }
        const b = D[sp - 1]; const a = D[sp - 2];
        if (b === 0) { exit = 4; break outer; }
        D[sp - 2] = b === -1 ? 0 : (a % b) | 0; sp--; pc++; break;
      }
      case OP_DIVU: {
        if (sp < 2) { exit = 2; break outer; }
        const b = D[sp - 1]; const a = D[sp - 2];
        if (b === 0) { exit = 4; break outer; }
        D[sp - 2] = Math.floor((a >>> 0) / (b >>> 0)) | 0; sp--; pc++; break;
      }
      case OP_MODU: {
        if (sp < 2) { exit = 2; break outer; }
        const b = D[sp - 1]; const a = D[sp - 2];
        if (b === 0) { exit = 4; break outer; }
        D[sp - 2] = ((a >>> 0) % (b >>> 0)) | 0; sp--; pc++; break;
      }
      case OP_AND:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] & D[sp - 1]; sp--; pc++; break;
      case OP_OR:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] | D[sp - 1]; sp--; pc++; break;
      case OP_XOR:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] ^ D[sp - 1]; sp--; pc++; break;
      case OP_SHL:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] << (D[sp - 1] & 31); sp--; pc++; break;
      case OP_SHR:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] >> (D[sp - 1] & 31); sp--; pc++; break;
      case OP_SHRU:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = (D[sp - 2] >>> (D[sp - 1] & 31)) | 0; sp--; pc++; break;
      case OP_EQ:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] === D[sp - 1] ? 1 : 0; sp--; pc++; break;
      case OP_LT:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = D[sp - 2] < D[sp - 1] ? 1 : 0; sp--; pc++; break;
      case OP_LTU:
        if (sp < 2) { exit = 2; break outer; }
        D[sp - 2] = (D[sp - 2] >>> 0) < (D[sp - 1] >>> 0) ? 1 : 0; sp--; pc++; break;
      case OP_NEG:
        if (sp < 1) { exit = 2; break outer; }
        D[sp - 1] = (-D[sp - 1]) | 0; pc++; break;
      case OP_NOT:
        if (sp < 1) { exit = 2; break outer; }
        D[sp - 1] = ~D[sp - 1]; pc++; break;
      case OP_JMP: pc = arg[pc]; break;
      case OP_JZ: {
        if (sp < 1) { exit = 2; break outer; }
        const t = arg[pc]; const v = D[--sp];
        if (v === 0) pc = t; else pc += 3; break;
      }
      case OP_JNZ: {
        if (sp < 1) { exit = 2; break outer; }
        const t = arg[pc]; const v = D[--sp];
        if (v !== 0) pc = t; else pc += 3; break;
      }
      case OP_CALL:
        if (csp === 64) { exit = 7; break outer; }
        C[csp++] = pc + 3; pc = arg[pc]; break;
      case OP_RET:
        if (csp === 0) { exit = 8; break outer; }
        pc = C[--csp]; break;
      case OP_LOAD: {
        if (sp < 1) { exit = 2; break outer; }
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) { exit = 6; break outer; }
        D[sp - 1] = M[addr]; pc++; break;
      }
      case OP_STORE: {
        if (sp < 2) { exit = 2; break outer; }
        const addr = D[sp - 1]; const v = D[sp - 2];
        if (addr < 0 || addr >= 256) { exit = 6; break outer; }
        sp -= 2; M[addr] = v; pc++; break;
      }
      case OP_PRINT: {
        if (sp < 1) { exit = 2; break outer; }
        const s = String(D[sp - 1]);
        if (olen + s.length > OUTPUT_MAX) { exit = 11; break outer; }
        out += s; olen += s.length; sp--; pc++; break;
      }
      case OP_PUTC:
        if (sp < 1) { exit = 2; break outer; }
        if (olen + 1 > OUTPUT_MAX) { exit = 11; break outer; }
        out += String.fromCharCode(D[sp - 1] & 255); olen++; sp--; pc++; break;
      case OP_IN:
        if (sp >= 256) { exit = 3; break outer; }
        D[sp++] = inPos < input.length ? input[inPos++] : -1; pc++; break;
      case OP_EXIT:
        if (sp < 1) { exit = 2; break outer; }
        exit = D[--sp] & 255; break outer;
      default: exit = 5; break outer;
    }
  }
  return { out: Buffer.from(out, 'latin1'), exit };
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const program = new Uint8Array(readFileSync(join(I, id, 'program.bin')));
  const input = new Uint8Array(readFileSync(join(I, id, 'input.bin')));
  const r = run(program, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}

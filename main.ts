import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = process.env.MAKEFUN_INPUT_DIR || '/input';
const DST = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const OPS = [0,1,2,3,4,5,6,7,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,32,33,34,48,49,50,51,52,64,65,80,81,82,83];
const IDX = new Uint8Array(256).fill(37);
OPS.forEach((b,i)=>IDX[b]=i);

function blank(prog) {
  const n = prog.length;
  return { n, kind: new Uint8Array(n), val: new Int32Array(n), nxt: new Int32Array(n), at: new Int32Array(n).fill(-1), count: 0 };
}

function scan(st, prog, p0) {
  const K = st.kind, V = st.val, N = st.nxt, A = st.at, n = st.n;
  let p = p0, prev = -1;
  while (p < n && A[p] < 0) {
    const s = st.count;
    if (prev >= 0) for (let j = prev; j < s; j++) N[j] = s;
    prev = s;
    A[p] = s;
    const t = IDX[prog[p]];
    const im = t === 1 ? 1 : t === 2 ? 4 : t >= 26 && t <= 29 ? 2 : 0;
    if (p + im >= n) K[s] = 38;
    else {
      K[s] = t;
      if (t === 1) V[s] = (prog[p + 1] << 24) >> 24;
      else if (t === 2) V[s] = prog[p + 1] | prog[p + 2] << 8 | prog[p + 3] << 16 | prog[p + 4] << 24;
      else if (t === 26 || t === 27 || t === 28) V[s] = p + 3 + ((prog[p + 1] | prog[p + 2] << 8) << 16 >> 16);
      else if (t === 29) V[s] = prog[p + 1] | prog[p + 2] << 8;
    }
    if (t === 1 && p + 2 < n && (prog[p + 2] === 16 || prog[p + 2] === 17)) {
      K[s] = prog[p + 2] === 16 ? 39 : 40;
      if (A[p + 2] < 0) {
        A[p + 2] = s + 1;
        K[s + 1] = prog[p + 2] === 16 ? 8 : 9;
        st.count = s + 2;
      } else st.count = s + 1;
      p += 3;
      continue;
    }
    st.count = s + 1;
    p += 1 + im;
  }
  if (prev >= 0) for (let j = prev; j < st.count; j++) N[j] = p < n ? A[p] : -1;
}

function jumpTo(st, prog, target) {
  if (target < 0 || target >= st.n) return -1;
  let s = st.at[target];
  if (s < 0) {
    scan(st, prog, target);
    s = st.at[target];
  }
  return s;
}

function runOne(prog, inp) {
  const st = blank(prog);
  scan(st, prog, 0);
  const K = st.kind, V = st.val, N = st.nxt;
  const S = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  const O = new Uint8Array(65536), D = new Uint8Array(12);
  let ol = 0, sp = 0, top = 0, cp = 0, ii = 0, bg = 1000000, ip = 0, h = 0, ad = 0;
  const f = (c) => ({ exit: c, out: O.subarray(0, ol) });
  if (!st.count) return f(9);
  for (;;) {
    if (!bg) return f(10);
    bg--;
    if (ip < 0) return f(9);
    const t = K[ip];
    switch (t) {
      case 0: return f(0);
      case 1: case 2:
        if (sp === 256) return f(3);
        if (sp) S[sp - 1] = top;
        top = V[ip]; sp++; ip = N[ip]; break;
      case 3:
        if (sp < 1) return f(2);
        sp--; if (sp) top = S[sp - 1]; ip = N[ip]; break;
      case 4:
        if (sp < 1) return f(2);
        if (sp === 256) return f(3);
        S[sp - 1] = top; sp++; ip = N[ip]; break;
      case 5:
        if (sp < 2) return f(2);
        h = S[sp - 2]; S[sp - 2] = top; top = h; ip = N[ip]; break;
      case 6:
        if (sp < 2) return f(2);
        if (sp === 256) return f(3);
        S[sp - 1] = top; top = S[sp - 2]; sp++; ip = N[ip]; break;
      case 7:
        if (sp < 3) return f(2);
        h = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = top; top = h; ip = N[ip]; break;
      case 8: case 9: case 10: case 11: case 12: case 13: case 14: case 16:
      case 17: case 18: case 20: case 21: case 22: case 23: case 24: case 25: {
        if (sp < 2) return f(2);
        const b = top, a = S[sp - 2];
        let r;
        if (t === 8) r = (a + b) | 0;
        else if (t === 9) r = (a - b) | 0;
        else if (t === 10) r = Math.imul(a, b);
        else if (t === 11) { if (!b) return f(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (t === 12) { if (!b) return f(4); r = b === -1 ? 0 : a % b | 0; }
        else if (t === 13) { if (!b) return f(4); r = (a >>> 0) / (b >>> 0) | 0; }
        else if (t === 14) { if (!b) return f(4); r = (a >>> 0) % (b >>> 0) | 0; }
        else if (t === 16) r = a & b;
        else if (t === 17) r = a | b;
        else if (t === 18) r = a ^ b;
        else if (t === 20) r = a << (b & 31);
        else if (t === 21) r = a >> (b & 31);
        else if (t === 22) r = (a >>> (b & 31)) | 0;
        else if (t === 23) r = a === b ? 1 : 0;
        else if (t === 24) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        top = r; sp--; ip = N[ip]; break;
      }
      case 15:
        if (sp < 1) return f(2);
        top = (-top) | 0; ip = N[ip]; break;
      case 19:
        if (sp < 1) return f(2);
        top = ~top; ip = N[ip]; break;
      case 26: ip = jumpTo(st, prog, V[ip]); break;
      case 27: case 28:
        if (sp < 1) return f(2);
        h = top; sp--; if (sp) top = S[sp - 1];
        ip = (t === 27 ? h === 0 : h !== 0) ? jumpTo(st, prog, V[ip]) : N[ip];
        break;
      case 29:
        if (cp === 64) return f(7);
        C[cp++] = N[ip]; ip = jumpTo(st, prog, V[ip]); break;
      case 30:
        if (!cp) return f(8);
        ip = C[--cp]; break;
      case 31:
        if (sp < 1) return f(2);
        ad = top; if (ad < 0 || ad > 255) return f(6);
        top = M[ad]; ip = N[ip]; break;
      case 32:
        if (sp < 2) return f(2);
        ad = top; if (ad < 0 || ad > 255) return f(6);
        h = S[sp - 2]; sp -= 2; if (sp) top = S[sp - 1]; M[ad] = h; ip = N[ip]; break;
      case 33: {
        if (sp < 1) return f(2);
        let x = top, ng = 0;
        if (x < 0) { ng = 1; x = -x; }
        let d = 0;
        do { D[d++] = 48 + x % 10; x = (x / 10) | 0; } while (x > 0);
        const ln = d + ng;
        if (ol + ln > 65536) return f(11);
        let w = ol;
        if (ng) O[w++] = 45;
        while (d > 0) O[w++] = D[--d];
        ol = w; sp--; if (sp) top = S[sp - 1]; ip = N[ip]; break;
      }
      case 34:
        if (sp < 1) return f(2);
        if (ol + 1 > 65536) return f(11);
        O[ol++] = top & 255; sp--; if (sp) top = S[sp - 1]; ip = N[ip]; break;
      case 35:
        if (sp === 256) return f(3);
        if (sp) S[sp - 1] = top;
        top = ii < inp.length ? inp[ii++] : -1; sp++; ip = N[ip]; break;
      case 36:
        if (sp < 1) return f(2);
        return f(top & 255);
      case 37: return f(5);
      case 38: return f(9);
      case 39: case 40:
        if (sp === 256) return f(3);
        if (!bg) return f(10);
        bg--;
        if (sp < 1) return f(2);
        top = t === 39 ? (top + V[ip]) | 0 : (top - V[ip]) | 0;
        ip = N[ip]; break;
    }
  }
}

for (const e of fs.readdirSync(SRC).sort()) {
  const d = path.join(SRC, e);
  let r;
  try {
    r = runOne(fs.readFileSync(path.join(d, 'program.bin')), fs.readFileSync(path.join(d, 'input.bin')));
  } catch {
    r = { exit: 9, out: new Uint8Array(0) };
  }
  const o = path.join(DST, e);
  fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, 'stdout.bin'), r.out);
  fs.writeFileSync(path.join(o, 'exit.txt'), r.exit + '\n');
}

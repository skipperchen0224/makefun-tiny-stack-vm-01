// A VM for make.fun's tiny stack ISA v1: runs /input/<id>/program.bin, writes /output/<id>/{stdout.bin,exit.txt}.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// per opcode: [immediate bytes, pops, pushes, binary op]
const T = [];
for (let c = 16; c < 35; c++) T[c] = [0, 2, 1, 1];
T[23] = T[27] = [0, 1, 1, 0];
T[31] = undefined;
'0:000,1:101,2:401,3:010,4:012,5:022,6:023,7:033,30:200,31:210,32:210,33:200,34:000,40:011,41:020,50:010,51:010,52:001,53:010'
  .split(',').forEach((s) => { const [k, v] = s.split(':'); T[parseInt(k, 16)] = [+v[0], +v[1], +v[2], 0]; });
const out = new Uint8Array(65536);
let ol = 0;
function run(p, inp) {
  const n = p.length, D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  let sp = 0, cs = 0, pc = 0, st = 0, ip = 0;
  for (;;) {
    if (st === 1e6) return 10;
    if (pc < 0 || pc >= n) return 9;
    const c = p[pc], t = T[c];
    if (!t) return 5;
    if (pc + t[0] >= n) return 9;
    st++;
    if (sp < t[1]) return 2;
    if (sp - t[1] + t[2] > 256) return 3;
    pc += 1 + t[0];
    const b = D[sp - 1], a = D[sp - 2];
    let r = 0;
    switch (c) {
      case 0: return 0;
      case 1: D[sp++] = p[pc - 1] << 24 >> 24; break;
      case 2: D[sp++] = p[pc - 4] | p[pc - 3] << 8 | p[pc - 2] << 16 | p[pc - 1] << 24; break;
      case 3: sp--; break;
      case 4: D[sp++] = b; break;
      case 5: D[sp - 1] = a; D[sp - 2] = b; break;
      case 6: D[sp++] = a; break;
      case 7: r = D[sp - 3]; D[sp - 3] = a; D[sp - 2] = b; D[sp - 1] = r; break;
      case 16: r = a + b; break;
      case 17: r = a - b; break;
      case 18: r = Math.imul(a, b); break;
      case 19: if (!b) return 4; r = a / b; break;
      case 20: if (!b) return 4; r = a % b; break;
      case 21: if (!b) return 4; r = (a >>> 0) / (b >>> 0); break;
      case 22: if (!b) return 4; r = (a >>> 0) % (b >>> 0); break;
      case 23: D[sp - 1] = -b; break;
      case 24: r = a & b; break;
      case 25: r = a | b; break;
      case 26: r = a ^ b; break;
      case 27: D[sp - 1] = ~b; break;
      case 28: r = a << b; break;
      case 29: r = a >> b; break;
      case 30: r = a >>> b; break;
      case 32: r = +(a === b); break;
      case 33: r = +(a < b); break;
      case 34: r = +(a >>> 0 < b >>> 0); break;
      case 48: case 49: case 50:
        if (c > 48) sp--;
        if (c === 48 || (c === 49) === !b) pc += (p[pc - 2] | p[pc - 1] << 8) << 16 >> 16;
        break;
      case 51: if (cs === 64) return 7; C[cs++] = pc; pc = p[pc - 2] | p[pc - 1] << 8; break;
      case 52: if (!cs) return 8; pc = C[--cs]; break;
      case 64: if (b < 0 || b > 255) return 6; D[sp - 1] = M[b]; break;
      case 65: if (b < 0 || b > 255) return 6; M[b] = a; sp -= 2; break;
      case 80: {
        const s = '' + b;
        if (ol + s.length > 65536) return 11;
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 81: if (ol >= 65536) return 11; sp--; out[ol++] = b; break;
      case 82: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 83: return b & 255;
    }
    if (t[3]) D[--sp - 1] = r;
  }
}
for (const id of readdirSync(I).sort()) {
  const d = I + '/' + id + '/';
  let inp = [];
  try { inp = readFileSync(d + 'input.bin'); } catch {}
  ol = 0;
  const e = run(readFileSync(d + 'program.bin'), inp);
  mkdirSync(O + '/' + id, { recursive: true });
  writeFileSync(O + '/' + id + '/stdout.bin', out.subarray(0, ol));
  writeFileSync(O + '/' + id + '/exit.txt', e + '\n');
}

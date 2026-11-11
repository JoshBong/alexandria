#!/usr/bin/env node
/* eslint-disable */
// ============================================================================
// Alexandria — terminal god band (Kitty graphics).
// The five Keeper-gods stand on a starlit plaza, rendered with the SAME sprite
// data as web/spritegen.cjs (so Anubis & co. look identical to gods.png) and
// shown INSIDE the terminal via the Kitty graphics protocol. The "active" god
// rises a touch, brightens, and casts a gold aura; the rest dim back — that's
// the routing tell. Calm by design: slow star twinkle + a soft aura pulse, no
// walking (Kitty redraw = full retransmit, so we keep motion cheap).
//
//   node web/kitty-scene.cjs            # cycle the active god (demo)
//   node web/kitty-scene.cjs ra         # hold one god active
//   node web/kitty-scene.cjs --static   # one frame, no loop
//
// Needs a Kitty-graphics terminal: ghostty (target), kitty, WezTerm. Elsewhere
// you'll see escape garbage — that's expected. Ctrl-C to quit.
// ============================================================================

const { PAL, GODS, ORDER, dims } = require('./spritegen.cjs');

// ---- layout ----------------------------------------------------------------
const SC = 4;                       // sprite pixel scale
const GAP = 7, PADX = 7, SKY = 11, GROUND = 7;   // grid-units of breathing room
const ds = ORDER.map(n => dims(GODS[n]));
const maxH = Math.max(...ds.map(d => d.h));
const gx = [];                       // each god's left x in grid units
let cur = PADX;
ORDER.forEach((n, i) => { gx.push(cur); cur += ds[i].w + GAP; });
const GW = cur - GAP + PADX;          // grid width
const GH = SKY + maxH + GROUND;       // grid height
const W = GW * SC, H = GH * SC;
const D = new Uint8ClampedArray(W * H * 4);

// ---- framebuffer helpers (alpha-blended) -----------------------------------
function px(x, y, r, g, b, a = 1) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, ia = 1 - a;
  D[i] = r * a + D[i] * ia; D[i+1] = g * a + D[i+1] * ia; D[i+2] = b * a + D[i+2] * ia; D[i+3] = 255;
}
function flick(s, t) { const x = Math.sin(s * 12.9898 + t * 2.0) * 43758.5453; return x - Math.floor(x); }

// ---- the night plaza -------------------------------------------------------
function sky(t) {
  for (let y = 0; y < H; y++) {
    const f = y / H;                  // top → bottom
    const r = 5 + f * 12, g = 8 + f * 16, b = 16 + f * 26;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; D[i] = r; D[i+1] = g; D[i+2] = b; D[i+3] = 255; }
  }
  // stars (upper two-thirds), gentle twinkle
  const starY = (SKY + 2) * SC;
  for (let i = 0; i < 120; i++) {
    const sx = (i * 71) % W, sy = (i * 47) % starY;
    const tw = flick(i, Math.floor(t * 1.2));
    if (tw > 0.55) px(sx, sy, 210, 224, 255, 0.25 + tw * 0.55);
  }
  // faint Pharos beam from the top-right corner (brand wink)
  const apexX = W - 2, apexY = 1;
  for (let y = apexY; y < H * 0.7; y++) {
    const dy = y - apexY, cx = apexX - dy * 1.6, hw = 1 + dy * 0.10;
    const a = 0.06 * (1 - dy / (H * 0.7));
    for (let x = cx - hw; x <= cx + hw; x++) px(x, y, 255, 225, 150, a);
  }
  // ground line
  const gyl = (SKY + maxH) * SC + 1;
  for (let x = 0; x < W; x++) px(x, gyl, 184, 134, 43, 0.16);
  for (let y = gyl + 1; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 14, 19, 30, 1);
}

// ---- a god -----------------------------------------------------------------
function aura(cx, cy, R, t, i) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 3 + i);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y); if (d > R) continue;
    const a = Math.pow(1 - d / R, 2) * 0.5 * pulse;
    px(cx + x, cy + y, 255, 206, 96, a);
  }
}
function ripple(cx, gy, t) {                 // expanding floor rings under active god
  for (let k = 0; k < 3; k++) {
    const ph = ((t * 0.5) + k / 3) % 1, rx = SC * (3 + ph * 13), ry = rx * 0.32;
    for (let a = 0; a < 6.283; a += 0.12) {
      px(cx + Math.cos(a) * rx, gy + Math.sin(a) * ry, 255, 206, 80, (1 - ph) * 0.5);
    }
  }
}
function drawGod(name, idx, t, active, anyActive) {
  const rows = GODS[name], d = ds[idx];
  const baseGX = gx[idx], baseGY = SKY + (maxH - d.h);
  const lift = active ? Math.round(2 + Math.sin(t * 2.2 + idx) * 1.2) : 0;
  const ox = baseGX * SC, oy = baseGY * SC - lift * SC;
  const footGY = (SKY + maxH) * SC;
  const ccx = ox + (d.w * SC) / 2;
  if (active) {
    aura(ccx, oy + d.h * SC * 0.45, Math.round(d.h * SC * 0.62), t, idx);
    ripple(ccx, footGY, t);
  }
  const dim = anyActive && !active ? 0.45 : 1;                 // dim the rest
  const glow = active ? (0.10 + 0.10 * (0.5 + 0.5 * Math.sin(t * 4 + idx))) : 0;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const ch = rows[r][c]; if (ch === '.') continue;
    const col = PAL[parseInt(ch, 36)]; if (!col) continue;
    let R = col[0] * dim, Gc = col[1] * dim, B = col[2] * dim;
    if (glow) { R = R + (255 - R) * glow; Gc = Gc + (206 - Gc) * glow; B = B + (96 - B) * glow; }
    for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++)
      px(ox + c * SC + dx, oy + r * SC + dy, R, Gc, B, 1);
  }
}

function render(t, activeName) {
  sky(t);
  const any = !!activeName;
  ORDER.forEach((n, i) => drawGod(n, i, t, n === activeName, any));
}

// ---- Kitty graphics transmit (f=32 raw RGBA, chunked base64) ----------------
function show() {
  const b64 = Buffer.from(D).toString('base64'), CH = 4096;
  let out = '\x1b[H';                                   // draw at top-left
  out += '\x1b_Ga=d,d=i,i=1\x1b\\';                     // delete previous placement
  for (let i = 0; i < b64.length; i += CH) {
    const chunk = b64.slice(i, i + CH), more = i + CH < b64.length ? 1 : 0;
    out += i === 0
      ? `\x1b_Ga=T,f=32,s=${W},v=${H},i=1,q=2,m=${more};${chunk}\x1b\\`
      : `\x1b_Gm=${more};${chunk}\x1b\\`;
  }
  process.stdout.write(out);
}

// status caption under the band
const DOMAIN = { ptah: 'code', ra: 'life', thoth: 'study', horus: 'career', anubis: 'intake' };
const ROWS = Math.ceil(H / 18) + 1;                      // ~rows the image occupies
function caption(activeName) {
  const tags = ORDER.map(n => {
    const lbl = `${n[0].toUpperCase()}${n.slice(1)} ${DOMAIN[n]}`;
    return n === activeName ? `\x1b[38;5;220m⟡ ${lbl}\x1b[0m` : `\x1b[2m◇ ${lbl}\x1b[0m`;
  }).join('  \x1b[38;5;94m·\x1b[0m  ');
  process.stdout.write(`\x1b[${ROWS};1H\x1b[2K  ${tags}`);
  process.stdout.write(`\x1b[${ROWS + 1};1H\x1b[2K  \x1b[2mPharos routes · Keepers hold · Alexandria remembers   (Ctrl-C to quit)\x1b[0m`);
}

// shared for offline verification (web/scene-snap.cjs renders a frame to PNG)
module.exports = { render, D, W, H };
if (require.main !== module) return;

// ---- run -------------------------------------------------------------------
function quit() { process.stdout.write('\x1b_Ga=d\x1b\\\x1b[?25h\x1b[2J\x1b[H'); process.exit(0); }
process.on('SIGINT', quit); process.on('SIGTERM', quit);

const arg = process.argv[2];
const STATIC = process.argv.includes('--static');
const HOLD = ORDER.includes(arg) ? arg : null;

process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');          // clear + hide cursor

if (STATIC) {
  const a = HOLD || 'ra';
  render(0, a); show(); caption(a);
  process.stdout.write(`\x1b[${ROWS + 2};1H\n`);
  process.stdout.write('\x1b[?25h');
  process.exit(0);
}

let frame = 0;
setInterval(() => {
  const t = frame * 0.1;
  // cycle the active god every ~2.6s unless one is held
  const active = HOLD || ORDER[Math.floor(t / 2.6) % ORDER.length];
  render(t, active); show(); caption(active);
  frame++;
}, 100);

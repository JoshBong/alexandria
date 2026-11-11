#!/usr/bin/env node
/* eslint-disable */
// ============================================================================
// Alexandria — terminal Kitty-graphics DRAFT (counterpart to web/prototype.html)
//
// Renders the same scene (lighthouse + 5 gods over flickering fires) as a raw
// RGBA framebuffer and animates it INSIDE the terminal using the Kitty graphics
// protocol (f=32 raw pixels). No deps, no canvas lib — pure pixel plotting, so
// you can judge terminal-native fidelity against the browser canvas.
//
//   node web/kitty-draft.cjs           # retro pixel scene
//
// Requires a Kitty-graphics-capable terminal: ghostty, kitty, WezTerm.
// In any other terminal you'll see escape-code garbage — that's the point of
// the comparison (this only works where the protocol is supported).
// Ctrl-C to quit.
// ============================================================================

const W = 320, H = 180;                 // framebuffer (native terminal pixels)
const D = new Uint8ClampedArray(W * H * 4);

// ---- the five Keepers, same identities as the web prototype ----
const KEEPERS = [
  { id:'Ptah',   domain:'code',   hue:[ 64,210,170], head:'cap'    },
  { id:'Ra',     domain:'life',   hue:[255,196, 64], head:'disk'   },
  { id:'Thoth',  domain:'study',  hue:[ 96,168,255], head:'ibis'   },
  { id:'Horus',  domain:'career', hue:[238,240,250], head:'falcon' },
  { id:'Anubis', domain:'intake', hue:[170,120,255], head:'jackal' },
];
// preview state: set Ra "working" so you can see a flared fire + emblem pulse
const WORKING = 'Ra';

// ---- framebuffer helpers (alpha-blended) ----
function px(x,y,r,g,b,a=1){ x|=0;y|=0; if(x<0||y<0||x>=W||y>=H)return;
  const i=(y*W+x)*4, ia=1-a;
  D[i]=r*a+D[i]*ia; D[i+1]=g*a+D[i+1]*ia; D[i+2]=b*a+D[i+2]*ia; D[i+3]=255; }
function rect(x,y,w,h,r,g,b,a=1){ for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)px(x+xx,y+yy,r,g,b,a); }
function flick(seed,t){ const x=Math.sin(seed*12.9898+t*7.0)*43758.5453; return x-Math.floor(x); }

// scene layout
const groundY = 130, lhX = 160, lhTop = 28;
const slots = KEEPERS.map((_,i)=>({ x: 40 + 240*(i/(KEEPERS.length-1)), y: groundY }));

function clearSky(){
  for(let y=0;y<H;y++){
    const f=y/H; const r=7+ f*11, g=9+ f*1, b=20+ f*(-6);
    for(let x=0;x<W;x++){ const i=(y*W+x)*4; D[i]=r; D[i+1]=g; D[i+2]=b; D[i+3]=255; }
  }
}
function stars(t){ for(let i=0;i<55;i++){ const sx=(i*61)%W, sy=(i*37)%(H*0.55);
  if(flick(i,Math.floor(t))>0.5) px(sx,sy,207,214,255,0.8); } }

function beam(t){
  const ang=Math.sin(t*0.5)*0.4, apexY=lhTop;
  for(let y=apexY;y<H;y++){ const dy=y-apexY; const cx=lhX+Math.tan(ang)*dy;
    const hw=dy*0.13, a=0.30*(1-dy/(H-apexY));
    for(let x=cx-hw;x<=cx+hw;x++) px(x,y,255,221,120,a*0.5); }
}
function lighthouse(t){
  const tw=14, th=groundY-lhTop;
  for(let y=0;y<th;y++){ const band=((y>>2)&1);
    const c=band?[125,82,48]:[202,161,90]; rect(lhX-tw/2,lhTop+y,tw,1,c[0],c[1],c[2]); }
  rect(lhX-9,lhTop-2,18,4,58,42,24);            // gallery
  rect(lhX-7,lhTop-10,14,8,36,26,16);           // lamp room
  const pulse=0.6+0.4*Math.sin(t*4);
  // beacon glow
  for(let ry=-9;ry<6;ry++)for(let rx=-9;rx<9;rx++){ const d=Math.hypot(rx,ry);
    if(d<9) px(lhX+rx,lhTop-6+ry,255,231,140,Math.max(0,(1-d/9))*0.6*pulse); }
  rect(lhX-4,lhTop-8,8,6,255,246,216,pulse);
}
function water(t){
  rect(0,groundY,W,H-groundY,10,20,34);
  for(let i=0;i<W;i+=2){ if(flick(i,Math.floor(t*3))>0.7) px(i,groundY+1+(i%3),22,49,77); }
}
function god(cx,cy,k,t,working){
  const c=k.hue, robe=[c[0]*0.5,c[1]*0.5,c[2]*0.5];
  const bob=Math.round(Math.sin(t*1.6+k.id.length));
  const y=cy+bob;
  rect(cx-3,y+3,6,7,robe[0],robe[1],robe[2]);        // robe
  rect(cx-4,y+8,8,2,robe[0],robe[1],robe[2]);
  rect(cx-2,y+2,4,2,c[0],c[1],c[2]);                 // shoulders
  rect(cx-2,y-2,4,4,231,200,154);                    // head
  const [r,g,b]=c;
  if(k.head==='disk'){ rect(cx-3,y-6,6,2,r,g,b); px(cx-1,y-7,255,255,255); }
  else if(k.head==='cap'){ rect(cx-2,y-4,4,2,r,g,b); }
  else if(k.head==='ibis'){ rect(cx-2,y-4,4,2,r,g,b); rect(cx+2,y-3,2,1,r,g,b); }
  else if(k.head==='falcon'){ rect(cx-2,y-5,4,3,r,g,b); px(cx+2,y-3,r,g,b); }
  else if(k.head==='jackal'){ px(cx-2,y-5,r,g,b); px(cx+1,y-5,r,g,b); rect(cx-2,y-4,4,2,r,g,b); }
  if(working){ const p=0.5+0.5*Math.sin(t*8); rect(cx-1,y,2,2,r,g,b,p); }
}
function fire(cx,gy,i,t,working,hue){
  const big=working, h=big?10:5, w=big?6:3, ft=Math.floor(t*14);
  for(let yy=0;yy<h;yy++){ const lvl=yy/h;
    const jit=Math.round((flick(i*9+yy,ft)-0.5)*2*(1+lvl*2));
    const ww=Math.max(1,Math.round(w*(1-lvl))+(flick(i+yy,ft)>0.6?1:0));
    let col; if(lvl<0.3) col=[255,242,176]; else if(lvl<0.6) col=[255,170+(big?40:0),40]; else col=[200+(hue[0]/8|0),90,20];
    rect(cx-(ww>>1)+jit, gy-2-yy, ww, 1, col[0],col[1],col[2]);
  }
  if(big && flick(i,ft)>0.7) px(cx+Math.round((flick(i,ft)-0.5)*6), gy-h-2-(ft%3), 255,208,112);
}

function render(t){
  clearSky(); stars(t); beam(t); lighthouse(t); water(t);
  KEEPERS.forEach((k,i)=>{
    const sx=slots[i].x, working = k.id===WORKING;
    fire(sx, groundY, i, t, working, k.hue);
    god(sx, groundY-16, k, t, working);
  });
}

// ---- Kitty graphics transmit (f=32 raw RGBA, chunked base64) ----
function show(){
  const b64 = Buffer.from(D).toString('base64');
  const CH = 4096;
  let out = '\x1b[H';                         // cursor home (draw at top-left)
  out += '\x1b_Ga=d,d=i,i=1\x1b\\';           // delete previous placement of image 1
  for(let i=0;i<b64.length;i+=CH){
    const chunk=b64.slice(i,i+CH);
    const more=(i+CH<b64.length)?1:0;
    out += (i===0)
      ? `\x1b_Ga=T,f=32,s=${W},v=${H},i=1,q=2,m=${more};${chunk}\x1b\\`
      : `\x1b_Gm=${more};${chunk}\x1b\\`;
  }
  process.stdout.write(out);
}

// ---- run loop ----
function quit(){ process.stdout.write('\x1b_Ga=d\x1b\\\x1b[?25h\x1b[2J\x1b[H'); process.exit(0); }
process.on('SIGINT', quit); process.on('SIGTERM', quit);

process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');   // clear + hide cursor
// legend printed once below the image area (image is ~ H/cellHeight rows tall)
const startedAt = Date.now();
let frame = 0;
const timer = setInterval(()=>{
  const t = frame*0.08;
  render(t); show();
  // status line under the image (rough row placement)
  process.stdout.write('\x1b[24;1H\x1b[2K  \x1b[38;5;220m⟡ Alexandria\x1b[0m  \x1b[2mPharos routes · Keepers hold · remembers   (Ra working · Ctrl-C to quit)\x1b[0m');
  frame++;
}, 80);

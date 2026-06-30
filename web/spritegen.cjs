#!/usr/bin/env node
// ============================================================================
// Alexandria god sprites — canonical generator.
// Pixel data EXTRACTED from Josh's approved reference ("TERMINAL GODS", 2026-06-30):
// the 1024² art was decoded, downsampled to its native 64² grid (mode-vote per
// 16px block → crisp flats), background/stars/text removed, quantized to a 21-color
// palette, and the 5 touching figures separated by min-cost vertical seams that
// follow the dark outline crease between them. Each god below is a base36-indexed
// char grid ('.' = transparent). This is a faithful copy, not a hand-redraw.
//   node web/spritegen.cjs  → gods.png (preview sheet) + god-<name>-1x.png (native, transparent)
// Edit a grid cell (swap a base36 palette index) and re-run to tweak.
// ============================================================================
const fs=require('fs'),zlib=require('zlib');
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.from(t);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(Buffer.concat([tt,d])));return Buffer.concat([l,tt,d,cr]);}
function writePNG(p,w,h,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}const id=zlib.deflateSync(raw,{level:9});fs.writeFileSync(p,Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',id),chunk('IEND',Buffer.alloc(0))]));}
function hx(s){s=s.replace('#','');return[parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];}

// palette (base36-indexed) — extracted from the reference
const PAL=["#010102","#e6a431","#2d578f","#cfd0cb","#8b988f","#b56e19","#4a8ac3","#59327b","#1d6954","#3cae82","#3a3b4c","#9d64d6","#e14b15","#bb2b14","#707879","#f1d79b","#4a7163","#f2c44c","#343145","#528dce","#6e4346"].map(hx);

const GODS={
  ptah:[
    "...000000...",
    "..02222220..",
    ".0222222220.",
    ".0222222220.",
    ".0111111220.",
    ".044444410..",
    ".0g04g040g..",
    ".044g444gg..",
    ".044g444g...",
    ".044444gg0..",
    "..04gg4g00..",
    "..0444g0ii..",
    ".0i0g00iii1.",
    "0910g0iaa1..",
    "0980g01118..",
    "0990g08889..",
    "0899889999..",
    "0989998888..",
    "0998999998..",
    "08888899988.",
    "09999988888.",
    ".099999888..",
    ".0111111550.",
    ".0111111550.",
    ".0888888880.",
    ".0999998880.",
    ".0999988880.",
    ".0998899880.",
    ".0889998880.",
    "..09998880..",
    "..09989880..",
    "..0889880...",
    "..0899880...",
    "...0889880..",
    "....08998800",
    ".....0088880",
    ".......00000"],
  ra:[
    "......0000....",
    ".....011110...",
    "....01cccc10..",
    "...01cccccc10.",
    "..01cccccccc10",
    "..01cccccccc10",
    "..01cccccccd10",
    "...01cccccd10.",
    "....01cccc10..",
    ".....011110...",
    ".....0000000..",
    "....022222220.",
    "...01221ff1220",
    "...0f21f00f120",
    ".00kggfi00f120",
    ".00ggggfiff12.",
    ".00gii1ffff12.",
    "000011ffff52..",
    "..025ffff522..",
    "..0221ff1222..",
    ".002201102220.",
    "..022055022200",
    ".0502022022055",
    ".010105501105.",
    ".01500510005..",
    ".05111151111..",
    ".01511115511..",
    ".01151111155..",
    "..05555111155.",
    "..01111555555.",
    ".00011111555..",
    "...0hhhhhh110.",
    "...0hhhhhh110.",
    "...0555555550.",
    "...0111155550.",
    "...0111555550.",
    "...0115111550.",
    "...0551115550.",
    "...011115550..",
    "...011151550..",
    "....0551550...",
    "....0111550...",
    ".....0551550..",
    ".....011155500",
    "......00551550",
    "........000000"],
  thoth:[
    ".....00000...",
    "....0666660..",
    "...06660660..",
    ".0011666660..",
    ".0111166660..",
    "01100002600..",
    "010..02620...",
    "01...0660....",
    ".0..06620....",
    "...00662000..",
    "..01a060aa1..",
    ".0j1aa0aa12..",
    "02jj1aaa1jj..",
    "02jjj111jjj..",
    "0j2jjj2jjj2..",
    "0jj2jjj2222..",
    ".0222jjjj22..",
    ".0jjj22jjj22.",
    "002jjjj22222.",
    "..022222222..",
    "..0111111550.",
    "..0111111550.",
    "..0222222220.",
    "..0jjjj22220.",
    "..0jj22jj220.",
    "..022jjj2220.",
    "..0jjjj2220..",
    "..0jj22j220..",
    "...02jj220...",
    "...0jj2220...",
    "....022j220..",
    "....0jjj22200",
    ".....00222220",
    ".......000000"],
  horus:[
    "........00.0..",
    "........030d0.",
    ".......0330d0.",
    "......03300d0.",
    ".....03330dd0.",
    "....033330d0..",
    "....033330d0..",
    "...033330dd0..",
    "..0d0000ddd0..",
    "..0ddddddd0...",
    "...011dddd0...",
    "...011dddd0...",
    "...00000000...",
    "..0333331ee0..",
    "..033100i3e0..",
    "..013i00i3ee0.",
    ".0gg13.333ee00",
    ".0gia3i333ee01",
    ".00333333ee00.",
    ".0e03330ee00..",
    ".0e03330ee0...",
    "00e0kkk0ee00..",
    "04e01110ee044.",
    "0410433011033.",
    "040034300033..",
    "03433344333...",
    "03343333444...",
    "00444433334...",
    ".0333344444...",
    ".0433333344...",
    "00044444444...",
    "..011111155...",
    "..011111155...",
    "..0444444440..",
    "..0333444440..",
    "..0334333440..",
    "..0443334440..",
    "..033334440...",
    "..033443440...",
    "...0433440....",
    "...0334440....",
    "....0443440...",
    "....043344400.",
    ".....00433440.",
    ".......000000."],
  anubis:[
    "....0...0....",
    "...0a0.0a0...",
    "...0a0.0a0...",
    "...0i0.0i0...",
    "...0i000i0...",
    "..0iaaaaai0..",
    ".0iiiaaaiii0.",
    ".0i1iiii1i0..",
    ".0iiiiiiii0..",
    "..0iiiiii0...",
    "..0i7777i0...",
    "..0i7007i0...",
    "..0i7777i0...",
    "...0i77i0....",
    "....000......",
    "0101101107b0.",
    "b00770007b70.",
    "bbbb7bbbb770.",
    "7bbbb7777770.",
    "777bbbbb770..",
    "bbb77777770..",
    "0bbbb77770...",
    "0111111550...",
    "0111111550...",
    "0777777770...",
    "0bbb777770...",
    "0bb77bb770...",
    "077bbb7770...",
    "0bbbb7770....",
    "0bb77b770....",
    ".077b770.....",
    ".0bb7770.....",
    "..077b770....",
    "..07bb77700..",
    "...00777770..",
    ".....00a000..",
    "......egg...."],
};
const ORDER=['ptah','ra','thoth','horus','anubis'];

// 1px transparent pad + silhouette outline: any empty cell touching a real body
// color (not '.' and not the black outline '0') becomes '0'. This closes the
// outline around the WHOLE figure — the extraction lost it on the back/right edge.
function withOutline(rows){
  const w0=Math.max(...rows.map(r=>r.length));
  const norm=rows.map(r=>r.padEnd(w0,'.'));
  const pad=['.'.repeat(w0+2),...norm.map(r=>'.'+r+'.'),'.'.repeat(w0+2)];
  const h=pad.length,w=pad[0].length, g=pad.map(r=>r.split('')), out=g.map(r=>r.slice());
  const body=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&g[y][x]!=='.'&&g[y][x]!=='0';
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)
    if(g[y][x]==='.'&&(body(x-1,y)||body(x+1,y)||body(x,y-1)||body(x,y+1))) out[y][x]='0';
  return out.map(r=>r.join(''));
}
for(const n of ORDER) GODS[n]=withOutline(GODS[n]);

function dims(rows){return {w:rows[0].length,h:rows.length};}
function drawGod(fb,W,name,ox,oy,sc){
  const rows=GODS[name];
  for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){
    const ch=rows[r][c];if(ch==='.')continue;const col=PAL[parseInt(ch,36)];if(!col)continue;
    for(let dy=0;dy<sc;dy++)for(let dx=0;dx<sc;dx++){const px=(ox+c)*sc+dx,py=(oy+r)*sc+dy;const i=(py*W+px)*4;fb[i]=col[0];fb[i+1]=col[1];fb[i+2]=col[2];fb[i+3]=255;}
  }
}
// shared so the terminal scene (web/kitty-scene.cjs) draws the SAME sprite data.
module.exports={PAL,GODS,ORDER,dims,drawGod};

if(require.main===module){
  const OUT='/Users/jhuang/alexandria-workspace/alexandria/web/';

  // per-god native transparent sprites
  for(const name of ORDER){
    const {w,h}=dims(GODS[name]);const fb=Buffer.alloc(w*h*4);
    drawGod(fb,w,name,0,0,1);writePNG(OUT+'god-'+name+'-1x.png',w,h,fb);
  }

  // combined preview sheet — bottom-aligned (feet line up; disk/crown rise), a bit bigger
  const SC=12, GAP=3, PAD=2;
  let maxH=0,totW=PAD;for(const n of ORDER){const d=dims(GODS[n]);if(d.h>maxH)maxH=d.h;totW+=d.w+GAP;}
  const W=totW*SC, H=(maxH+PAD*2)*SC;const fb=Buffer.alloc(W*H*4);
  const bg=hx('#20242e');for(let i=0;i<W*H;i++){fb[i*4]=bg[0];fb[i*4+1]=bg[1];fb[i*4+2]=bg[2];fb[i*4+3]=255;}
  let ox=PAD;for(const n of ORDER){const d=dims(GODS[n]);drawGod(fb,W,n,ox,(maxH-d.h)+PAD,SC);ox+=d.w+GAP;}
  writePNG(OUT+'gods.png',W,H,fb);
  console.log('wrote gods.png ('+W+'x'+H+') +',ORDER.map(n=>'god-'+n+'-1x.png').join(', '));
}

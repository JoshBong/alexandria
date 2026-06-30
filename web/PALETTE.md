# Alexandria — God Sprites: Color Scheme + Draft Handoff

Everything you need to take the sprites into an online pixel editor and iterate.

## Files in this folder
- `*-1x.png` — **native-resolution** sprites (1 px = 1 px). Import these into the editor and zoom in.
  - `anubis-1x.png` — detailed Anubis bust (the one we've been iterating)
  - `ra-1x.png` — detailed Ra bust
  - `gods-sheet-1x.png` — the 5 small sprites (Ptah · Ra · Thoth · Horus · Anubis)
- `palette.png` — every color as swatches; import as a palette (Lospec/Aseprite read PNG palettes)
- the big `*-preview.png` / `sprite-styles.png` are the upscaled views (reference only, don't edit these)

## How to import
- **Piskel** (piskelapp.com): File → Import → drop a `*-1x.png`. Each pixel is editable.
- **Lospec Pixel Editor** (lospec.com/pixel-editor): New → set canvas, then Import image; Palette → Import → `palette.png`.
- **Aseprite**: File → Open the `-1x.png`; Palette → Load Palette → `palette.png`.

---

## Palette (hex)

### Shared
| Role | Hex |
|---|---|
| Outline (near-black) | `#16131c` |
| Eye white | `#f2eee4` |
| Pupil | `#16131c` |
| Nemes collar — cream | `#e2dcc4` |
| Nemes collar — mauve | `#7c6486` |
| Nemes collar — tan | `#c4a064` |
| Small-sprite belt (gold) | `#e8c062` |
| Reddish skin — light | `#cf6b3a` |
| Reddish skin — mid | `#b5582f` |
| Reddish skin — dark | `#8a3f20` |

> **Wisp** = a dimmed version of each god's robe color. Anubis wisp used `#4a3f5e` (dim) / `#322a40` (faint).

### Anubis (jackal)
| Role | Hex |
|---|---|
| Fur | `#2a2735` |
| Ear / edge sheen | `#5b536e` |
| Gold marking | `#d6b24a` · bright `#f0d27a` |
| Robe violet — light | `#8a72c4` |
| Robe violet — dark | `#6e57a8` |

### Ra (falcon + sun disk)
| Role | Hex |
|---|---|
| Sun disk — orange | `#e9551e` · deep `#c43c12` |
| Disk ring / uraeus gold | `#f0b53a` · `#f0c64a` |
| Nemes blue — light | `#2a4a9a` · dark `#1d3570` |
| Falcon face — white | `#ece8dc` · shadow `#b8b2a0` |
| Beak | `#e0a93a` |
| Collar — gold / turquoise / red | `#e8b53a` · `#2bb3a0` · `#c0392b` |
| Kilt white | `#ece8dc` |
| Gold sash | `#d8a52e` |

### Thoth (ibis)
| Role | Hex |
|---|---|
| Robe | `#60a8ff` |
| Ibis head — white / shadow | `#ece7d6` · `#b9b39c` |
| Beak (dark) | `#222228` |

### Horus (falcon)
| Role | Hex |
|---|---|
| Robe | `#eef0fa` |
| Falcon head — light / shadow | `#c6b78c` · `#9a8a64` |
| Beak | `#e6ad3c` |

### Ptah (human — the lone human)
| Role | Hex |
|---|---|
| Robe | `#40d2aa` |
| Skin / nose | `#86b09a` · `#5f8a72` |
| Blue skullcap | `#2f63a0` |
| Beard | `#1c2630` |

### Sun disk overlay (Ra, small sprite)
`#ffcf3f` (gold) · `#fff0b0` (highlight)

---

## Style variants (from the 3-row sheet)
- **Bold** — outline `#16131c`, vivid robe colors (×1.1 brightness)
- **Tomb** — limited palette robes: Ptah `#2fb6a0` · Ra `#e6b53e` · Thoth `#36589c` · Horus `#d9cdaa` · Anubis `#5b4a8c`
- **Soft (selout)** — outline `#302822` (warm dark-brown, not black), robes lifted ~×0.9 + 12

---

## Flat list (paste into Lospec "create palette")
```
#16131c
#f2eee4
#e2dcc4
#7c6486
#c4a064
#e8c062
#cf6b3a
#b5582f
#8a3f20
#2a2735
#5b536e
#d6b24a
#f0d27a
#8a72c4
#6e57a8
#4a3f5e
#322a40
#e9551e
#c43c12
#f0b53a
#f0c64a
#2a4a9a
#1d3570
#ece8dc
#b8b2a0
#e0a93a
#e8b53a
#2bb3a0
#c0392b
#d8a52e
#60a8ff
#ece7d6
#222228
#eef0fa
#c6b78c
#9a8a64
#e6ad3c
#40d2aa
#86b09a
#5f8a72
#2f63a0
#1c2630
#ffcf3f
#fff0b0
#2fb6a0
#e6b53e
#36589c
#d9cdaa
#5b4a8c
#302822
```

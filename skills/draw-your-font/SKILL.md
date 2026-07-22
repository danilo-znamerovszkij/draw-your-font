---
name: draw-your-font
description: Turn a photo of handwriting into a real installable font (TTF/WOFF/WOFF2). Use when the user shares a photo of handwritten letters and wants a font, asks to "make my font", "handwriting font", "turn my handwriting into a font", "font from this photo/image", asks for a handwriting font template, or wants to refine a font made earlier (smoother, thicker, fix a letter). Not for choosing, recommending, or identifying existing fonts - only for creating a font from the user's own handwriting.
---

# draw-your-font

Photo of handwritten letters in → installable font out. You do the seeing
(find and label letters, judge quality); the CLI does all geometry (trace,
metrics, font assembly). Never edit SVG paths or coordinates yourself.

## Setup (once per session)

Run `node <skill-dir>/scripts/resolve-cli.js` once. It prints the CLI
invocation to use (e.g. `node /abs/path/src/cli.js`). Substitute that printed
command wherever the examples below show `$DYF` - shell variables do not
persist between tool calls, so paste the real command each time.

If it errors, run `npm install` where it tells you (or `npm i -g
draw-your-font`) and retry. Requires Node ≥ 18. Everything runs locally;
nothing is uploaded.

## Decide the flow

- **User has no photo yet** → offer the template: print, write, photograph.
- **User shares photo(s) of handwriting** → main flow below.
- **User pasted an image but there is no file path** → you can see it, but the
  CLI needs a file. Ask them to drag the image file into the terminal (that
  inserts its path) or give the path directly. Do not proceed from memory.
- **User wants changes to a font built this session** → Refine section.

## Template flow (best quality)

```bash
$DYF template -o template.pdf --charset minimal   # or: spanish
```

Tell the user: print it, write one character per box with a dark pen
(0.5 mm+), keep the letter sitting on the solid line, then photograph each
page from above in good light and share the file paths. The grid prints in
light grey and vanishes during processing - only their ink survives.

## Main flow: photo(s) → font

**1. Segment.** Works for template pages and freeform photos alike:

```bash
$DYF segment photo1.jpg photo2.jpg -d work
```

**2. Look, then label.** Read `work/contact-1.png` (one per photo): every
detected blob is numbered. This is the step where your eyes matter - check:

- Did every written character get exactly one box? A letter drawn with
  separate strokes may appear as two boxes (relabel handles it: give the main
  box the character and mark the fragment `""`), and two touching letters may
  share one box (ask the user to re-shoot just those, or accept the gap).
- Junk boxes (shadows, ruled lines, smudges, page edges) → label them `""`.

Then write `work/labels.json` mapping blob id → character, e.g.
`{"0": "A", "1": "B", "7": "", "8": "a"}`:

- Template page: order is the charset order printed on the template - verify
  against the sheet instead of trusting it blindly. minimal order: A–Z, a–z,
  0–9, then `.,;:!?'"-()@#&+/$`; spanish appends `ÑñÁÉÍÓÚáéíóúü¿¡`.
- Freeform: identify each letter from the contact sheet. Uppercase vs
  lowercase for shape-twins (S/s, O/o, C/c, X/x…) is decided by relative size
  and position - compare against neighbors you're sure of.
- The user told you what they wrote (e.g. "ABC then abc")? Trust it, map in
  reading order (top row first, left to right), and verify visually.
- Same letter appears twice → label the better-drawn one, `""` the other.

**3. Build.**

```bash
$DYF build -d work --labels work/labels.json --name "Dan's Hand"
```

Name the font after the user (ask if unclear - one short question max).

**4. Judge before delivering.** Read `work/preview.png` and `work/glyphs.png`
and critique like an art director:

- Broken or blotchy letters (bad trace) → often a faint pen stroke; try
  `--weight 1`, or ask for a re-shoot of just that letter.
- Everything too thin/thick → rebuild with `--weight 1` / `--weight -1`.
- Jagged edges → rebuild with `--smooth 1.5` (up to 2).
- A letter placed wrong (e.g. a `g` not descending) → usually a mislabel;
  fix labels.json and rebuild.
- Filled-in bowls (b, o, g look solid): should never happen - if it does,
  the crop is smudged; ask for a re-shoot.

Rebuilds are cheap and safe to iterate. Fix what you can yourself first;
only bother the user for re-shoots when the source ink is the problem.

**5. Deliver.** The font lands at `<workdir>/<NameWithoutSpaces>.ttf` (the
build output prints the exact path). Give that path and how to install:
macOS - double-click → "Install Font"; Windows - right-click → "Install".
Mention what's missing (the build prints uncovered letters) and offer,
without pushing:

- Web formats + CSS: rebuild with `--formats ttf,woff,woff2,css`.
- A legibility read (below).
- Their next photo to fill missing characters: re-run segment with ALL
  photos (old and new) into a fresh workdir - `$DYF segment p1.jpg p2.jpg -d
  work2` - then relabel from the new contact sheets (blob ids renumber; the
  old labels.json does not carry over) and build from the new workdir.

## Refine (conversational iteration)

| User says | Do |
|---|---|
| "smoother / rounder" | `build … --smooth 1.5` (max 2) |
| "thicker / bolder" | `build … --weight 1` (max 2) |
| "thinner / lighter" | `build … --weight=-1` (negative needs the `=` form) |
| "the g looks bad" | show them `work/crops/<id>.png` for that letter; offer re-shoot or smooth |
| "wrong letter" / swap | edit labels.json, rebuild |
| "give me woff2 / web" | `build … --formats ttf,woff,woff2,css` |
| custom preview text | `$DYF preview -d work --text "…"` (after a build) |

All refine commands rebuild from the stored crops - no re-photographing
needed unless the ink itself is the problem.

## Legibility report (offer after delivering)

```bash
$DYF preview -d work --text "minimum mill rn m cl d I l 1 O 0 quick brown fox" -o work/legibility.png
```

Read it and give an honest, kind read: a score out of 10 for body-text use,
the 2–3 letter pairs most likely to confuse (rn→m, cl→d, I/l/1, O/0), and one
or two concrete fixes (rewrite those letters larger, more spacing). Note that
display use (headings, notes) is more forgiving than paragraphs. Never gate
delivery on this - it's advice, not a blocker.

## Troubleshooting

Segmentation found far too many / too few blobs, grey guide lines surviving,
shadow blobs, faint ballpoint strokes → see
[references/troubleshooting.md](references/troubleshooting.md).

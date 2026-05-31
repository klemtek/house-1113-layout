# 1113 45th Ave NE Layout

Interactive floor-plan layout editor seeded from the provided plan scan.

## Run

```bash
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/`.

The hosted page is protected by a simple client-side passcode gate.

## What It Does

- Exterior walls are locked and cannot be moved.
- Exterior window/opening gaps are marked in blue with an on-canvas color key.
- Interior walls can be selected, dragged, nudged, resized by handles, deleted, or added.
- Added lines can be labeled by color: black, red, blue, green, or brown.
- Room labels can be moved and edited with room names, dimensions, and contractor/wish-list notes.
- Add Line snaps to the 6-inch grid and nearby wall endpoints/intersections so new walls connect cleanly.
- Selected walls show live scaled length, and selected labels show printed and closed-area square-foot estimates.
- The original plan scan can be toggled on as a faint reference underlay.
- Export buttons create shareable SVG, PNG, or JSON project files in a normal browser.

## Measurement Note

The drawing uses the visible printed room dimensions from the scan for labels and a normalized 1-foot drawing grid for wall positions. It is close enough for discussion and planning, but a licensed architect, contractor, or surveyor should verify final dimensions before construction.

## Hosting Note

GitHub Pages is static hosting. The passcode screen deters casual viewing, but it is not a substitute for private hosting because public repository files and static assets can still be inspected directly.

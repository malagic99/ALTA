# Backup — before pipeline web-component upgrade

Snapshot of the five live site files as they stood on `origin/main`
at `ec554a2`, immediately before merging the follow-up PR that swaps
the four pipeline step diagrams to `<alta-*>` web components.

## What's here
- `index.html`, `styles.css`, `script.js` — live site at that revision.
- `arch-compare.js`, `thermal-demo.js` — unchanged by the follow-up but
  included so this directory can be dropped back onto the repo root as
  a complete site state.

## What was about to change
- Add `pipeline/` directory (5 web-component JS files).
- Replace the inline SMIL SVGs inside each pipeline step's "Look inside"
  panel with `<alta-fbg>`, `<alta-prc>`, `<alta-wdm>`, `<alta-downlink>`.
- Append light-theme SVG color overrides to `styles.css`.

## Roll back
From the repo root:

```
cp backups/alta-before-pipeline-components-20261015T163837Z/{index.html,styles.css,script.js,arch-compare.js,thermal-demo.js} .
rm -rf pipeline
```

Commit the result. The web-component tags left in markup would then
render as empty custom elements — remove the `<script src="pipeline/...">`
tags from `index.html` too for a clean revert.

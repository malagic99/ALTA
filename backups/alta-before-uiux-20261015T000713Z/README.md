# ALTA UI/UX refinement — pre-change backup

Captured: 20261015T000713Z (UTC)
Branch: claude/create-alta-website-dmXME
Head commit: 89fa654 — Swap chip-footprint Wang viz for architecture-comparison demo (Photonic FLP vs Silicon Digital)

## Files
| File | Role |
|---|---|
| index.html      | Page markup (hero, sections, nav, footer) |
| styles.css      | All styling, light/dark themes, print |
| script.js       | Nav toggle, theme toggle, starfield, FLP expander, anomaly sim, roadmap drill-down |
| arch-compare.js | Architecture-comparison viz (Photonic FLP vs Silicon Digital) — unchanged by this task but copied for completeness |

## Restore
From repo root:

    cp backups/alta-before-uiux-20261015T000713Z/index.html .
    cp backups/alta-before-uiux-20261015T000713Z/styles.css .
    cp backups/alta-before-uiux-20261015T000713Z/script.js .
    cp backups/alta-before-uiux-20261015T000713Z/arch-compare.js .

## Not included
.git, node_modules (none), .env (none), /assets (unchanged by this task), /backups (recursive).

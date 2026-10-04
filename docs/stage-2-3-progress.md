# Stage 2-3 progress

Read this first at the start of every run. Source of truth for features and acceptance:
`docs/stage-2-3-spec.md`. How to work: `docs/stage-2-3-prompt.md`. Audit: `docs/stage-2-3-audit.md`.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M2.0 Audit | **Done** (October 2026) | `docs/stage-2-3-audit.md`. No code changes. |
| M2.1 3D foundation | Waiting for the owner's go-ahead | Proposed additions: machine-model data, `StockModel` interface + bull cutter, WASM/CSP groundwork (audit section 8). |
| M2.2 - M2.11 | Not started | |
| M3.1 - M3.7 | Not started | |

## Baseline (start of Stage 2)

- Tests: **217 passed + 1 skipped = 218** (the skipped one needs real HOMAG MPRs locally).
- Typecheck clean. Lint: 0 errors, **17 pre-existing warnings** (the baseline for "zero new").
- Build OK. `npm run sample`: MPRs and CSVs identical; the two PDFs differ (stale committed
  labels PDF, and a creation timestamp in the sheet-map PDF). See audit section 1.

## Decisions received from the owner

None yet.

## Open questions for the owner

Numbered as in the M2.0 report.

1. Git branch: the build prompt says commit to `main`; this session is set up to push to
   `claude/amazing-albattani-2kw34z` and not to other branches without permission. The audit was
   pushed to that branch. Merge it to `main`, or allow pushing to `main` directly?
2. How 3D toolpaths should reach woodWOP (audit 5.9). Recommendation: constant-Z ops (Z-level
   roughing, waterline) as normal contour-milling macros first; for true 3D, provide a woodWOP
   doc page or a small 3D program saved from woodWOP. Until then 3D MPR output stays off.
3. N-200 facts: travel limits / table size, origin, spoilboard thickness, tool-change position,
   saw unit (yes/no), aggregate (yes/no). Until then: placeholders, saw and aggregate treated as
   absent once the machine model exists.
4. Real 3D tools (ball-nose, bull-nose, tapered), holders and stick-outs. Until then:
   placeholder tools clearly marked.
5. Default feeds, speeds, step-downs and step-overs for 3D in the shop's materials. Until then:
   placeholder defaults, output off.
6. Approve storing meshes/solids as separate compressed files next to the shop file
   (`data/blobs/`), not inside `cabinet-studio.json`.
7. Fix the stale-flag gap (through depth and material feeds don't mark ops stale). Side effect:
   existing ops show "stale" once after the update.
8. Regenerate `examples/sample-job/` and make the sheet-map PDF date fixed so `npm run sample`
   is reproducible.
9. Milestone order changes in audit section 8.
10. OK to measure performance in the cloud container and give you a command to time it on the
    shop laptop?

## Run log

### Run 1 (M2.0 Audit)

- Installed, ran the baseline, read the codebase, wrote the audit and this file.
- Commit: see the run report (pushed to `claude/amazing-albattani-2kw34z`).

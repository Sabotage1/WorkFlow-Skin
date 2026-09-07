# WorkFlow 0.3.10 compatibility with Decaid 0.8.5

Checked on 2026-09-07 against the installed version reported by the user and
the latest stable upstream release, Decaid 0.8.5 (formerly ReaPrime).

Upstream source: [`v0.8.5`, commit `a08bc41e02c66c71f8da56b624c642264afebbc6`](https://github.com/decentespresso/decaid/tree/v0.8.5).
The newer 0.8.6-beta.1 API diff was inspected; it adds capabilities and does not
remove the skin's endpoints. This report targets stable 0.8.5.

## Wake recovery

The reported message was `Could not apply startup profile: Failed to fetch`.
Previously, startup selection used optimistic state as confirmation, consumed
retries without a delay, and retained the error even after recovery.

The skin now reads the current workflow and machine state before applying the
startup profile. Temporary network, timeout, queue, and machine availability
errors retry after 1, 2, 4, 8, 16, then 30 seconds, with subsequent retries capped
at 30 seconds. The error clears when the app confirms the profile. Invalid
requests remain visible instead of being replayed. Manual preset selection
cancels startup retries, and late failures cannot undo the user's selection.
Sleeping, active machine operations, hidden pages, and unloaded skins pause or
cancel automatic profile writes. These retries never start a shot.

Workflow and machine reads have a 10-second timeout; workflow writes allow 60
seconds for Decaid's ordered machine-write queue. Other machine commands are
not automatically replayed. Device connection conflicts and transport failures
keep their original error instead of invoking obsolete connection payloads.

Decaid can unload an embedded skin after ten minutes in the background.
Initial loading now retries if the local API has not resumed, and foreground
or online events refresh saved data and reopen telemetry. Concurrent full
refreshes are coalesced.

## Compatibility coverage

| Feature | Contract checked in upstream 0.8.5 | Verification |
| --- | --- | --- |
| Profiles and presets | Profile records, nonempty profile steps, partial workflow deep merge, context/extras | API audit; selection and recovery tests |
| Brew, weight stop, steam, hot water | Workflow context targetYield, steamSettings, hotWaterData, machine state commands, scale tare/timers | Workflow runner and scale fallback tests |
| Scale, R2, machine status | Device discovery/connect states, sensor execute, scale status frames, machine/water/shot WebSockets | API audit; device and telemetry tests |
| Bags and grinders | Beans, batches, grinder CRUD; archived filters | API audit; data and page tests |
| History and Review | Paginated shot summaries; full shot detail/measurements; annotation patches | API audit; history, Review, lifecycle and graph tests |
| Visualizer | Bundled visualizer.reaplugin upload, status, lastUpload, backSyncStatus, forwardSyncStatus | Upstream plugin inspection; integration tests |
| Saved settings and display | POST store writes, settings, brightness, wake-lock; skin manifest loader | API audit; storage and display tests |
| Community | External community API and local profile installation | Existing community regression tests |

The repeatable contract check parses the skin's actual request calls and
compares 60 REST/telemetry routes and methods against upstream specifications.
Three explicitly retained legacy fallback routes are reported separately.
Route checks do not validate all payload fields or exercise the physical machine.

```sh
cd skin/workflow-skin
npm run check:compatibility -- /path/to/decaid-v0.8.5
npm test
npm run e2e
npm run package
```

Validation: 394 unit/integration tests and 16 desktop/tablet browser checks
passed, including a sleep/wake scenario with an aborted workflow fetch, HTTP
503, recovery, preserved dose/yield/steam settings, and no stale error banner.
Production build and ZIP integrity/manifest checks passed for the package.

The browser tests use a simulated gateway. The actual Android tablet, BLE
scale, R2 readings, brewing/weight stop, and external upload services were not
operated in this session. A physical sleep/wake cycle after installing the ZIP
remains the hardware confirmation step. Install `workflow-skin.zip` from the
[v0.3.10 release](https://github.com/Sabotage1/WorkFlow-Skin/releases/tag/v0.3.10),
or check for skin updates in Decaid using `Sabotage1/WorkFlow-Skin`.

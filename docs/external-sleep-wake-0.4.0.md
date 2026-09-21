# WorkFlow 0.4.0: external sleep and wake

When Apple Home puts the espresso machine to sleep, the skin now enters its
screensaver, displays confirmed machine sleep, releases wake lock, and applies
the configured screensaver brightness. This works from any skin page and when
the skin first loads with the machine already asleep. The skin observes the
machine state exposed by Decaid, so the same behavior applies to other external
controllers that use the native sleep state.

The state monitor confirms sleep through a fresh REST read before changing the
screen. Live state changes or WebView resume trigger an immediate check, while
a five-second fallback poll handles missing telemetry. Disconnected machines,
missing state, and stale sleep frames alone do not dim the display.

External sleep uses the normal skin sleep transition without sending a second
machine sleep command. External wake likewise restores the skin without an
extra machine idle command. Wake restores the display, resets the idle timer,
restores the configured startup preset, and recovers devices. Manual screen-tap
wake remains supported, and an already-running brew is not interrupted by a
startup profile write.

Sleep-generation checks prevent delayed reads from a previous cycle from
dismissing or re-entering the screensaver. One shared monitor handles both
directions; the former separate wake listener no longer duplicates recovery.
A first wake after loading an already-sleeping machine claims initial device
discovery exactly once.

## Validation

The full suite passed 419 unit/integration tests and 28 desktop/tablet browser
checks. The release procedure also verifies the production build, ZIP integrity,
embedded version, and downloaded release bytes.

Commands run from `skin/workflow-skin`:

```sh
npm test
npm run e2e
npm run check:compatibility -- /path/to/decaid-v0.8.5
npm run check:compatibility -- /path/to/decaid-v0.8.6
npm run package
```

API checks cover all 61 current REST/telemetry routes and methods against both
Decaid 0.8.5 and 0.8.6. Three explicit legacy fallbacks are reported separately.
Decaid 0.8.6 remains the latest stable upstream release checked September 21,
2026. Route checks do not validate all payloads or physical device behavior.

Regression scenarios cover Apple Home sleep from Settings, stale sleep frames,
sleep without telemetry, disconnection and missing state, late sleep reads
after a newer wake, initial discovery, external wake, and screen-tap wake.
Desktop and tablet browser checks change simulated machine state externally,
verify the screensaver and brightness, and assert no duplicate sleep command.
The complete suite also covers existing Review, profiles, devices, history,
community, settings, and workflow behavior.

Automated checks use a simulated Decaid gateway. The real Apple Home/Home
Assistant setup, Android tablet, espresso machine, BLE scale, and R2 were not
operated during this release.

Install `workflow-skin.zip` from the
[v0.4.0 release](https://github.com/Sabotage1/WorkFlow-Skin/releases/tag/v0.4.0),
or check for skin updates in Decaid using `Sabotage1/WorkFlow-Skin`.

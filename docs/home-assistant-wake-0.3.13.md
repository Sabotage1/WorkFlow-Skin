# WorkFlow 0.3.13: Home Assistant wake

When Home Assistant woke a machine that had entered sleep from the skin, the
skin remained on its screensaver. The sleep monitor only changed the status to
"Sleep not confirmed", and native wake handling explicitly skipped the
screensaver. The internal sleep intent also stayed set, blocking startup
profile restoration.

The screensaver now remembers confirmed machine sleep for the current sleep
cycle. A subsequent fresh REST response reporting a connected machine in a
non-sleeping state starts the skin's normal wake recovery. Live state changes,
focus, online, pageshow, and visibility restoration trigger a check promptly;
the existing five-second poll also detects external wakes without telemetry.

Recovery dismisses the screensaver, clears the sleep intent, resets the idle
timer, restores brightness and wake lock according to settings, restores the
configured startup preset, and recovers devices. A confirmed external wake
does not send another machine idle/wake command. Startup profile writes stay
paused during an active brew. Pending dim operations finish before brightness
is restored.

An unconfirmed sleep request, disconnected machine, missing state, or stale
idle WebSocket frame alone does not dismiss the screensaver. A delayed read
from an earlier sleep cycle cannot dismiss a newer sleep request.

## Validation

The full suite passed 415 unit/integration tests and 24 desktop/tablet browser
checks. The production build and release ZIP are also checked before publishing.

Validation commands run from `skin/workflow-skin`:

```sh
npm test
npm run e2e
npm run check:compatibility -- /path/to/decaid-v0.8.5
npm run check:compatibility -- /path/to/decaid-v0.8.6
npm run package
```

Both API specifications retain the 61 REST/telemetry routes and methods used
by the skin, with three explicit legacy fallbacks reported separately. Decaid
[0.8.6](https://github.com/decentespresso/decaid/releases/tag/v0.8.6), published
September 16, is the latest stable upstream release checked on September 21,
2026. These route checks do not prove every payload or device interaction.

Regression tests cover external wake via polling, live telemetry and WebView
resume; preset and display restoration; resetting the idle timer; incomplete
sleep, disconnection and missing states; stale responses across sleep cycles;
and an already-running brew. Desktop and tablet browser scenarios change the
simulated native machine state without touching the skin's wake button and
assert no extra machine wake request. Existing sleep, Review, device,
community, history, settings and profile tests are included in the full suite.

This validation uses a simulated Decaid gateway. It does not operate a live
Home Assistant instance, Android tablet, espresso machine, scale, or R2.

Install `workflow-skin.zip` from the
[v0.3.13 release](https://github.com/Sabotage1/WorkFlow-Skin/releases/tag/v0.3.13)
or check for skin updates in Decaid using `Sabotage1/WorkFlow-Skin`.

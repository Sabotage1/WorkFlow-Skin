# Settings → Updates

WorkFlow Skin 0.4.8 adds a fourth Settings tab for machine firmware and the Decaid app.

## Machine firmware

The page shows the connected machine, its installed firmware build, the firmware
catalog supplied by Decaid, and release notes for the recommended update. It only
offers managed installation when Decaid marks that artifact applicable. Unknown
versions, no connection, and incompatible models do not appear as “up to date.”

Installation requires confirmation and a fresh idle/sleep state check. Managed
installation rechecks eligibility and always sends `force: false`. Manual uploads
accept a non-empty file up to 16 MiB and require a classic DE1 model. Firmware
files should come from Decent and match the machine. Bengle manual uploads are
disabled.

Progress belongs to the app rather than the Settings view, so changing tabs or
navigating away does not drop the update stream. A banner returns to the update
screen. Native sleep and the skin's auto-sleep timer are disabled during a known
firmware operation, and closing/reloading the page raises a browser warning.

HTTP acceptance or 100% uploaded is not success. The screen waits for Decaid's
terminal `done` event, which represents machine verification. Interrupted streams,
verification errors and rejected requests remain failures. Cancellation calls
Decaid's cancellation endpoint rather than merely hiding the progress display.

## Decaid app

The page shows Decaid's version, update availability, release notes and download
progress. Check/install commands use Decaid's update channel. Installation is
only offered when Decaid reports `installable: true`; other platforms receive a
release link. App Store builds direct users to their store. Unsupported commands
and network failures remain visible. Refresh status can reconnect after Decaid
restarts. A stale REST response cannot overwrite a newer live update status.

Firmware and app installation cannot be started together. Nothing installs just
by opening this page.

## API and compatibility

| Operation | Decaid API |
| --- | --- |
| Machine identity/version | `GET /api/v1/machine/info` |
| Firmware catalog | `GET /api/v1/machine/firmware` |
| Managed firmware | `POST /api/v1/machine/firmware/apply` |
| Manual file | `POST /api/v1/machine/firmware` (`application/octet-stream`) |
| Cancellation | `DELETE /api/v1/machine/firmware` |
| App update snapshot | `GET /api/v1/update` |
| App check/install | `/ws/v1/update`, commands `check` and `install` |

The NDJSON firmware transport and update payloads follow Decaid's released API.
Missing features on older builds show an availability message; the rest of the
skin remains usable. Route/method checks cover Decaid 0.8.8, 0.9.0, 0.9.1 and
0.9.2. The controller, transport and desktop/tablet browser checks use simulated
responses. No physical machine has been flashed and no Decaid app has been
installed during this validation.

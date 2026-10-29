# WorkFlow 0.4.2: dedicated R2 driver readings

The dedicated `difluid-r2.reaplugin` driver uses a different measurement contract
from Decaid's built-in DiFluid R2 driver. The old skin passed `{ "timeout": 30 }`
to both, but the plugin rejects parameters. Its `measure` command returns
`{ "started": true }`; the completed TDS arrives later. The skin previously
treated that acknowledgement as a failed reading.

Both automatic post-shot readings and **Read from R2** now use the same adapter:

- Native sensor: `measure` with `{ "timeout": 30 }`, consuming its returned reading.
- Dedicated plugin: `measure` with `{}`, followed by `getReading` with `{}` every
  500 ms until a completed reading arrives, for up to 60 seconds. The documented
  `no_reading` response, including Decaid's HTTP 500 envelope, means the test is
  still pending. Other failures are reported through the existing error/recovery path.
- The plugin clears its previous reading before starting each measurement, so
  polling cannot import the prior test as the new result.
- Sensor IDs are encoded once as opaque URL path components. Discovery prefers
  the executable dedicated R2 driver over leftover native metadata. A successful
  reading saves the actual sensor ID, replacing an outdated native ID.
- The automatic Review transition preserves an already queued reading. Automatic
  and manual actions cannot start overlapping measurements in the Review panel.

TDS still updates the Review fields and EY calculation; **Save Review** persists
the annotations, as before. No driver firmware, plugin settings, machine mode,
or scale policy changes are needed.

## Contract sources

- [Driver commands and snapshot contract](https://github.com/Sabotage1/decaid-difluid-r2#use-through-decaids-sensors-api).
- [Decaid 0.9.0 sensor API implementation](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/lib/src/services/webserver/sensors_handler.dart).
- [Decaid 0.9.0 native R2 implementation](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/lib/src/models/device/impl/difluid/difluid_r2_sensor.dart).

The sensor and native R2 contracts are unchanged in Decaid 0.9.1
(`14361a94b32888f6a81182e9e239f513d39d060c`). Both releases passed the skin's
62 REST/telemetry contract checks.

## Validation

Regression coverage exercises delayed plugin completion beyond Decaid's
10-second invocation limit, pending HTTP errors, disconnects, bounded waiting,
native compatibility, saved-ID migration, automatic scheduling and overlapping
manual/automatic requests. A browser test uses the driver's documented asynchronous
contract to perform an automatic reading, a second manual reading and TDS/EY save
at desktop and tablet sizes. All 458 unit/integration tests passed; the R2 and
sleep/Review browser checks passed at both sizes (four checks), with six additional
R2 browser runs passing after fixing the Review-transition race. Production build
and ZIP integrity checks passed. Physical Bluetooth and installed-tablet validation
must be recorded separately.

The installable artifact is `workflow-skin.zip` at this checkout's root.

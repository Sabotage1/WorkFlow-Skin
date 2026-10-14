# WorkFlow 0.4.1: Decaid compatibility and primary scale recovery

Checked on 2026-10-14. The user's tablet reports Decaid **0.8.8+2900**,
commit `aab5f938fb3e1a8f44af24d99c6b707491b15ed7`, with WorkFlow 0.4.0 and
a preferred **Bookoo Mini Scale**. Compatibility was also checked against
Decaid 0.8.5, 0.8.6, and 0.9.0-beta.2 source releases.

## Live diagnosis before the update

The machine was connected and idle, while the preferred Bookoo was marked
unavailable. Read-only tablet logs showed repeated REST requests with
`connect=false&quick=false`. Each discovery burst paused the lower BLE watch;
diagnostics showed an armed preferred-scale watch with its lower watcher
inactive during the discovery burst. This is direct evidence of the old skin's
discovery competing with the host's scale recovery. It explains why returning
to the native app, which owns automatic connection, can recover the scale.

This snapshot proves the scan conflict. The installed-hardware result below
was recorded separately after the update.

## Changes

- On Decaid 0.8.8 and newer, boot, foreground/wake recovery, automatic retry,
  and the Scale button use the host's scan-and-connect policy. Quick scans
  acknowledge the request while the skin observes the primary scale stream.
  The skin does not issue a competing explicit primary-device connection.
- Live device state reports native scanning and connection work. The skin
  joins that work instead of restarting it. Repeated requests share the same
  pending recovery, with a cooldown when native scan state is unavailable.
- Automatic recovery has an actual five-second scheduler and a thirty-second
  attempt cooldown. It also runs when only a preferred ID exists and the
  scale has disappeared from inventory. It pauses while the page is hidden,
  during machine activity, and across sleep generations.
- Fresh primary scale telemetry wins over a delayed device inventory.
  Auxiliary scales and connected grinders never stand in for the espresso
  scale. A ready machine alone is no longer evidence of a connected scale.
- Intentional `block_tare_during_shot` responses produce a notice without
  reconnecting or repeating tare.
- `pausedSteam` and `puffing` remain part of the steam workflow.
- On 0.9.0-beta.2 and later, the skin opts into
  `connectPreferredScaleEarly`: the host can end a preferred-scale scan early
  and connect only after confirmed BLE teardown. This option is omitted on
  the user's 0.8.8 build.
- Older app versions retain the legacy discovery/connection fallback.

Relevant upstream changes:
[0.8.8 release](https://github.com/decentespresso/decaid/releases/tag/v0.8.8),
[device management contract](https://github.com/decentespresso/decaid/blob/v0.8.8/doc/DeviceManagement.md),
[safe early reconnect](https://github.com/decentespresso/decaid/pull/993).

## Compatibility review

| Area | Result |
| --- | --- |
| Profiles, presets, workflow recipes | Existing routes remain supported; workflow patches retain non-null yield targets. |
| Brew, steam, hot water, scale timer and weight stop | Existing regression checks pass; new steam modes and intentional tare lockout are handled. |
| Bags, grinders, history and Review | Existing CRUD, annotation, graph, delayed persistence and routing checks pass. |
| R2 and Visualizer | Existing sensor/plugin contracts and regression checks pass; no physical R2 or new external upload was performed. |
| Sleep, external wake, display and startup preset | Existing desktop/tablet scenarios pass, including absent telemetry and delayed peripheral responses. |
| Skin origins and storage | The API still uses the gateway's port 8080, independently of the skin's new stable origin. Persistent settings continue through the app's store API. |
| Community | Existing tests pass; community Worker and stored recommendation data are unchanged. |

## Useful next additions

1. **Connected grinder panel.** Decaid 0.8.8 exposes connected grinder identity,
   state and capability-gated controls. A panel could display the live device
   alongside the saved grinder and offer supported setting/RPM/start-stop
   actions. Read-only setting/RPM observations are a further beta.2 addition.
2. **Separate dosing scale workflow.** Auxiliary scale support could weigh
   beans independently while preserving the primary espresso scale for weight
   stop. This needs an explicit role selector and hardware validation.
3. **Connection diagnostics export.** The new read-only BLE diagnostics API
   can capture scan ownership, adapter status and preferred recovery state
   when a connection fails, without asking the user to leave the skin.

These are opportunities, not claims that the new grinder or dosing interfaces
were implemented in this correction.

## Verification

- **446 unit/integration tests passed** across 27 files.
- **40 desktop/tablet browser checks passed**, including twelve new scale checks:
  native 0.8.8/beta.2 connection, stale inventory, auxiliary exclusion, tare,
  intentional tare rejection, joining an existing native scan, uninterrupted
  automatic recovery, recovery paused during brewing/sleep, and external sleep
  during a pending manual recovery without issuing a machine wake.
- The unattended case uses real browser time, with no click, focus,
  navigation or foreground event after the scale becomes available. Both
  viewport sizes recovered in approximately 32 seconds.
- **62 REST/WebSocket routes and methods** pass the repeatable contract check
  against 0.8.5, 0.8.6, 0.8.8 and 0.9.0-beta.2. Three explicit legacy fallback
  routes remain separately identified. Route checks do not prove all payload
  semantics or physical device behavior.
- Production build and ZIP integrity passed. Package, lockfile and embedded
  manifest all identify **0.4.1**.
- Tablet API inspection is live evidence; the automated gateway tests are
  simulated. The physical connection/power-cycle check is recorded below.
  Brewing/weight stop and R2 measurements were not physically exercised.

Local installable artifact: `workflow-skin.zip` at the repository root.

## Published release and installed hardware confirmation

[WorkFlow 0.4.1](https://github.com/Sabotage1/WorkFlow-Skin/releases/tag/v0.4.1)
was published from commit `265632b`. The freshly downloaded release ZIP
matches the local tested artifact:

`sha256:bd58b5a5c164f0f6608a29988642b273f655ebe08463079a9f6f177624a397f4`

The tablet's install API confirmed success through the existing GitHub release
source, and its installed manifest reports 0.4.1. The JavaScript bundle served
by the tablet matches the local release build byte for byte.

The user confirmed that v0.4.1 was open and the Bookoo Mini had been powered
off and back on without leaving the skin for the connection check. At
**23:33:31 on 2026-10-14, Asia/Jerusalem**, the live primary scale WebSocket
reported connected and the native device inventory assigned it the `primary`
role. Actual weight readings followed, including 0, 15.69 and 48.5 grams as
weight changed on the scale. The stream remained active through the observation
window ending at 23:34:07. No brewing command or programmatic scale connection
was issued by the diagnostic observer during this check.

# Atom65 dose per profile

WorkFlow Skin 0.4.6 integrates with Atom65 Profile Sync 0.1.1.
Install both ZIP updates in Decaid, then open **Profiles → Grinder dose** next to a recipe.
Choose a mode and tap **Save grinder choice**:

| Mode | When the profile is selected |
| --- | --- |
| Leave grinder unchanged | Default for an unconfigured recipe. Sends no dose and preserves the existing preset and weight. |
| Use Brew dose | Follows the workflow's coffee dose, including subsequent dose edits. |
| Use a fixed grind weight | Sends the saved weight in grams. The Brew dose remains unchanged. |

The driver owns the saved choices; the skin does not keep a second rule store.
Choices apply to the selected physical Atom65. If several are connected, choose
the device in the editor. Existing Device settings choices and pauses are retained.
Renaming or changing the recipe requires a new opt-in; notes and author changes
retain the existing choice. A disconnected driver must be reconnected in Decaid.

Editing an inactive recipe does not select it or send its dose. Saving a choice
for the active recipe may apply it immediately. The driver validates the range
and 0.1 g increments, persists the choice with a storage acknowledgment, and
handles dose confirmation through its existing Bluetooth protocol. It updates
CUSTOM. Start grinding on the grinder. If a save cannot be confirmed, reload the
saved choice before trying again. Reopen the editor to read changes made elsewhere.

## Packages

- `workflow-skin.zip` at the repository root: WorkFlow 0.4.6.
- [Atom65 Profile Sync 0.1.1](../integrations/atom65-profile-sync/README.md):
  companion plugin update and source. Its driver ID and storage key are unchanged.

No controller firmware change is required for an already working Profile Sync
installation. Package validation does not establish installation on a tablet or
physical grinder operation.

## Saved Brew recipes (0.4.6)

On Brew, **Save recipe** stores the selected profile's coffee dose and yield in
the skin settings. Selecting that profile again restores both values. Startup
selection and Work Flow brew steps use the same saved recipe. Profiles without
a saved recipe retain the existing context behavior; no 18.6 g default is imposed.
Recipe saving does not opt a profile into grinder syncing. The driver's existing
leave/follow/fixed choice controls whether that workflow dose reaches the grinder.

The live workflow uses the confirmed save response immediately. Older background
refreshes cannot replace that workflow or the newly saved settings. Brew controls
are disabled while saving to prevent a profile switch from racing the save. An
unconfirmed or failed save is shown as an error, rather than reported as saved.

## Validation

- 477 skin unit/integration tests passed.
- 56 desktop/tablet browser tests passed, including saving distinct recipes,
  switching back, reloading, and delaying an older refresh. Tablet rendering
  was visually inspected.
- 34 driver/native protocol tests passed, including inactive-recipe editing,
  per-device persistence, excluded profiles, invalid weights, and paused devices.
- A targeted real Decaid QuickJS integration test passed at host commit
  `3e4d9a023f317ff382ea73ac6183827f854408b3`, including the new library endpoint,
  actual host profile serialization, workflow events, storage acknowledgment,
  and fake-transport dose acknowledgment. Dart analysis reported no issues.
- 62 REST/telemetry route/method contracts passed against that local host source
  and each of Decaid v0.8.5, v0.8.6, v0.8.8, v0.9.0-beta.2, v0.9.0, v0.9.1,
  and v0.9.2. The Atom65 plugin API is checked separately by the targeted runtime test.
- Production build and ZIP integrity checks passed.

The host fixture uses the existing disposable checkout and installed Flutter
3.44.1 / Dart 3.12.1 compatibility setup. Missing optional bundled asset warnings
were present; the targeted test passed. This is not a full upstream test run or
physical tablet/grinder validation.

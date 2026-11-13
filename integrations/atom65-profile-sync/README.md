# Atom65 Profile Sync 0.1.1

This is the companion Decaid plugin for WorkFlow Skin's per-profile grinder dose
controls. It supports the custom ESP32-S3 Atom65 GBW conversion with working
Profile Sync firmware, rather than an unmodified Eureka Atom65.

Download [atom65-profile-sync-0.1.1.zip](https://github.com/Sabotage1/WorkFlow-Skin/raw/refs/heads/main/integrations/atom65-profile-sync/atom65-profile-sync-0.1.1.zip).
In Decaid, open **Plugins → Install plugin → ZIP file** and install the update.
The plugin ID and storage key are unchanged, preserving existing saved choices.
No controller firmware update is needed for an already working Profile Sync setup.

After updating the skin, open **Profiles → Grinder dose** next to a recipe.
Choose leave unchanged (the default), follow the Brew dose, or a fixed weight.
The driver stores choices per physical grinder and canonical recipe. Editing an
inactive recipe's choice does not select that recipe or send its dose. Paused
devices stay paused. Start grinding on the grinder; no motor control is exposed.

The new `profile-settings` endpoint lets the skin read and save a library recipe's
choice without changing the current workflow. Its implementation and original
driver source are bundled, unminified, in [plugin.js](atom65.reaplugin/plugin.js).
The [manifest](atom65.reaplugin/manifest.json) declares the API and permissions.
The code is distributed under the included [MIT license](LICENSE).

See the [integration and validation notes](../../docs/atom65-profile-dose.md) for
the storage, dose validation, API, automated test, and physical-test boundaries.
The install ZIP includes the same manifest and plugin source as this directory.

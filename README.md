# WorkFlow Skin

WorkFlow Skin is a workflow-focused ReaPrime skin for Decent Espresso users who want the machine interface to remember more of the coffee workflow: bags, grinders, profiles, review notes, Extraction Yield, R2 readings, shot history, and community profile recommendations.

This repository is the public home for the WorkFlow Skin release asset and the community recommendation backend. The skin itself is designed to run inside ReaPrime/Decent Espresso, while this repo stores the shared recommendation data under `Profiles/` and serves it through the Cloudflare Worker in `worker/`.

Latest release:

- [WorkFlow Skin v0.2.1](https://github.com/Sabotage1/WorkFlow-Skin/releases/tag/v0.2.1)
- Release asset: `workflow-skin.zip`
- Community API: `https://workflow-skin-community.sabotage1.workers.dev`

## Install In ReaPrime

WorkFlow Skin runs inside the ReaPrime app. It is not a standalone app.

When installing from a GitHub release in ReaPrime, use:

```text
Sabotage1/WorkFlow-Skin
```

The release asset is:

```text
workflow-skin.zip
```

If an older install flow or saved entry requests `Sabotage1/WorkFlow`, a compatibility release exists there as well, but `Sabotage1/WorkFlow-Skin` is the canonical repository.

## What The Skin Adds

WorkFlow Skin turns the machine screen into a complete espresso workflow surface rather than only a profile launcher.

| Area | What it does |
| --- | --- |
| Brew | Fast profile preset access, current workflow context, and machine-aware navigation. |
| Review | Post-shot graph review, dose/yield/TDS/EY tracking, taste score, notes, grinder correction, and optional R2 import. |
| Bags | Saved bean/bag records with roaster, coffee name, origin, process, roast date, roast level, and notes. |
| Grinders | Saved grinder records with model, setting type, burrs, and mandatory Burrs Type: Flat or Conical. |
| Profiles | Profile visibility, startup profile, workflow settings, and preset assignment. |
| History | Searchable shot history with bag/profile/grinder context and quick sharing to Community. |
| Community | Search, download, upload, edit, and delete community profile recommendations. |
| Settings | Menu layout, top indicators, themes, preset count, R2 setup, screensaver, wake/auto-sleep, and machine settings. |

## Core Features

### Profile Presets

The main brew screen can show configurable preset cards such as Light, Sweet, Turbo, and Classic. Users can choose how many preset cards appear, rename each preset, and assign visible profiles from the Profiles page.

The Profiles page lets users:

- Show or hide profiles from the preset picker.
- Choose a startup profile.
- Enable or disable post-shot review behavior per profile.
- Mark profiles as milk-focused and configure steam timers.

### Bag Tracking

The Bags page stores the coffee information that usually gets lost between shots:

- Roaster
- Bag name
- Bean or coffee name
- Country
- Region
- Process
- Roast date
- Roast level
- Notes

Community recommendations are intentionally built around saved bags, so users recommend profiles against real beans they have already entered instead of typing loose metadata every time.

### Grinder Setup

The Grinders page stores grinder metadata used during shot review, history, and community recommendations.

Required grinder fields include:

- Grinder model
- Burrs Type: Flat or Conical

Optional fields include:

- Burr set, for example SSP MP
- Setting type, numeric or preset
- Grinder notes

The Community search can filter recommendations by grinder name and by Flat or Conical burr type.

### Post-Shot Review

After a shot, the Review page is the main place to understand and annotate the result.

It includes:

- Shot graph and selected-shot details.
- Dose, yield, TDS, and calculated Extraction Yield.
- Taste score from 1 to 10.
- Golden shot marking for top scores.
- Tasting notes.
- Grinder and grind-size correction.
- Same-bag comparison against recent shots.
- Upload to Visualizer.
- Share recommendation directly from the Review page.

The Review page prefers the grinder saved with the shot before falling back to the default grinder, so recommendations created from review preserve the actual shot context.

### DiFluid R2 Support

WorkFlow Skin can read a DiFluid R2 directly through ReaPrime's native sensor execution API.

Options include:

- Detect and save the R2 sensor.
- Refresh R2 detection from Settings.
- Read TDS from the Review page.
- Auto-read after a shot with a configurable delay.
- Hide R2 status when it is not part of the workflow.

### Shot History

The History page is designed for finding and reusing real shot context.

Users can search and filter by:

- Profile
- Bag name
- Roaster
- Bean
- Country
- Region
- Process
- Roast date
- Roast level
- Grinder
- Taste score and golden shots

History entries can open the full Review page or start a community recommendation with the shot data prefilled.

## Community Profile Recommendations

The Community page lets users share and download working profile recommendations for specific bags and grinders.

### Browsing And Search

Community recommendations are searchable across the recommendation fields, including bag details, profile name, grinder model, burrs, burr type, brew recipe, notes, submitter name, and shot score.

The list shows quick reference details such as:

- Profile title
- Bag and roaster
- Grinder model and burrs
- Flat or Conical burr type
- Grind setting
- Beans in and drink out
- Shot score
- Submitter display name
- Upload date

Opening a recommendation shows full details, optional shot evidence, and a download action.

### Downloading Profiles

When a user downloads a recommendation, the skin installs the profile into the app's local profiles area and stores a local reference in Downloaded Profiles.

Downloaded Profiles keeps the recommendation metadata visible later, including:

- Bag details
- Grinder and burr details
- Brew recipe
- Notes
- Shot score
- Optional TDS/EY and shot evidence

### Uploading Recommendations

A recommendation can be uploaded from:

- The Community page.
- A History entry.
- The Review page after finishing shot notes.

Required fields for upload:

- Existing saved bag
- Existing local profile
- Existing saved grinder
- Burrs Type on the grinder
- Recommended grind setting
- Beans weight
- Drink weight
- Seconds goal or seconds range
- Notes
- Public display name when no safe Decent profile username is available

Optional but highly recommended:

- Shot evidence from history
- Visualizer link

Shot evidence helps other users understand the profile more deeply by showing graph data, shot details, taste score, TDS, EY, and notes when available.

### Uploaded Profiles

The Uploaded Profiles page lets the original uploader manage their own recommendations from the machine that created them.

Uploaders can:

- View the recommendations they uploaded.
- Open full details.
- Edit fields and save an updated recommendation.
- Validate mandatory fields before saving.
- Delete a recommendation when it should no longer be shared.

Ownership is local to the machine through a saved owner key. The public recommendation does not expose that key.

## Settings And Customization

WorkFlow Skin includes user-facing settings for the machine, app behavior, and skin appearance.

### Machine Settings

Machine settings include normal machine controls and an Advanced settings section. Advanced settings are hidden until the user acknowledges that these controls can affect low-level machine behavior and should be changed with caution.

### App And Screen Behavior

Options include:

- Keep screen awake
- Screensaver brightness
- Auto-sleep timeout
- Wake-lock behavior
- Display brightness controls

### Skin Appearance

Appearance options include:

- Skin font size
- Theme selection
- Editable theme colors
- Top status indicators
- Main menu ordering and visibility
- Collapsed or expanded menu
- Number and names of main page presets

### Community API

The Community API base URL is configurable, but the default is:

```text
https://workflow-skin-community.sabotage1.workers.dev
```

## Privacy And Safety

The community system is intentionally narrow.

- The Worker can only write community profile data under `Profiles/index.json`, `Profiles/recommendations/`, `Profiles/profiles/`, `Profiles/evidence/`, and `Profiles/history/`.
- The Worker cannot edit the skin bundle, release assets, `.github/`, README files, or other repository content.
- GitHub token and owner-key secrets live in Cloudflare Worker secrets, not in the open-source skin.
- Public recommendations do not expose owner keys.
- Email-only Decent usernames should not be published as submitter names; the skin falls back to a saved local display name when needed.

## Repository Layout

```text
Profiles/
  index.json              Public recommendation index used by the skin.
  recommendations/        Public recommendation metadata.
  profiles/               Uploaded ReaPrime profile JSON files.
  evidence/               Optional shot-history evidence JSON.

worker/
  src/                    Cloudflare Worker API source.
  test/                   Worker validation, API, ownership, and path-safety tests.
  wrangler.jsonc          Worker deployment configuration.
```

## Community API

The Worker serves the skin-facing API:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/recommendations` | Return the public recommendation index. |
| `POST` | `/api/recommendations` | Create a recommendation, profile JSON, optional evidence, and rebuild the index. |
| `GET` | `/api/recommendations/:id` | Return one public recommendation. |
| `PUT` | `/api/recommendations/:id` | Update an owned recommendation. |
| `DELETE` | `/api/recommendations/:id` | Delete an owned recommendation and its profile/evidence files. |
| `GET` | `/api/download/:id` | Return recommendation metadata plus profile JSON and optional evidence. |

## Development

Worker commands:

```bash
cd worker
npm install
npm test
npm run typecheck
npm run deploy
```

The Worker test suite covers:

- Recommendation creation.
- Profile JSON upload.
- Download payloads.
- Owner-key protected edits.
- Owner-key protected deletes.
- Index rebuilding.
- Validation of required recommendation fields.
- Safe filename handling.
- GitHub path allowlist protection.

## Release Model

The app can bundle WorkFlow Skin directly, and this repository also publishes `workflow-skin.zip` through GitHub Releases for distribution and verification.

Production-style skin release metadata follows ReaPrime's GitHub Release skin deployment shape:

```dart
{
  'type': 'github_release',
  'repo': 'Sabotage1/WorkFlow-Skin',
  'asset': 'workflow-skin.zip',
  'prerelease': false,
}
```

The skin itself no longer contains GitHub update controls. Updates should come from the app bundle or from a curated release/install path outside the open-source skin UI.

## Current Status

WorkFlow Skin v0.2.1 includes community uploads, downloads, uploaded-profile edits and deletes, Review-page sharing, History-page sharing, burr type filtering, grinder search, R2 review support, upload status messages above the recommendation form fields, and the Worker path allowlist that keeps community data separate from skin release files.

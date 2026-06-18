# WorkFlow Skin Community Profiles

This repository hosts the public WorkFlow community profile recommendation registry.

The `Profiles/` directory stores public recommendation metadata, uploaded ReaPrime profile JSON files, optional shot evidence, and a generated index.

The `worker/` directory contains the Cloudflare Worker that validates submissions, writes files to GitHub, rebuilds the index, and serves the skin-facing API.

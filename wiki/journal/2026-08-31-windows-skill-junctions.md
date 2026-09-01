---
date: 2026-08-31
topics: [sitecore-provisioning]
plan: none
pr: pending
---
# Windows skill installs use native directory junctions

## Why

- Git Bash reported a successful `ln -s` on the Windows training machine but produced ordinary copied directories in the Claude and Codex skill locations.
- Those copies stopped receiving repository updates and made the safety check reject every installer re-run as a non-symlink collision.
- Automatically deleting an existing directory was ruled out because it could contain user-owned skill changes.

## What changed

Skill-link creation and removal now run through a small Node helper. It creates a native directory junction on Windows and a directory symlink elsewhere, verifies existing links by real path, reuses a correct link idempotently, and removes only a link that resolves to this repository's skill source.

Ordinary files and directories are still refused without modification. Existing copies therefore require one explicit, recoverable migration before setup is rerun. Tests cover live-link creation, idempotence, collision refusal, foreign-link preservation, and own-link uninstall on the current platform.

## Files

- `setup.sh`
- `scripts/install-skill-link.cjs`
- `test/skill-link-install.test.cjs`
- `README.md`

## Follow-ups

- Move the two verified legacy copies to timestamped backups, rerun setup, and remove those backups only after Claude and Codex both load the junction-backed skill successfully.

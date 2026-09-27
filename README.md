# MC Mod Installer

A [Calagopus Panel](https://calagopus.com) extension that makes installing and managing Minecraft mods
easy. Browse [Modrinth](https://modrinth.com), install mods with one click and manage everything in the
server's `mods` folder, all from the server's **Mods** page.

Package name: `dev.caloptreyx.modinstaller` · Requires panel `>=1.2.2`

## Features

- **Browse** Modrinth mods with search, mod loader and Minecraft version filters, sorting and a
  server-side-only toggle. Filters start at the server's detected mod loader and Minecraft version.
- **Manage installed mods**: every `.jar` in `mods/` is identified on Modrinth by its file hash and
  shown with its icon, name and version. Search the list and filter it by status.
- **Enable or disable** a mod with one switch. Disabled mods are renamed to `<file>.jar.disabled`,
  so the mod loader skips them.
- **Switch the version** of an installed mod. The new file keeps the old file's enabled state, and the
  old file is only removed after the new one has downloaded.
- **Detection badges** show the server's detected mod loader (Fabric, Quilt, Forge, NeoForge) and
  Minecraft version. Hover a badge to see where the value was detected.
- **An alert** appears when the mod loader or Minecraft version can't be detected.
- **Mod Details page** with the full description and a **Versions** tab. The tab lists every version
  in a table and supports search, loader/Minecraft version/channel filters and pagination.
- **Install Mod modal** where you pick the mod loader, Minecraft version and mod version. The choices
  default to the detected mod loader and Minecraft version, and a warning appears when your choice
  doesn't match the server.

## Installation

Download `dev_caloptreyx_modinstaller.c7s.zip` from the
[latest release](https://github.com/Caloptreyx/MC-Mod-Installer-/releases/latest). Then either upload it
under **Admin → Extensions**, or put it in your heavy image's `build/extensions/` directory and run
`docker compose restart web`. Extensions require the `:heavy` panel image (or a dev environment); see the
[Calagopus docs](https://calagopus.com/docs/panel/extensions/installing-extensions).

No configuration is needed. The **Mods** page appears in every server's sidebar. To hide it for
non-Minecraft eggs, use the egg configuration's route order.

## How detection works

The server is inspected in this order, and the first source that finds a value wins:

1. **Server log**: `logs/latest.log`, e.g. `Loading Minecraft 1.21.1 with Fabric Loader`, Forge and
   NeoForge launch arguments, `Starting minecraft server version …`.
2. **Server files**: loader libraries (`libraries/net/fabricmc`, `net/minecraftforge/forge`,
   `net/neoforged`, `org/quiltmc`), launcher jars and `versions/<version>`.
3. **Startup variables**: e.g. `MINECRAFT_VERSION`, `MC_VERSION`, `FORGE_VERSION`, `NEOFORGE_VERSION`.
4. **Egg**: the egg, nest, startup command or Docker image name mentions a loader.

Start the server once if something isn't detected. You can always pick the loader and version
yourself in the Install Mod modal.

## Permissions

The extension uses the panel's existing file permissions:

| Action | Permission |
| --- | --- |
| View the Mods pages | `files.read` (`files.read-content` is also needed to identify mods and read the log) |
| Install a mod | `files.create` |
| Enable / disable a mod | `files.update` |
| Switch a mod's version | `files.create` and `files.delete` |
| Delete a mod | `files.delete` |

Installs, renames and deletions go through the panel's own file endpoints, so they respect subuser
ignored files and appear in the server's activity log.

## Development

This repository uses the extension's development layout (`Cargo.toml`, `Metadata.toml`, `src/`,
`frontend/`). Symlink it into a panel checkout as `backend-extensions/dev_caloptreyx_modinstaller`, then
run from the panel root:

```bash
SQLX_OFFLINE=true cargo clippy -p dev_caloptreyx_modinstaller --all-targets
SQLX_OFFLINE=true cargo test -p dev_caloptreyx_modinstaller
cd frontend && ./node_modules/.bin/tsc && ./node_modules/.bin/biome check extensions/dev_caloptreyx_modinstaller/src && cd ..
SQLX_OFFLINE=true panel-rs extensions export dev.caloptreyx.modinstaller   # -> exported-extensions/
```

- Backend (`src/`): `GET /api/client/servers/{server}/mod-installer/environment` (detection) and
  `GET /api/client/servers/{server}/mod-installer/mods` (the `mods/` listing with SHA-1 fingerprints).
  Detection is the pure, unit-tested `src/detect.rs`.
- Frontend (`frontend/src/`): talks to the Modrinth API directly from the browser. Installs use the
  panel's file pull endpoint; enabling, disabling and deleting use its rename and delete endpoints.

## License

[MIT](LICENSE)

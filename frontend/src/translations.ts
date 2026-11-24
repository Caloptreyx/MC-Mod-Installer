import { defineTranslations } from 'shared';

// Values from mod authors (titles, versions, file names) are interpolated into plain text only,
// never into strings rendered as Markdown.
const translations = defineTranslations({
  items: {},
  translations: {
    pages: {
      admin: {
        modinstaller: {
          description:
            'Mods from Modrinth are always available. To also offer CurseForge mods, enter a CurseForge API key from the CurseForge for Studios console. The key is stored encrypted and never sent to users.',
          console: 'Open the CurseForge for Studios console',
          enabled: 'Enabled',
          notConfigured: 'Not configured',
          apiKey: 'API key',
          replaceKey: 'Replace API key',
          keepPlaceholder: 'Leave empty to keep the stored key',
          pastePlaceholder: 'Paste your CurseForge API key',
          save: 'Save',
          testKey: 'Test this key',
          testStoredKey: 'Test stored key',
          remove: 'Remove key',
          toast: {
            verified: 'CurseForge accepted the API key.',
            saved: 'CurseForge API key saved.',
            removed: 'CurseForge API key removed.',
          },
        },
      },
      server: {
        mods: {
          title: 'Mods',
          manualDownload: 'Manual download',
          tabs: {
            installed: 'Installed',
            browse: 'Browse',
          },
          environment: {
            title: 'Server software',
            software: 'Software',
            minecraftVersion: 'Minecraft version',
            loaderVersion: 'Loader / build version',
            loaderVersionShort: 'version {version}',
            unknownLoader: 'Unknown software',
            unknownVersion: 'Unknown version',
            minecraft: 'Minecraft {version}',
            detectedFrom: 'Detected from {source}. Click for details.',
            notDetected: 'Not detected',
            evidence: 'Everything that was found',
            noEvidence: 'Nothing on the server names its software yet.',
            conflictsTitle: 'Disagreeing hints',
            conflicts:
              'Some files on the server point to different software or versions, for example leftovers of an earlier loader. Check them or set the software manually.',
            logStale:
              'The server log is older than the last install, so it was not trusted. Start the server once to refresh it.',
            source: {
              override: 'Manual override',
              args: 'Launch arguments',
              log: 'Server log',
              version_history: 'version_history.json',
              marker: 'Install marker',
              files: 'Server files',
              variables: 'Startup variables',
              egg: 'Egg',
            },
            confidence: {
              high: 'Sure',
              medium: 'Likely',
              low: 'Guess',
            },
            note: {
              stale: 'Older than the install',
              superseded: 'Replaced by newer files',
              invalid: 'Could not be read',
            },
            eggField: {
              egg: 'Egg name',
              nest: 'Nest name',
              startup: 'Startup command',
              image: 'Docker image',
            },
            override: {
              set: 'Set manually…',
              clear: 'Clear override',
              description:
                'The override is saved as .mc-mod-installer.json in the server root and wins over everything that is detected. Clear it after changing the server software.',
              saved: 'Server software set manually.',
              cleared: 'Manual override cleared.',
              disagrees:
                'The manual override disagrees with files on the server. If the server software changed, clear or update the override.',
            },
            alert: {
              title: {
                loader: 'Mod loader could not be detected',
                version: 'Minecraft version could not be detected',
                both: 'Mod loader and Minecraft version could not be detected',
              },
              content:
                'Start the server at least once so it can be identified, or set the software manually in the server software panel. Until then, choose the mod loader and Minecraft version yourself when installing mods.',
            },
          },
          notModded: {
            title: "This server doesn't run a mod loader",
            notMinecraftTitle: "This doesn't look like a Minecraft server",
            description:
              'It runs {software}, which loads plugins or nothing at all instead of mods. If that is wrong, set the server software manually.',
            notMinecraft:
              'Nothing on the server points to Minecraft. If it is a Minecraft server, set the server software manually.',
            details: 'Server software',
          },
          loaders: {
            any: 'Any loader',
            server: 'This server ({loaders})',
          },
          gameVersions: {
            any: 'Any version',
          },
          channel: {
            release: 'Release',
            beta: 'Beta',
            alpha: 'Alpha',
          },
          button: {
            install: 'Install',
            installed: 'Installed',
            switchVersion: 'Switch Version',
            update: 'Update to {version}',
            viewDetails: 'View Details',
            enable: 'Enable',
            disable: 'Disable',
            delete: 'Delete',
            refresh: 'Refresh',
            browse: 'Browse Mods',
            back: 'Back',
            openModrinth: 'Open on Modrinth',
            openCurseforge: 'Open on CurseForge',
          },
          toast: {
            installed: '{mod} {version} installed. Restart the server to load it.',
            switched: '{mod} switched to {version}. Restart the server to apply the change.',
            enabled: '{mod} enabled. Restart the server to apply the change.',
            disabled: '{mod} disabled. Restart the server to apply the change.',
            deleted: '{mod} deleted. Restart the server to apply the change.',
          },
          errors: {
            pullLimited:
              'The panel allows only a few downloads per minute for each server. Try again in {seconds} seconds.',
            notRenamed: 'The panel did not rename {file}. It may be hidden from you or already gone.',
            notDeleted: 'The panel did not delete {file}. It may be hidden from you or already gone.',
            hashMismatch: 'The downloaded file {file} does not match the published hash, so it was removed.',
            backupKept:
              'The new file failed and the previous version could not be restored. It is kept as {file}; rename it back to {original}.',
            oldKept:
              'The new version is installed, but the old file {file} could not be deleted. Delete it, two copies stop the mod loader.',
            exists: 'A file named {file} already exists in the mods folder.',
            noJar: 'Version {version} has no mod jar to install.',
            notDownloadable: 'Version {version} can only be downloaded from the website of its source.',
            cannotVerify: 'CurseForge gives no hash for this file, so an upload cannot be checked.',
            notTheFile:
              "This isn't the file from CurseForge. Download the file shown on the CurseForge page and try again.",
          },
          issues: {
            short: {
              duplicate: 'Duplicate',
              loader: 'Wrong loader',
              gameVersion: 'Other Minecraft version',
              clientOnly: 'Client-only',
              missingDependency: 'Missing dependency',
              incompatible: 'Incompatible',
            },
            clientOnlyShort: 'Client-only',
            duplicate: 'This mod is also installed as {files}. Two copies stop the mod loader; keep one.',
            loader: "This file is made for another mod loader than the server's.",
            gameVersion: "This file doesn't list the server's Minecraft version.",
            clientOnly: "This mod only works on players' game clients; servers don't need it.",
            missingDependency: 'Requires {mods}, which is not installed.',
            incompatible: 'Does not work together with {mods}, which is installed.',
          },
          pack: {
            unnamed: 'modpack',
            fromPack: 'From pack {pack}',
            banner:
              'This server runs the modpack {pack}. Mods marked "From pack" belong to it; updating or removing them can break the pack.',
            bannerNoFiles:
              'This server runs the modpack {pack}. Updating or removing single mods can break the pack; update the pack instead.',
            warning: 'This mod belongs to {pack}; changing it can break the pack.',
            confirm: 'I understand that {mod} belongs to {pack} and changing it can break the pack.',
          },
          updateAll: {
            button: 'Update all ({count})',
            title: 'Update mods',
            description:
              'These mods have a newer release for this server. They are updated one at a time; the panel allows only a few downloads per minute, so this can take a while.',
            packMod: 'Belongs to the modpack',
            submit: 'Update {count} mods',
            progress: 'Updating {mod} ({done} of {total} done)…',
            done: '{done} of {total} mods updated. Restart the server to apply the changes.',
          },
          browse: {
            searchPlaceholder: 'Search mods on Modrinth...',
            searchPlaceholderCurseforge: 'Search mods on CurseForge...',
            loader: 'Mod loader',
            gameVersion: 'Minecraft version',
            category: 'Category',
            anyCategory: 'Any category',
            sort: 'Sort by',
            serverSideOnly: 'Server-side mods only',
            serverSideOnlyDescription: 'Hide mods that only run on the client.',
            sortOptions: {
              relevance: 'Relevance',
              downloads: 'Downloads',
              follows: 'Followers',
              newest: 'Newest',
              updated: 'Recently updated',
            },
            by: 'by {author}',
            downloads: '{count} downloads',
            followers: '{count} followers',
            updated: 'Updated',
            empty: {
              title: 'No mods found',
              description: 'Try a different search term or loosen the filters.',
            },
          },
          installed: {
            searchPlaceholder: 'Search installed mods...',
            actions: 'Actions',
            filter: {
              all: 'All',
              enabled: 'Enabled',
              disabled: 'Disabled',
              updates: 'Updates',
              issues: 'Problems',
            },
            summary: '{total} installed · {enabled} enabled · {disabled} disabled',
            unknownVersion: 'Unknown',
            unknown: 'Not found on Modrinth or CurseForge',
            tooLarge: 'Too large to identify',
            identifying: 'Identifying mods...',
            checkingUpdates: 'Checking for updates...',
            identifyFailed: 'Mods could not be identified: {error}',
            columns: {
              mod: 'Mod',
              version: 'Version',
              file: 'File',
              size: 'Size',
              enabled: 'Enabled',
            },
            empty: {
              title: 'No mods installed',
              description: 'Mods you install will show up here. Browse Modrinth or CurseForge to find some.',
            },
            noMatches: 'No installed mods match your search.',
            modal: {
              delete: {
                title: 'Delete Mod',
                content: 'Are you sure you want to delete {mod}? The file {file} will be removed.',
              },
              update: {
                title: 'Update Mod',
                content: 'Update {mod} from {from} to {to}? The old file is kept until the new one is checked.',
              },
            },
          },
          details: {
            tabs: {
              description: 'Description',
              versions: 'Versions',
            },
            installedVersion: 'Installed: {version}',
            installedDisabled: 'Installed (disabled): {version}',
            notFound: 'This mod could not be loaded.',
            stats: {
              downloads: 'Downloads',
              followers: 'Followers',
              likes: 'Likes',
              updated: 'Updated',
              license: 'License',
            },
            links: {
              website: 'Website',
              source: 'Source',
              issues: 'Issues',
              wiki: 'Wiki',
              discord: 'Discord',
            },
            versions: {
              search: 'Search',
              searchPlaceholder: 'Version name or number',
              loader: 'Loader',
              gameVersion: 'Minecraft version',
              channel: 'Channel',
              allChannels: 'All channels',
              columns: {
                version: 'Version',
                channel: 'Channel',
                loaders: 'Loaders',
                gameVersions: 'Minecraft',
                published: 'Published',
                downloads: 'Downloads',
              },
              current: 'Current',
              empty: 'No versions match these filters.',
            },
          },
          installModal: {
            title: 'Install {mod}',
            switchTitle: 'Switch Version of {mod}',
            loader: 'Mod loader',
            gameVersion: 'Minecraft version',
            version: 'Mod version',
            showPreReleases: 'Show beta and alpha versions',
            noVersions: 'This mod has no versions for the selected mod loader and Minecraft version.',
            noJar: 'This version has no mod jar that can be installed.',
            file: 'File',
            detectedHint: 'Detected: {value}',
            currentVersion: 'Currently installed: {version}. It will be replaced by the selected version.',
            alreadyInstalled: 'This version is already installed.',
            loaderMismatch: 'This version is made for {selected}, but the server loads {detected} mods.',
            gameVersionMismatch: 'This version is made for Minecraft {selected}, but the server runs {detected}.',
            overridePlatform: 'Install anyway, the server really runs this',
            blockedPlatform: 'Installing is blocked because the version does not fit the server.',
            notDetected:
              'The mod loader or Minecraft version of your server could not be detected. Make sure the selection matches your server.',
            waiting: 'Waiting {seconds} seconds for the download limit before installing {mod}…',
            submit: 'Install',
            submitSwitch: 'Switch Version',
            dependencies: {
              title: 'Required mods, installed together with this one',
              installed: 'Already installed',
              noVersion: 'No version for this server',
              manual: 'Manual download',
              installing: 'Installing {mod}…',
              incompatible: 'This version does not work together with {mods}, which is installed.',
            },
            manual: {
              description:
                "The author only offers this file on CurseForge's website, so it can't be downloaded here directly.",
              fromModrinth: 'Install the identical file from Modrinth',
              open: 'Open on CurseForge',
              upload: 'Upload the .jar',
            },
          },
        },
      },
    },
  },
});

export const useExtTranslations = translations.useTranslations.bind(translations);
export const getExtTranslations = translations.getTranslations.bind(translations);

export default translations;

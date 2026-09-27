import { defineTranslations } from 'shared';

const translations = defineTranslations({
  items: {},
  translations: {
    pages: {
      server: {
        mods: {
          title: 'Mods',
          tabs: {
            installed: 'Installed',
            browse: 'Browse',
          },
          environment: {
            unknownLoader: 'Unknown loader',
            unknownVersion: 'Unknown version',
            minecraft: 'Minecraft {version}',
            detectedFrom: 'Detected from {source}.',
            notDetected: 'Could not be detected.',
            source: {
              log: 'the server log (logs/latest.log)',
              files: 'the server files',
              variables: 'the startup variables',
              egg: 'the server egg',
            },
            alert: {
              title: {
                loader: 'Mod loader could not be detected',
                version: 'Minecraft version could not be detected',
                both: 'Mod loader and Minecraft version could not be detected',
              },
              content:
                'Start the server at least once so it can be identified. Until then, choose the mod loader and Minecraft version yourself when installing mods.',
            },
          },
          loaders: {
            any: 'Any loader',
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
            viewDetails: 'View Details',
            enable: 'Enable',
            disable: 'Disable',
            delete: 'Delete',
            refresh: 'Refresh',
            browse: 'Browse Mods',
            back: 'Back',
            openModrinth: 'Open on Modrinth',
          },
          toast: {
            installed: '{mod} {version} installed. Restart the server to load it.',
            switched: '{mod} switched to {version}. Restart the server to apply the change.',
            enabled: '{mod} enabled. Restart the server to apply the change.',
            disabled: '{mod} disabled. Restart the server to apply the change.',
            deleted: '{mod} deleted. Restart the server to apply the change.',
          },
          browse: {
            searchPlaceholder: 'Search mods on Modrinth...',
            loader: 'Mod loader',
            gameVersion: 'Minecraft version',
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
            filter: {
              all: 'All',
              enabled: 'Enabled',
              disabled: 'Disabled',
            },
            summary: '{total} installed · {enabled} enabled · {disabled} disabled',
            unknownVersion: 'Unknown',
            notOnModrinth: 'Not found on Modrinth',
            identifying: 'Identifying mods on Modrinth...',
            identifyFailed: 'Mods could not be matched to Modrinth: {error}',
            columns: {
              mod: 'Mod',
              version: 'Version',
              file: 'File',
              size: 'Size',
              enabled: 'Enabled',
            },
            empty: {
              title: 'No mods installed',
              description: 'Mods you install will show up here. Browse Modrinth to find some.',
            },
            noMatches: 'No installed mods match your search.',
            modal: {
              delete: {
                title: 'Delete Mod',
                content: 'Are you sure you want to delete **{mod}**? The file `{file}` will be permanently removed.',
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
            notFound: 'This mod could not be loaded from Modrinth.',
            stats: {
              downloads: 'Downloads',
              followers: 'Followers',
              updated: 'Updated',
              license: 'License',
            },
            links: {
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
            noVersions: 'This mod has no versions for the selected mod loader and Minecraft version.',
            file: 'File',
            detectedHint: 'Detected: {value}',
            currentVersion: 'Currently installed: **{version}**. It will be replaced by the selected version.',
            alreadyInstalled: 'This version is already installed.',
            loaderMismatch: 'This version is made for {selected}, but your server runs {detected}.',
            gameVersionMismatch: 'This version is made for Minecraft {selected}, but your server runs {detected}.',
            notDetected:
              'The mod loader or Minecraft version of your server could not be detected. Make sure the selection matches your server.',
            submit: 'Install',
            submitSwitch: 'Switch Version',
          },
        },
      },
    },
  },
});

export const useExtTranslations = translations.useTranslations.bind(translations);
export const getExtTranslations = translations.getTranslations.bind(translations);

export default translations;

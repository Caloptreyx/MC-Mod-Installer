import { faCubes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Extension, ExtensionContext } from 'shared';
import BrowseModsPage from './pages/browse/BrowseModsPage.tsx';
import ModDetailsPage from './pages/details/ModDetailsPage.tsx';
import InstalledModsPage from './pages/installed/InstalledModsPage.tsx';
import { getExtTranslations } from './translations.ts';

class CaloptreyxModInstallerExtension extends Extension {
  public cardConfigurationPage: React.FC | null = null;
  public cardIcon: React.ReactNode = <FontAwesomeIcon icon={faCubes} />;

  public initialize(ctx: ExtensionContext): void {
    ctx.extensionRegistry.enterRoutes((routes) =>
      routes
        .addServerRoute({
          name: () => getExtTranslations().t('pages.server.mods.title', {}),
          icon: faCubes,
          path: '/mods',
          element: InstalledModsPage,
          permission: 'files.read',
        })
        .addServerRoute({
          name: undefined,
          path: '/mods/browse',
          element: BrowseModsPage,
          permission: 'files.read',
        })
        .addServerRoute({
          name: undefined,
          path: '/mods/project/:projectId',
          element: ModDetailsPage,
          permission: 'files.read',
        }),
    );
  }
}

export default new CaloptreyxModInstallerExtension();

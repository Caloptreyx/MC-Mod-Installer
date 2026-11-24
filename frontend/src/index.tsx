import { faCubes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Extension, ExtensionContext } from 'shared';
import AdminConfigPage from './pages/admin/AdminConfigPage.tsx';
import BrowseModsPage from './pages/browse/BrowseModsPage.tsx';
import { CurseforgeDetailsPage, ModrinthDetailsPage } from './pages/details/ModDetailsPage.tsx';
import InstalledModsPage from './pages/installed/InstalledModsPage.tsx';
import { getExtTranslations } from './translations.ts';

class CaloptreyxModInstallerExtension extends Extension {
  public cardConfigurationPage: React.FC | null = AdminConfigPage;
  public cardIcon = <FontAwesomeIcon icon={faCubes} />;

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
          element: ModrinthDetailsPage,
          permission: 'files.read',
        })
        .addServerRoute({
          name: undefined,
          path: '/mods/curseforge/:projectId',
          element: CurseforgeDetailsPage,
          permission: 'files.read',
        }),
    );

    ctx.extensionRegistry.enterPermissionIcons((icons) =>
      icons.addAdminPermissionIcon('modinstaller', <FontAwesomeIcon icon={faCubes} />),
    );
  }
}

export default new CaloptreyxModInstallerExtension();

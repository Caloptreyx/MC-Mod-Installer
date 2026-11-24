import {
  faArrowUp,
  faArrowUpRightFromSquare,
  faEllipsis,
  faRightLeft,
  faToggleOff,
  faToggleOn,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import ActionIcon from '@/elements/ActionIcon.tsx';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import { TableData, TableRow } from '@/elements/data-display/Table.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Switch from '@/elements/input/Switch.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import ContextMenu, { ContextMenuToggle } from '@/elements/overlays/ContextMenu.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { bytesToString } from '@/lib/format/size.ts';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import type { InstalledMod } from '../../hooks/useInstalledMods.ts';
import type { ModIssue } from '../../lib/issues.ts';
import type { PackMarker } from '../../lib/schemas.ts';
import ChannelBadge from '../../components/ChannelBadge.tsx';
import InstallModModal from '../../components/InstallModModal.tsx';
import { modInstallerQueryKey, projectPath } from '../../lib/constants.ts';
import { stripJarExtension } from '../../lib/files.ts';
import { canDownload, deleteMod, installVersion, setModEnabled } from '../../lib/modActions.ts';
import { useExtTranslations } from '../../translations.ts';

/** Display name of a mod: its project title, else the file name without extensions. */
export const modDisplayName = (mod: InstalledMod) => mod.project?.title ?? stripJarExtension(mod.fileName);

const ISSUE_COLORS: Record<ModIssue['kind'], string> = {
  duplicate: 'red',
  loader: 'red',
  gameVersion: 'orange',
  clientOnly: 'gray',
  missingDependency: 'red',
  incompatible: 'red',
};

function IssueBadges({ mod, packName }: { mod: InstalledMod; packName: string }) {
  const { t: tExt } = useExtTranslations();

  const details = (issue: ModIssue) => {
    switch (issue.kind) {
      case 'duplicate':
        return tExt('pages.server.mods.issues.duplicate', { files: issue.files.join(', ') });
      case 'loader':
        return tExt('pages.server.mods.issues.loader', {});
      case 'gameVersion':
        return tExt('pages.server.mods.issues.gameVersion', {});
      case 'clientOnly':
        return tExt('pages.server.mods.issues.clientOnly', {});
      case 'missingDependency':
        return tExt('pages.server.mods.issues.missingDependency', { mods: issue.names.join(', ') });
      case 'incompatible':
        return tExt('pages.server.mods.issues.incompatible', { mods: issue.names.join(', ') });
    }
  };

  if (!mod.source && !mod.fromPack && mod.issues.length === 0) return null;

  return (
    <Group gap={4} wrap='wrap'>
      {mod.source && (
        <Badge variant='default' size='xs'>
          {mod.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
        </Badge>
      )}
      {mod.fromPack && (
        <Badge variant='light' color='violet' size='xs'>
          {tExt('pages.server.mods.pack.fromPack', { pack: packName })}
        </Badge>
      )}
      {mod.issues.map((issue) => (
        <Tooltip key={issue.kind} label={details(issue)} multiline maw={320}>
          <Badge variant='light' color={ISSUE_COLORS[issue.kind]} size='xs'>
            {tExt(`pages.server.mods.issues.short.${issue.kind}`, {})}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}

export default function InstalledModRow({
  mod,
  identifying,
  layout,
  pack,
  fileNames,
}: {
  mod: InstalledMod;
  identifying: boolean;
  layout: 'row' | 'card';
  pack: PackMarker | null;
  fileNames: ReadonlySet<string>;
}) {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const server = useServerStore((state) => state.server);

  const canUpdate = useServerCan('files.update');
  const canSwitch = useServerCan(['files.create', 'files.delete'], false);
  const canDelete = useServerCan('files.delete');

  const [openModal, setOpenModal] = useState<'switch' | 'delete' | 'update' | 'manualUpdate' | null>(null);
  const [toggling, setToggling] = useState(false);

  const name = modDisplayName(mod);
  const packName =
    [pack?.name, pack?.versionName].filter(Boolean).join(' ') || tExt('pages.server.mods.pack.unnamed', {});
  const refresh = () => queryClient.invalidateQueries({ queryKey: modInstallerQueryKey('mods', server.uuid) });
  // Updates CurseForge only offers on its website go through the install dialog's manual download.
  const openUpdate = () => setOpenModal(mod.update && canDownload(mod.update) ? 'update' : 'manualUpdate');

  const doToggle = (enabled: boolean) => {
    setToggling(true);
    setModEnabled(server.uuid, mod, enabled, fileNames)
      .then(() => {
        addToast(
          enabled
            ? tExt('pages.server.mods.toast.enabled', { mod: name })
            : tExt('pages.server.mods.toast.disabled', { mod: name }),
          'success',
        );
      })
      .catch((error) => addToast(httpErrorToHuman(error), 'error'))
      .finally(() => {
        setToggling(false);
        refresh();
      });
  };

  // Failures stay in the dialog: they may name a file left behind in mods/.
  const [failure, setFailure] = useState<string | null>(null);
  const closeModal = () => {
    setFailure(null);
    setOpenModal(null);
  };

  const doDelete = async () => {
    setFailure(null);
    try {
      await deleteMod(server.uuid, mod);
      addToast(tExt('pages.server.mods.toast.deleted', { mod: name }), 'success');
      closeModal();
    } catch (error) {
      setFailure(httpErrorToHuman(error));
    } finally {
      refresh();
    }
  };

  const doUpdate = async () => {
    if (!mod.update) return;
    setFailure(null);
    try {
      await installVersion(server.uuid, mod.update, { replacing: mod, existing: fileNames });
      addToast(tExt('pages.server.mods.toast.switched', { mod: name, version: mod.update.versionNumber }), 'success');
      closeModal();
    } catch (error) {
      setFailure(httpErrorToHuman(error));
    } finally {
      refresh();
    }
  };

  const failureAlert = failure && (
    <Alert color='red' mt='sm'>
      {failure}
    </Alert>
  );

  const items = [
    {
      type: 'action' as const,
      icon: faArrowUpRightFromSquare,
      label: tExt('pages.server.mods.button.viewDetails', {}),
      onClick: () => {
        if (mod.project && mod.source) {
          navigate(
            projectPath(server.uuidShort, mod.source, mod.source === 'modrinth' ? mod.project.slug : mod.project.id),
          );
        }
      },
      color: 'gray' as const,
      hidden: !mod.project,
    },
    {
      type: 'action' as const,
      icon: faArrowUp,
      label: mod.update ? tExt('pages.server.mods.button.update', { version: mod.update.versionNumber }) : '',
      onClick: openUpdate,
      color: 'gray' as const,
      hidden: !mod.update,
      canAccess: canSwitch,
    },
    {
      type: 'action' as const,
      icon: faRightLeft,
      label: tExt('pages.server.mods.button.switchVersion', {}),
      onClick: () => setOpenModal('switch'),
      color: 'gray' as const,
      hidden: !mod.project,
      canAccess: canSwitch,
    },
    {
      type: 'action' as const,
      icon: mod.enabled ? faToggleOff : faToggleOn,
      label: mod.enabled ? tExt('pages.server.mods.button.disable', {}) : tExt('pages.server.mods.button.enable', {}),
      onClick: () => doToggle(!mod.enabled),
      color: 'gray' as const,
      canAccess: canUpdate,
    },
    {
      type: 'action' as const,
      icon: faTrash,
      label: tExt('pages.server.mods.button.delete', {}),
      onClick: () => setOpenModal('delete'),
      color: 'red' as const,
      canAccess: canDelete,
    },
  ];

  const packWarning = mod.fromPack && (
    <Text size='sm' c='orange' mt='xs'>
      {tExt('pages.server.mods.pack.warning', { pack: packName })}
    </Text>
  );

  const modals = (
    <>
      {mod.project && mod.source && (
        <InstallModModal
          opened={openModal === 'switch' || openModal === 'manualUpdate'}
          onClose={() => setOpenModal(null)}
          project={{
            source: mod.source,
            id: mod.project.id,
            slug: mod.project.slug,
            title: mod.project.title,
            iconUrl: mod.project.iconUrl,
          }}
          installed={mod}
          initialVersionId={openModal === 'manualUpdate' ? (mod.update?.id ?? null) : null}
        />
      )}
      <ConfirmationModal
        opened={openModal === 'update'}
        onClose={closeModal}
        title={tExt('pages.server.mods.installed.modal.update.title', {})}
        confirm={tExt('pages.server.mods.button.update', { version: mod.update?.versionNumber ?? '' })}
        confirmColor='blue'
        onConfirmed={doUpdate}
      >
        <Text>
          {tExt('pages.server.mods.installed.modal.update.content', {
            mod: name,
            from: mod.version?.versionNumber ?? mod.fileName,
            to: mod.update?.versionNumber ?? '',
          })}
        </Text>
        {packWarning}
        {failureAlert}
      </ConfirmationModal>
      <ConfirmationModal
        opened={openModal === 'delete'}
        onClose={closeModal}
        title={tExt('pages.server.mods.installed.modal.delete.title', {})}
        confirm={tExt('pages.server.mods.button.delete', {})}
        onConfirmed={doDelete}
      >
        <Text>{tExt('pages.server.mods.installed.modal.delete.content', { mod: name, file: mod.fileName })}</Text>
        {packWarning}
        {failureAlert}
      </ConfirmationModal>
    </>
  );

  const enabledSwitch = (
    <Switch
      checked={mod.enabled}
      disabled={!canUpdate || toggling}
      onChange={(event) => doToggle(event.currentTarget.checked)}
      aria-label={
        mod.enabled ? tExt('pages.server.mods.button.disable', {}) : tExt('pages.server.mods.button.enable', {})
      }
    />
  );

  const versionLabel = mod.version ? (
    <Group gap='xs' wrap='nowrap'>
      <Code>{mod.version.versionNumber}</Code>
      {mod.version.channel !== 'release' && <ChannelBadge channel={mod.version.channel} />}
    </Group>
  ) : (
    <Text size='sm' c='dimmed'>
      {tExt('pages.server.mods.installed.unknownVersion', {})}
    </Text>
  );

  const updateButton = mod.update && canSwitch && (
    <Button
      size='compact-xs'
      variant='light'
      leftSection={<FontAwesomeIcon icon={faArrowUp} />}
      onClick={(event) => {
        event.stopPropagation();
        openUpdate();
      }}
    >
      {tExt('pages.server.mods.button.update', { version: mod.update.versionNumber })}
    </Button>
  );

  const subtitle = mod.project ? (
    <Text size='xs' c='dimmed' truncate maw={layout === 'row' ? 320 : undefined}>
      {mod.project.description}
    </Text>
  ) : (
    !identifying && (
      <Text size='xs' c='dimmed'>
        {mod.tooLarge
          ? tExt('pages.server.mods.installed.tooLarge', {})
          : tExt('pages.server.mods.installed.unknown', {})}
      </Text>
    )
  );

  return (
    <>
      {modals}
      <ContextMenu items={items}>
        {({ items: menuItems, openMenu }) =>
          layout === 'card' ? (
            <Card
              p='sm'
              style={{ opacity: mod.enabled ? 1 : 0.6 }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(event.clientX, event.clientY);
              }}
            >
              <Stack gap={6}>
                <Group gap='sm' wrap='nowrap' align='flex-start'>
                  <Avatar src={mod.project?.iconUrl ?? null} name={name} radius='md' size='md' />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={600} truncate>
                      {name}
                    </Text>
                    <Text size='xs' c='dimmed' truncate>
                      {mod.fileName} · {bytesToString(mod.size)}
                    </Text>
                  </div>
                  {enabledSwitch}
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    aria-label={tExt('pages.server.mods.installed.actions', {})}
                    onClick={(event) => openMenu(event.clientX, event.clientY)}
                  >
                    <FontAwesomeIcon icon={faEllipsis} />
                  </ActionIcon>
                </Group>
                <Group gap='xs' wrap='wrap'>
                  {versionLabel}
                  {updateButton}
                </Group>
                <IssueBadges mod={mod} packName={packName} />
              </Stack>
            </Card>
          ) : (
            <TableRow
              style={{ opacity: mod.enabled ? 1 : 0.6 }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(event.clientX, event.clientY);
              }}
            >
              <TableData>
                <Group gap='sm' wrap='nowrap'>
                  <Avatar src={mod.project?.iconUrl ?? null} name={name} radius='md' size='md' />
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text fw={600} truncate maw={320}>
                      {name}
                    </Text>
                    {subtitle}
                    {/* File and size live here so the switch and menu fit next to the table on laptops. */}
                    <Text size='xs' c='dimmed' truncate maw={320}>
                      {mod.fileName} · {bytesToString(mod.size)}
                    </Text>
                    <IssueBadges mod={mod} packName={packName} />
                  </Stack>
                </Group>
              </TableData>

              <TableData>
                <Stack gap={4}>
                  {versionLabel}
                  {updateButton}
                </Stack>
              </TableData>

              <TableData>{enabledSwitch}</TableData>

              <ContextMenuToggle items={menuItems} openMenu={openMenu} />
            </TableRow>
          )
        }
      </ContextMenu>
    </>
  );
}

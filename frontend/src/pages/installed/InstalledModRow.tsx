import {
  faArrowUpRightFromSquare,
  faRightLeft,
  faToggleOff,
  faToggleOn,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import deleteFiles from '@/api/server/files/deleteFiles.ts';
import Avatar from '@/elements/data-display/Avatar.tsx';
import { TableData, TableRow } from '@/elements/data-display/Table.tsx';
import Switch from '@/elements/input/Switch.tsx';
import Group from '@/elements/layout/Group.tsx';
import ConfirmationModal from '@/elements/modals/ConfirmationModal.tsx';
import ContextMenu, { ContextMenuToggle } from '@/elements/overlays/ContextMenu.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { bytesToString } from '@/lib/format/size.ts';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import ChannelBadge from '../../components/ChannelBadge.tsx';
import InstallModModal from '../../components/InstallModModal.tsx';
import type { InstalledMod } from '../../hooks/useInstalledMods.ts';
import { MODS_ROOT, serverModsPath } from '../../lib/constants.ts';
import { setModEnabled } from '../../lib/modActions.ts';
import { useExtTranslations } from '../../translations.ts';

/** Display name of a mod: its Modrinth title, else the file name without extensions. */
export const modDisplayName = (mod: InstalledMod) =>
  mod.project?.title ?? mod.fileName.replace(/\.jar(\.disabled)?$/i, '');

export default function InstalledModRow({
  mod,
  identifying,
  onChanged,
}: {
  mod: InstalledMod;
  identifying: boolean;
  onChanged: () => void;
}) {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const server = useServerStore((state) => state.server);

  const canUpdate = useServerCan('files.update');
  const canSwitch = useServerCan(['files.create', 'files.delete'], false);
  const canDelete = useServerCan('files.delete');

  const [openModal, setOpenModal] = useState<'switch' | 'delete' | null>(null);
  const [toggling, setToggling] = useState(false);

  const name = modDisplayName(mod);

  const doToggle = (enabled: boolean) => {
    setToggling(true);
    setModEnabled(server.uuid, mod, enabled)
      .then(() => {
        addToast(
          enabled
            ? tExt('pages.server.mods.toast.enabled', { mod: name })
            : tExt('pages.server.mods.toast.disabled', { mod: name }),
          'success',
        );
        onChanged();
      })
      .catch((error) => addToast(httpErrorToHuman(error), 'error'))
      .finally(() => setToggling(false));
  };

  const doDelete = async () => {
    await deleteFiles(server.uuid, MODS_ROOT, [mod.fileName]);
    addToast(tExt('pages.server.mods.toast.deleted', { mod: name }), 'success');
    setOpenModal(null);
    onChanged();
  };

  return (
    <>
      {mod.project && (
        <InstallModModal
          opened={openModal === 'switch'}
          onClose={() => setOpenModal(null)}
          project={{ id: mod.project.id, title: mod.project.title, iconUrl: mod.project.icon_url }}
          installed={mod}
        />
      )}
      <ConfirmationModal
        opened={openModal === 'delete'}
        onClose={() => setOpenModal(null)}
        title={tExt('pages.server.mods.installed.modal.delete.title', {})}
        confirm={tExt('pages.server.mods.button.delete', {})}
        onConfirmed={doDelete}
      >
        {tExt('pages.server.mods.installed.modal.delete.content', { mod: name, file: mod.fileName }).md()}
      </ConfirmationModal>

      <ContextMenu
        items={[
          {
            type: 'action',
            icon: faArrowUpRightFromSquare,
            label: tExt('pages.server.mods.button.viewDetails', {}),
            onClick: () => mod.project && navigate(serverModsPath(server.uuidShort, `/project/${mod.project.slug}`)),
            color: 'gray',
            hidden: !mod.project,
          },
          {
            type: 'action',
            icon: faRightLeft,
            label: tExt('pages.server.mods.button.switchVersion', {}),
            onClick: () => setOpenModal('switch'),
            color: 'gray',
            hidden: !mod.project,
            canAccess: canSwitch,
          },
          {
            type: 'action',
            icon: mod.enabled ? faToggleOff : faToggleOn,
            label: mod.enabled
              ? tExt('pages.server.mods.button.disable', {})
              : tExt('pages.server.mods.button.enable', {}),
            onClick: () => doToggle(!mod.enabled),
            color: 'gray',
            canAccess: canUpdate,
          },
          {
            type: 'action',
            icon: faTrash,
            label: tExt('pages.server.mods.button.delete', {}),
            onClick: () => setOpenModal('delete'),
            color: 'red',
            canAccess: canDelete,
          },
        ]}
      >
        {({ items, openMenu }) => (
          <TableRow
            style={{ opacity: mod.enabled ? 1 : 0.6 }}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(event.clientX, event.clientY);
            }}
          >
            <TableData>
              <Group gap='sm' wrap='nowrap'>
                <Avatar src={mod.project?.icon_url ?? null} name={name} radius='md' size='md' />
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate maw={320}>
                    {name}
                  </Text>
                  {mod.project ? (
                    <Text size='xs' c='dimmed' truncate maw={320}>
                      {mod.project.description}
                    </Text>
                  ) : (
                    !identifying && (
                      <Text size='xs' c='dimmed'>
                        {tExt('pages.server.mods.installed.notOnModrinth', {})}
                      </Text>
                    )
                  )}
                </div>
              </Group>
            </TableData>

            <TableData>
              {mod.version ? (
                <Group gap='xs' wrap='nowrap'>
                  <Code>{mod.version.version_number}</Code>
                  {mod.version.version_type !== 'release' && <ChannelBadge channel={mod.version.version_type} />}
                </Group>
              ) : (
                <Text size='sm' c='dimmed'>
                  {tExt('pages.server.mods.installed.unknownVersion', {})}
                </Text>
              )}
            </TableData>

            <TableData>
              <Text size='sm' c='dimmed' truncate maw={260}>
                {mod.fileName}
              </Text>
            </TableData>

            <TableData>{bytesToString(mod.size)}</TableData>

            <TableData>
              <Switch
                checked={mod.enabled}
                disabled={!canUpdate || toggling}
                onChange={(event) => doToggle(event.currentTarget.checked)}
                aria-label={
                  mod.enabled
                    ? tExt('pages.server.mods.button.disable', {})
                    : tExt('pages.server.mods.button.enable', {})
                }
              />
            </TableData>

            <ContextMenuToggle items={items} openMenu={openMenu} />
          </TableRow>
        )}
      </ContextMenu>
    </>
  );
}

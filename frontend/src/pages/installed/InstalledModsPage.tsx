import {
  faArrowsRotate,
  faArrowUp,
  faBoxArchive,
  faCompass,
  faCubes,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Center } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import Button from '@/elements/buttons/Button.tsx';
import Table from '@/elements/data-display/Table.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import EmptyState from '@/elements/feedback/EmptyState.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import SegmentedControl from '@/elements/layout/SegmentedControl.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import ModsPageLayout from '../../components/ModsPageLayout.tsx';
import { useInstalledMods } from '../../hooks/useInstalledMods.ts';
import { serverModsPath } from '../../lib/constants.ts';
import { useExtTranslations } from '../../translations.ts';
import InstalledModRow, { modDisplayName } from './InstalledModRow.tsx';
import UpdateAllModal from './UpdateAllModal.tsx';

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'updates' | 'issues';

export default function InstalledModsPage() {
  const { t: tExt } = useExtTranslations();
  const navigate = useNavigate();
  const uuidShort = useServerStore((state) => state.server.uuidShort);
  const canSwitch = useServerCan(['files.create', 'files.delete'], false);
  // Below this width the table's switch and menu would be off-screen; cards keep them reachable.
  const narrow = useMediaQuery('(max-width: 62em)');

  const { mods, pack, fileNames, loading, identifying, checkingUpdates, error, identifyError, refreshing, refresh } =
    useInstalledMods();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [updateAllOpen, setUpdateAllOpen] = useState(false);

  const enabledCount = mods?.filter((mod) => mod.enabled).length ?? 0;
  const updateCount = mods?.filter((mod) => mod.update).length ?? 0;
  const issueCount = mods?.filter((mod) => mod.issues.length > 0).length ?? 0;
  const needle = search.trim().toLowerCase();
  const visibleMods = (mods ?? []).filter(
    (mod) =>
      (status === 'all' ||
        (status === 'enabled' && mod.enabled) ||
        (status === 'disabled' && !mod.enabled) ||
        (status === 'updates' && !!mod.update) ||
        (status === 'issues' && mod.issues.length > 0)) &&
      (!needle || modDisplayName(mod).toLowerCase().includes(needle) || mod.fileName.toLowerCase().includes(needle)),
  );
  const packName =
    [pack?.name, pack?.versionName].filter(Boolean).join(' ') || tExt('pages.server.mods.pack.unnamed', {});

  const browseButton = (
    <Button
      leftSection={<FontAwesomeIcon icon={faCompass} />}
      onClick={() => navigate(serverModsPath(uuidShort, '/browse'))}
    >
      {tExt('pages.server.mods.button.browse', {})}
    </Button>
  );

  return (
    <ModsPageLayout>
      {mods && updateCount > 0 && (
        <UpdateAllModal
          opened={updateAllOpen}
          onClose={() => setUpdateAllOpen(false)}
          mods={mods}
          fileNames={fileNames}
        />
      )}

      {pack && (
        <Alert color='violet' icon={<FontAwesomeIcon icon={faBoxArchive} />} mb='md'>
          {pack.files
            ? tExt('pages.server.mods.pack.banner', { pack: packName })
            : tExt('pages.server.mods.pack.bannerNoFiles', { pack: packName })}
        </Alert>
      )}

      {identifyError && (
        <Alert color='yellow' mb='md'>
          {tExt('pages.server.mods.installed.identifyFailed', { error: identifyError })}
        </Alert>
      )}

      {loading ? (
        <Spinner.Centered />
      ) : mods && mods.length === 0 && !error ? (
        <EmptyState
          icon={faCubes}
          title={tExt('pages.server.mods.installed.empty.title', {})}
          description={tExt('pages.server.mods.installed.empty.description', {})}
        >
          {browseButton}
        </EmptyState>
      ) : (
        <>
          <Group justify='space-between' mb='md' gap='sm'>
            <Group gap='sm' wrap='wrap'>
              <TextInput
                placeholder={tExt('pages.server.mods.installed.searchPlaceholder', {})}
                leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                w={narrow ? '100%' : 260}
              />
              {/* Scrolls sideways on phones instead of overflowing the page. */}
              <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <SegmentedControl
                  value={status}
                  onChange={(value) => setStatus(value as StatusFilter)}
                  data={(['all', 'enabled', 'disabled', 'updates', 'issues'] as const)
                    .filter(
                      (value) => (value !== 'updates' || updateCount > 0) && (value !== 'issues' || issueCount > 0),
                    )
                    .map((value) => ({
                      value,
                      label: tExt(`pages.server.mods.installed.filter.${value}`, {}),
                    }))}
                />
              </div>
            </Group>
            <Group gap='sm' wrap='wrap'>
              {mods && (
                <Text size='sm' c='dimmed'>
                  {tExt('pages.server.mods.installed.summary', {
                    total: mods.length,
                    enabled: enabledCount,
                    disabled: mods.length - enabledCount,
                  })}
                </Text>
              )}
              {updateCount > 0 && canSwitch && (
                <Button
                  variant='light'
                  leftSection={<FontAwesomeIcon icon={faArrowUp} />}
                  onClick={() => setUpdateAllOpen(true)}
                >
                  {tExt('pages.server.mods.updateAll.button', { count: updateCount })}
                </Button>
              )}
              <Button
                variant='default'
                leftSection={<FontAwesomeIcon icon={faArrowsRotate} spin={refreshing} />}
                onClick={refresh}
              >
                {tExt('pages.server.mods.button.refresh', {})}
              </Button>
              {browseButton}
            </Group>
          </Group>

          {(identifying || checkingUpdates) && (
            <Text size='sm' c='dimmed' mb='xs'>
              {identifying
                ? tExt('pages.server.mods.installed.identifying', {})
                : tExt('pages.server.mods.installed.checkingUpdates', {})}
            </Text>
          )}

          {narrow ? (
            error ? (
              <Alert color='red'>{error}</Alert>
            ) : visibleMods.length === 0 ? (
              <Center py='lg'>
                <Text c='dimmed'>{tExt('pages.server.mods.installed.noMatches', {})}</Text>
              </Center>
            ) : (
              <Stack gap='sm'>
                {visibleMods.map((mod) => (
                  <InstalledModRow
                    key={mod.fileName}
                    mod={mod}
                    identifying={identifying}
                    layout='card'
                    pack={pack}
                    fileNames={fileNames}
                  />
                ))}
              </Stack>
            )
          ) : (
            <Table
              columns={[
                tExt('pages.server.mods.installed.columns.mod', {}),
                tExt('pages.server.mods.installed.columns.version', {}),
                tExt('pages.server.mods.installed.columns.enabled', {}),
                '',
              ]}
              error={error}
              pagination={{
                total: visibleMods.length,
                perPage: Math.max(visibleMods.length, 1),
                page: 1,
                data: visibleMods,
              }}
              empty={
                <Center py='lg'>
                  <Text c='dimmed'>{tExt('pages.server.mods.installed.noMatches', {})}</Text>
                </Center>
              }
            >
              {visibleMods.map((mod) => (
                <InstalledModRow
                  key={mod.fileName}
                  mod={mod}
                  identifying={identifying}
                  layout='row'
                  pack={pack}
                  fileNames={fileNames}
                />
              ))}
            </Table>
          )}
        </>
      )}
    </ModsPageLayout>
  );
}

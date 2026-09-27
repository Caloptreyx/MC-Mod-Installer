import { faArrowsRotate, faCompass, faCubes, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Center } from '@mantine/core';
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
import Text from '@/elements/typography/Text.tsx';
import { useServerStore } from '@/stores/server.ts';
import ModsPageLayout from '../../components/ModsPageLayout.tsx';
import { useInstalledMods } from '../../hooks/useInstalledMods.ts';
import { serverModsPath } from '../../lib/constants.ts';
import { useExtTranslations } from '../../translations.ts';
import InstalledModRow, { modDisplayName } from './InstalledModRow.tsx';

type StatusFilter = 'all' | 'enabled' | 'disabled';

export default function InstalledModsPage() {
  const { t: tExt } = useExtTranslations();
  const navigate = useNavigate();
  const uuidShort = useServerStore((state) => state.server.uuidShort);

  const { mods, loading, identifying, error, identifyError, refreshing, refresh } = useInstalledMods();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const enabledCount = mods?.filter((mod) => mod.enabled).length ?? 0;
  const needle = search.trim().toLowerCase();
  const visibleMods = (mods ?? []).filter(
    (mod) =>
      (status === 'all' || mod.enabled === (status === 'enabled')) &&
      (!needle || modDisplayName(mod).toLowerCase().includes(needle) || mod.fileName.toLowerCase().includes(needle)),
  );

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
          <Group justify='space-between' mb='md'>
            <Group gap='sm'>
              <TextInput
                placeholder={tExt('pages.server.mods.installed.searchPlaceholder', {})}
                leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                w={260}
              />
              <SegmentedControl
                value={status}
                onChange={(value) => setStatus(value as StatusFilter)}
                data={(['all', 'enabled', 'disabled'] as const).map((value) => ({
                  value,
                  label: tExt(`pages.server.mods.installed.filter.${value}`, {}),
                }))}
              />
            </Group>
            <Group gap='sm'>
              {mods && (
                <Text size='sm' c='dimmed'>
                  {tExt('pages.server.mods.installed.summary', {
                    total: mods.length,
                    enabled: enabledCount,
                    disabled: mods.length - enabledCount,
                  })}
                </Text>
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

          {identifying && (
            <Text size='sm' c='dimmed' mb='xs'>
              {tExt('pages.server.mods.installed.identifying', {})}
            </Text>
          )}

          <Table
            columns={[
              tExt('pages.server.mods.installed.columns.mod', {}),
              tExt('pages.server.mods.installed.columns.version', {}),
              tExt('pages.server.mods.installed.columns.file', {}),
              tExt('pages.server.mods.installed.columns.size', {}),
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
              <InstalledModRow key={mod.fileName} mod={mod} identifying={identifying} onChanged={refresh} />
            ))}
          </Table>
        </>
      )}
    </ModsPageLayout>
  );
}

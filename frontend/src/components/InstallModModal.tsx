import { faCircleInfo, faDownload, faRightLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import Select from '@/elements/input/Select.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import FormattedTimestamp from '@/elements/time/FormattedTimestamp.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { bytesToString } from '@/lib/format/size.ts';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import type { ModrinthVersion } from '../api/modrinth.ts';
import { useGameVersions } from '../hooks/useGameVersions.ts';
import type { InstalledMod } from '../hooks/useInstalledMods.ts';
import { useModEnvironment } from '../hooks/useModEnvironment.ts';
import { useProjectVersions } from '../hooks/useProjectVersions.ts';
import { isModLoader, loaderLabel, modInstallerQueryKey } from '../lib/constants.ts';
import { installModVersion } from '../lib/modActions.ts';
import { installableLoaders, matchesFilter, preferredVersion, primaryFile } from '../lib/versions.ts';
import { useExtTranslations } from '../translations.ts';
import ChannelBadge from './ChannelBadge.tsx';

export interface InstallModProject {
  id: string;
  title: string;
  iconUrl: string | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  project: InstallModProject;
  /** The installed file of this project; installing then switches it to the selected version. */
  installed: InstalledMod | null;
  /** Version to preselect, e.g. when installing from the Versions tab. */
  initialVersionId?: string | null;
}

export default function InstallModModal({ opened, onClose, project, installed, initialVersionId = null }: Props) {
  const { t: tExt } = useExtTranslations();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size='lg'
      title={
        <Group gap='sm' wrap='nowrap'>
          <Avatar src={project.iconUrl} name={project.title} radius='md' size='md' />
          <Text fw={600}>
            {installed
              ? tExt('pages.server.mods.installModal.switchTitle', { mod: project.title })
              : tExt('pages.server.mods.installModal.title', { mod: project.title })}
          </Text>
        </Group>
      }
    >
      {opened && (
        <InstallModForm project={project} installed={installed} initialVersionId={initialVersionId} onClose={onClose} />
      )}
    </Modal>
  );
}

function InstallModForm({
  project,
  installed,
  initialVersionId,
  onClose,
}: Omit<Props, 'opened' | 'initialVersionId'> & { initialVersionId: string | null }) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const serverUuid = useServerStore((state) => state.server.uuid);
  const canDelete = useServerCan('files.delete');

  const { environment, loading: environmentLoading } = useModEnvironment();
  const { data: versions, isLoading: versionsLoading, error: versionsError } = useProjectVersions(project.id);
  const { releases, compare } = useGameVersions();

  const [loader, setLoader] = useState<string | null>(null);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loaders = useMemo(() => installableLoaders(versions ?? []), [versions]);

  const gameVersionsFor = (forLoader: string | null) =>
    [
      ...new Set(
        (versions ?? [])
          .filter((version) => matchesFilter(version, { loader: forLoader, gameVersion: null }))
          .flatMap((version) => version.game_versions),
      ),
    ].sort(compare);

  /** Detected version when available, else the newest release the preferred mod version supports. */
  const defaultGameVersion = (forLoader: string | null, source: ModrinthVersion | undefined) => {
    const candidates = source ? [...source.game_versions].sort(compare) : gameVersionsFor(forLoader);
    if (environment?.minecraftVersion && candidates.includes(environment.minecraftVersion)) {
      return environment.minecraftVersion;
    }

    const preferred =
      source ??
      preferredVersion(
        (versions ?? []).filter((version) => matchesFilter(version, { loader: forLoader, gameVersion: null })),
      );
    const preferredCandidates = preferred ? [...preferred.game_versions].sort(compare) : candidates;

    return preferredCandidates.find((candidate) => releases.includes(candidate)) ?? preferredCandidates[0] ?? null;
  };

  const versionsFor = (forLoader: string | null, forGameVersion: string | null) =>
    (versions ?? []).filter((version) => matchesFilter(version, { loader: forLoader, gameVersion: forGameVersion }));

  // Preselect once the project's versions and the server environment are known.
  useEffect(() => {
    if (!versions || environmentLoading || loader !== null) return;

    const initial = versions.find((version) => version.id === initialVersionId);
    const candidates = initial ? initial.loaders : loaders;
    const initialLoader =
      environment?.loader && candidates.includes(environment.loader)
        ? environment.loader
        : (candidates.find(isModLoader) ?? candidates[0] ?? null);
    const initialGameVersion = defaultGameVersion(initialLoader, initial);

    setLoader(initialLoader);
    setGameVersion(initialGameVersion);
    setVersionId(initial?.id ?? preferredVersion(versionsFor(initialLoader, initialGameVersion))?.id ?? null);
  }, [versions, environmentLoading]);

  const onLoaderChange = (value: string | null) => {
    const nextGameVersion =
      gameVersion && gameVersionsFor(value).includes(gameVersion) ? gameVersion : defaultGameVersion(value, undefined);

    setLoader(value);
    setGameVersion(nextGameVersion);
    setVersionId(preferredVersion(versionsFor(value, nextGameVersion))?.id ?? null);
  };

  const onGameVersionChange = (value: string | null) => {
    setGameVersion(value);
    setVersionId(preferredVersion(versionsFor(loader, value))?.id ?? null);
  };

  const matchingVersions = versionsFor(loader, gameVersion);
  const selected = matchingVersions.find((version) => version.id === versionId);
  const file = selected ? primaryFile(selected) : undefined;
  const alreadyInstalled = !!selected && installed?.version?.id === selected.id;
  const replacing = !!installed && !alreadyInstalled;
  const detectionIncomplete = !!environment && (!environment.loader || !environment.minecraftVersion);

  const doInstall = () => {
    if (!selected) return;

    setSubmitting(true);
    installModVersion(serverUuid, selected, installed)
      .then(() => {
        const values = { mod: project.title, version: selected.version_number };
        addToast(
          installed
            ? tExt('pages.server.mods.toast.switched', values)
            : tExt('pages.server.mods.toast.installed', values),
          'success',
        );
        queryClient.invalidateQueries({ queryKey: modInstallerQueryKey('mods', serverUuid) });
        onClose();
      })
      .catch((error) => addToast(httpErrorToHuman(error), 'error'))
      .finally(() => setSubmitting(false));
  };

  if (versionsError) {
    return <Alert color='red'>{httpErrorToHuman(versionsError)}</Alert>;
  }

  if (versionsLoading || environmentLoading || !versions) {
    return <Spinner.Centered />;
  }

  return (
    <Stack gap='md'>
      <Group grow align='flex-end'>
        <Select
          label={tExt('pages.server.mods.installModal.loader', {})}
          data={loaders.map((value) => ({ value, label: loaderLabel(value) }))}
          value={loader}
          onChange={onLoaderChange}
          description={
            environment?.loader
              ? tExt('pages.server.mods.installModal.detectedHint', { value: loaderLabel(environment.loader) })
              : undefined
          }
        />
        <Select
          label={tExt('pages.server.mods.installModal.gameVersion', {})}
          data={gameVersionsFor(loader)}
          value={gameVersion}
          onChange={onGameVersionChange}
          searchable
          description={
            environment?.minecraftVersion
              ? tExt('pages.server.mods.installModal.detectedHint', { value: environment.minecraftVersion })
              : undefined
          }
        />
      </Group>

      <Select
        label={tExt('pages.server.mods.installModal.version', {})}
        data={matchingVersions.map((version) => ({
          value: version.id,
          label:
            version.version_type === 'release'
              ? version.version_number
              : `${version.version_number} (${tExt(`pages.server.mods.channel.${version.version_type}`, {})})`,
        }))}
        value={selected?.id ?? null}
        onChange={setVersionId}
        searchable
        disabled={matchingVersions.length === 0}
      />

      {matchingVersions.length === 0 && (
        <Alert color='gray' icon={<FontAwesomeIcon icon={faCircleInfo} />}>
          {tExt('pages.server.mods.installModal.noVersions', {})}
        </Alert>
      )}

      {selected && file && (
        <Paper withBorder p='sm' radius='md'>
          <Group justify='space-between' wrap='nowrap'>
            <Stack gap={4} miw={0}>
              <Group gap='xs'>
                <Text fw={600}>{selected.name}</Text>
                <ChannelBadge channel={selected.version_type} />
              </Group>
              <Text size='sm' c='dimmed' truncate>
                {tExt('pages.server.mods.installModal.file', {})}: <Code>{file.filename}</Code>
              </Text>
            </Stack>
            <Stack gap={4} align='flex-end'>
              <Text size='sm'>{bytesToString(file.size)}</Text>
              <Text size='xs' c='dimmed'>
                <FormattedTimestamp timestamp={selected.date_published} />
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}

      {alreadyInstalled && (
        <Alert color='blue' icon={<FontAwesomeIcon icon={faCircleInfo} />}>
          {tExt('pages.server.mods.installModal.alreadyInstalled', {})}
        </Alert>
      )}

      {installed && replacing && (
        <Alert color='blue' icon={<FontAwesomeIcon icon={faRightLeft} />}>
          {tExt('pages.server.mods.installModal.currentVersion', {
            version: installed.version?.version_number ?? installed.fileName,
          }).md()}
        </Alert>
      )}

      {selected && environment?.loader && loader !== environment.loader && (
        <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.loaderMismatch', {
            selected: loaderLabel(loader ?? ''),
            detected: loaderLabel(environment.loader),
          })}
        </Alert>
      )}

      {selected && environment?.minecraftVersion && gameVersion !== environment.minecraftVersion && (
        <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.gameVersionMismatch', {
            selected: gameVersion ?? '',
            detected: environment.minecraftVersion,
          })}
        </Alert>
      )}

      {detectionIncomplete && (
        <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.notDetected', {})}
        </Alert>
      )}

      <ModalFooter>
        <Button
          leftSection={<FontAwesomeIcon icon={installed ? faRightLeft : faDownload} />}
          loading={submitting}
          disabled={!selected || !file || alreadyInstalled || (replacing && !canDelete)}
          onClick={doInstall}
        >
          {installed
            ? tExt('pages.server.mods.installModal.submitSwitch', {})
            : tExt('pages.server.mods.installModal.submit', {})}
        </Button>
        <Button variant='default' onClick={onClose}>
          {t('common.button.cancel', {})}
        </Button>
      </ModalFooter>
    </Stack>
  );
}

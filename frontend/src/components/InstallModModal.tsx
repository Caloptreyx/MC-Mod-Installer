import {
  faArrowUpRightFromSquare,
  faCircleInfo,
  faDownload,
  faRightLeft,
  faTriangleExclamation,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { FileButton } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import Checkbox from '@/elements/input/Checkbox.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
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
import { getVersionsByHashes } from '../api/modrinth.ts';
import { type DependencyEntry, useDependencies } from '../hooks/useDependencies.ts';
import { useGameVersions } from '../hooks/useGameVersions.ts';
import { type InstalledMod, useInstalledMods } from '../hooks/useInstalledMods.ts';
import { useModEnvironment } from '../hooks/useModEnvironment.ts';
import { useProjectVersions } from '../hooks/useProjectVersions.ts';
import { fromModrinthVersion, type ModVersion } from '../lib/catalog.ts';
import { curseforgeFileUrl, isModLoader, loaderLabel, type ModSource, modInstallerQueryKey } from '../lib/constants.ts';
import { canDownload, installUploadedJar, installVersion } from '../lib/modActions.ts';
import { installableLoaders, matchesFilter, platformMismatch, preferredVersion } from '../lib/versions.ts';
import { useExtTranslations } from '../translations.ts';
import ChannelBadge from './ChannelBadge.tsx';

export interface InstallModProject {
  source: ModSource;
  id: string;
  slug: string;
  title: string;
  iconUrl: string | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  project: InstallModProject;
  /** The installed file of this project; installing then switches it to the selected version. */
  installed: InstalledMod | null;
  /** Version to preselect, e.g. when installing from the Versions tab or updating. */
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

const nameKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

function DependencyList({
  entries,
  selected,
  onToggle,
  isInstalled,
}: {
  entries: DependencyEntry[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  isInstalled: (entry: DependencyEntry) => boolean;
}) {
  const { t: tExt } = useExtTranslations();
  const required = entries.filter((entry) => entry.relation === 'required');
  const incompatible = entries.filter((entry) => entry.relation === 'incompatible' && isInstalled(entry));

  return (
    <Stack gap='xs'>
      {required.length > 0 && (
        <Paper withBorder p='sm' radius='md'>
          <Stack gap='xs'>
            <Text fw={600} size='sm'>
              {tExt('pages.server.mods.installModal.dependencies.title', {})}
            </Text>
            {required.map((entry) => {
              const installed = isInstalled(entry);
              const installable = !installed && !!entry.version && canDownload(entry.version);
              return (
                <Group key={entry.project.id} justify='space-between' wrap='nowrap' gap='xs'>
                  <Checkbox
                    label={entry.project.title}
                    checked={installable && selected.has(entry.project.id)}
                    disabled={!installable}
                    onChange={(event) => onToggle(entry.project.id, event.currentTarget.checked)}
                  />
                  <Text size='xs' c='dimmed' ta='right'>
                    {installed
                      ? tExt('pages.server.mods.installModal.dependencies.installed', {})
                      : !entry.version
                        ? tExt('pages.server.mods.installModal.dependencies.noVersion', {})
                        : !canDownload(entry.version)
                          ? tExt('pages.server.mods.installModal.dependencies.manual', {})
                          : entry.version.versionNumber}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        </Paper>
      )}
      {incompatible.length > 0 && (
        <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.dependencies.incompatible', {
            mods: incompatible.map((entry) => entry.project.title).join(', '),
          })}
        </Alert>
      )}
    </Stack>
  );
}

/** For CurseForge files the author only offers on CurseForge: the identical Modrinth file, else a manual upload. */
function ManualDownload({
  project,
  version,
  busy,
  disabled,
  onInstallFromModrinth,
  onUpload,
}: {
  project: InstallModProject;
  version: ModVersion;
  busy: boolean;
  disabled: boolean;
  onInstallFromModrinth: (version: ModVersion) => void;
  onUpload: (file: File) => void;
}) {
  const { t: tExt } = useExtTranslations();
  const sha1 = version.file?.sha1 ?? null;
  const copy = useQuery({
    queryKey: modInstallerQueryKey('modrinth-copy', sha1),
    queryFn: async () => {
      const found = (await getVersionsByHashes([sha1!]))[sha1!];
      return found ? fromModrinthVersion(found) : null;
    },
    enabled: !!sha1,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <Alert color='blue' icon={<FontAwesomeIcon icon={faCircleInfo} />}>
      <Stack gap='sm'>
        <Text size='sm'>{tExt('pages.server.mods.installModal.manual.description', {})}</Text>
        {copy.isLoading ? (
          <Spinner size={16} />
        ) : copy.data && canDownload(copy.data) ? (
          <Group>
            <Button
              size='xs'
              leftSection={<FontAwesomeIcon icon={faDownload} />}
              loading={busy}
              disabled={disabled}
              onClick={() => onInstallFromModrinth(copy.data!)}
            >
              {tExt('pages.server.mods.installModal.manual.fromModrinth', {})}
            </Button>
          </Group>
        ) : (
          <Group gap='sm'>
            <Button
              size='xs'
              variant='default'
              onClick={() => {
                window.open(curseforgeFileUrl(project.slug, version.id), '_blank', 'noopener,noreferrer');
              }}
              leftSection={<FontAwesomeIcon icon={faArrowUpRightFromSquare} />}
            >
              {tExt('pages.server.mods.installModal.manual.open', {})}
            </Button>
            <FileButton
              onChange={(file) => file && onUpload(file)}
              accept='.jar,application/java-archive'
              disabled={disabled}
            >
              {(props) => (
                <Button
                  {...props}
                  size='xs'
                  loading={busy}
                  disabled={disabled}
                  leftSection={<FontAwesomeIcon icon={faUpload} />}
                >
                  {tExt('pages.server.mods.installModal.manual.upload', {})}
                </Button>
              )}
            </FileButton>
          </Group>
        )}
      </Stack>
    </Alert>
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

  const { environment, loading: environmentLoading, serverLoaders, minecraftVersion } = useModEnvironment();
  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = useProjectVersions(project.source, project.id);
  const { releases, compare } = useGameVersions();
  const { mods, pack, installedProject, fileNames } = useInstalledMods();

  const initial = versions?.find((version) => version.id === initialVersionId);
  const [showPreReleases, setShowPreReleases] = useState(false);
  const [loader, setLoader] = useState<string | null>(null);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [overridePlatform, setOverridePlatform] = useState(false);
  const [packConfirmed, setPackConfirmed] = useState(false);
  const [selectedDependencies, setSelectedDependencies] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visible = useMemo(
    () => (versions ?? []).filter((version) => showPreReleases || version.channel === 'release' || version === initial),
    [versions, showPreReleases, initial],
  );
  const loaders = useMemo(() => installableLoaders(visible), [visible]);

  const gameVersionsFor = (forLoader: string | null) =>
    [
      ...new Set(
        visible
          .filter((version) => matchesFilter(version, { loaders: forLoader ? [forLoader] : null, gameVersion: null }))
          .flatMap((version) => version.gameVersions),
      ),
    ].sort(compare);

  /** Detected version when available, else the newest release the preferred mod version supports. */
  const defaultGameVersion = (forLoader: string | null, source: ModVersion | undefined) => {
    const candidates = source ? [...source.gameVersions].sort(compare) : gameVersionsFor(forLoader);
    if (minecraftVersion && candidates.includes(minecraftVersion)) return minecraftVersion;

    const preferred =
      source ??
      preferredVersion(
        visible.filter((version) =>
          matchesFilter(version, { loaders: forLoader ? [forLoader] : null, gameVersion: null }),
        ),
        true,
      );
    const preferredCandidates = preferred ? [...preferred.gameVersions].sort(compare) : candidates;

    return preferredCandidates.find((candidate) => releases.includes(candidate)) ?? preferredCandidates[0] ?? null;
  };

  const versionsFor = (forLoader: string | null, forGameVersion: string | null) =>
    visible.filter((version) =>
      matchesFilter(version, { loaders: forLoader ? [forLoader] : null, gameVersion: forGameVersion }),
    );

  // Preselect once the project's versions and the server environment are known.
  useEffect(() => {
    if (!versions || environmentLoading || loader !== null) return;

    if (initial && initial.channel !== 'release') setShowPreReleases(true);
    const candidates = initial ? initial.loaders : loaders;
    const initialLoader =
      serverLoaders.find((serverLoader) => candidates.includes(serverLoader)) ??
      candidates.find(isModLoader) ??
      candidates[0] ??
      null;
    const initialGameVersion = defaultGameVersion(initialLoader, initial);

    setLoader(initialLoader);
    setGameVersion(initialGameVersion);
    setVersionId(initial?.id ?? preferredVersion(versionsFor(initialLoader, initialGameVersion), true)?.id ?? null);
  }, [versions, environmentLoading]);

  const onLoaderChange = (value: string | null) => {
    const nextGameVersion =
      gameVersion && gameVersionsFor(value).includes(gameVersion) ? gameVersion : defaultGameVersion(value, undefined);

    setLoader(value);
    setGameVersion(nextGameVersion);
    setVersionId(preferredVersion(versionsFor(value, nextGameVersion), true)?.id ?? null);
  };

  const onGameVersionChange = (value: string | null) => {
    setGameVersion(value);
    setVersionId(preferredVersion(versionsFor(loader, value), true)?.id ?? null);
  };

  const matchingVersions = versionsFor(loader, gameVersion);
  const selected = matchingVersions.find((version) => version.id === versionId);
  const file = selected?.file ?? null;
  const alreadyInstalled = !!selected && installed?.version?.id === selected.id;
  const replacing = !!installed && !alreadyInstalled;
  const mismatch = selected ? platformMismatch(selected, serverLoaders, minecraftVersion) : null;
  const wrongPlatform = !!mismatch && (mismatch.loader || mismatch.gameVersion);
  const detectionIncomplete = !!environment && (serverLoaders.length === 0 || !minecraftVersion);
  const needsPackConfirmation = !!installed?.fromPack;

  const dependencies = useDependencies(
    selected,
    serverLoaders.length > 0 ? serverLoaders : loader ? [loader] : [],
    minecraftVersion ?? gameVersion,
  );
  const isInstalled = (entry: DependencyEntry) =>
    !!installedProject(entry.project.source, entry.project.id) ||
    (mods ?? []).some(
      (mod) =>
        !!mod.project &&
        (nameKey(mod.project.slug) === nameKey(entry.project.slug) ||
          nameKey(mod.project.title) === nameKey(entry.project.title)),
    );

  // Required dependencies that can be installed start checked.
  useEffect(() => {
    setSelectedDependencies(
      new Set(
        (dependencies.data ?? [])
          .filter((entry) => entry.relation === 'required' && entry.version && canDownload(entry.version))
          .map((entry) => entry.project.id),
      ),
    );
  }, [dependencies.data]);

  const finish = (version: ModVersion) => {
    addToast(
      installed
        ? tExt('pages.server.mods.toast.switched', { mod: project.title, version: version.versionNumber })
        : tExt('pages.server.mods.toast.installed', { mod: project.title, version: version.versionNumber }),
      'success',
    );
    queryClient.invalidateQueries({ queryKey: modInstallerQueryKey('mods', serverUuid) });
    onClose();
  };

  const run = async (install: () => Promise<void>, version: ModVersion) => {
    setSubmitting(true);
    const installedNames = new Set(fileNames);
    try {
      await install();
      if (file) installedNames.add(file.filename);

      const extra = (dependencies.data ?? []).filter(
        (entry) =>
          entry.relation === 'required' &&
          entry.version &&
          selectedDependencies.has(entry.project.id) &&
          !isInstalled(entry),
      );
      for (const entry of extra) {
        setStatus(tExt('pages.server.mods.installModal.dependencies.installing', { mod: entry.project.title }));
        await installVersion(serverUuid, entry.version!, {
          replacing: null,
          existing: installedNames,
          onWait: (seconds) =>
            setStatus(tExt('pages.server.mods.installModal.waiting', { seconds, mod: entry.project.title })),
        });
        if (entry.version!.file) installedNames.add(entry.version!.file.filename);
      }
      finish(version);
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
      queryClient.invalidateQueries({ queryKey: modInstallerQueryKey('mods', serverUuid) });
    } finally {
      setStatus(null);
      setSubmitting(false);
    }
  };

  const options = () => ({ replacing: installed, existing: fileNames });
  const doInstall = () => {
    if (!selected) return;
    run(() => installVersion(serverUuid, selected, options()), selected);
  };
  const doInstallCopy = (copy: ModVersion) => run(() => installVersion(serverUuid, copy, options()), copy);
  const doUpload = (jar: File) => {
    if (!selected) return;
    run(() => installUploadedJar(serverUuid, jar, selected, options()), selected);
  };

  if (versionsError) {
    return <Alert color='red'>{httpErrorToHuman(versionsError)}</Alert>;
  }

  if (versionsLoading || environmentLoading || !versions) {
    return <Spinner.Centered />;
  }

  const blocked =
    (wrongPlatform && !overridePlatform) ||
    (needsPackConfirmation && !packConfirmed) ||
    alreadyInstalled ||
    (replacing && !canDelete);

  return (
    <Stack gap='md'>
      <Group grow align='flex-end'>
        <Select
          label={tExt('pages.server.mods.installModal.loader', {})}
          data={loaders.map((value) => ({ value, label: loaderLabel(value) }))}
          value={loader}
          onChange={onLoaderChange}
          description={
            environment?.software
              ? tExt('pages.server.mods.installModal.detectedHint', { value: loaderLabel(environment.software.value) })
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
            minecraftVersion
              ? tExt('pages.server.mods.installModal.detectedHint', { value: minecraftVersion })
              : undefined
          }
        />
      </Group>

      <Select
        label={tExt('pages.server.mods.installModal.version', {})}
        data={matchingVersions.map((version) => ({
          value: version.id,
          label:
            (version.channel === 'release'
              ? version.versionNumber
              : `${version.versionNumber} (${tExt(`pages.server.mods.channel.${version.channel}`, {})})`) +
            (canDownload(version) ? '' : ` · ${tExt('pages.server.mods.manualDownload', {})}`),
        }))}
        value={selected?.id ?? null}
        onChange={setVersionId}
        searchable
        disabled={matchingVersions.length === 0}
      />
      <Switch
        label={tExt('pages.server.mods.installModal.showPreReleases', {})}
        checked={showPreReleases}
        onChange={(event) => setShowPreReleases(event.currentTarget.checked)}
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
                <ChannelBadge channel={selected.channel} />
              </Group>
              <Text size='sm' c='dimmed' truncate>
                {tExt('pages.server.mods.installModal.file', {})}: <Code>{file.filename}</Code>
              </Text>
            </Stack>
            <Stack gap={4} align='flex-end'>
              <Text size='sm'>{bytesToString(file.size)}</Text>
              <Text size='xs' c='dimmed'>
                <FormattedTimestamp timestamp={selected.published} />
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}

      {selected && !file && (
        <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.noJar', {})}
        </Alert>
      )}

      {alreadyInstalled && (
        <Alert color='blue' icon={<FontAwesomeIcon icon={faCircleInfo} />}>
          {tExt('pages.server.mods.installModal.alreadyInstalled', {})}
        </Alert>
      )}

      {installed && replacing && (
        <Alert color='blue' icon={<FontAwesomeIcon icon={faRightLeft} />}>
          {tExt('pages.server.mods.installModal.currentVersion', {
            version: installed.version?.versionNumber ?? installed.fileName,
          })}
        </Alert>
      )}

      {selected && mismatch?.loader && (
        <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.loaderMismatch', {
            selected: selected.loaders.filter(isModLoader).map(loaderLabel).join(', '),
            detected: serverLoaders.map(loaderLabel).join(', '),
          })}
        </Alert>
      )}
      {selected && mismatch?.gameVersion && (
        <Alert color='red' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.gameVersionMismatch', {
            selected: gameVersion ?? '',
            detected: minecraftVersion ?? '',
          })}
        </Alert>
      )}
      {wrongPlatform && (
        <Checkbox
          label={tExt('pages.server.mods.installModal.overridePlatform', {})}
          checked={overridePlatform}
          onChange={(event) => setOverridePlatform(event.currentTarget.checked)}
        />
      )}

      {detectionIncomplete && (
        <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
          {tExt('pages.server.mods.installModal.notDetected', {})}
        </Alert>
      )}

      {selected && (dependencies.data?.length ?? 0) > 0 && (
        <DependencyList
          entries={dependencies.data ?? []}
          selected={selectedDependencies}
          isInstalled={isInstalled}
          onToggle={(id, checked) =>
            setSelectedDependencies((previous) => {
              const next = new Set(previous);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
        />
      )}
      {dependencies.isLoading && selected && <Spinner size={16} />}

      {needsPackConfirmation && (
        <Checkbox
          label={tExt('pages.server.mods.pack.confirm', {
            mod: project.title,
            pack:
              [pack?.name, pack?.versionName].filter(Boolean).join(' ') || tExt('pages.server.mods.pack.unnamed', {}),
          })}
          checked={packConfirmed}
          onChange={(event) => setPackConfirmed(event.currentTarget.checked)}
        />
      )}

      {selected && file && !canDownload(selected) && !alreadyInstalled && (
        <ManualDownload
          project={project}
          version={selected}
          busy={submitting}
          disabled={blocked}
          onInstallFromModrinth={doInstallCopy}
          onUpload={doUpload}
        />
      )}

      {status && (
        <Text size='sm' c='dimmed'>
          {status}
        </Text>
      )}

      <ModalFooter>
        <Button
          leftSection={<FontAwesomeIcon icon={installed ? faRightLeft : faDownload} />}
          loading={submitting}
          disabled={!selected || !file || !canDownload(selected) || blocked}
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
      {wrongPlatform && !overridePlatform && (
        <Text size='xs' c='dimmed' ta='right'>
          {tExt('pages.server.mods.installModal.blockedPlatform', {})}
        </Text>
      )}
    </Stack>
  );
}

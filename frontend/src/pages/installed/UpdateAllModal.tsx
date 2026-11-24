import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Checkbox from '@/elements/input/Checkbox.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import type { InstalledMod } from '../../hooks/useInstalledMods.ts';
import { modInstallerQueryKey } from '../../lib/constants.ts';
import { canDownload, installVersion } from '../../lib/modActions.ts';
import { useExtTranslations } from '../../translations.ts';
import { modDisplayName } from './InstalledModRow.tsx';

/**
 * Review step before updating several mods: everything is listed, pack mods start unchecked,
 * and the updates run one at a time, waiting out the panel's download limit.
 */
export default function UpdateAllModal({
  opened,
  onClose,
  mods,
  fileNames,
}: {
  opened: boolean;
  onClose: () => void;
  mods: InstalledMod[];
  fileNames: ReadonlySet<string>;
}) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const serverUuid = useServerStore((state) => state.server.uuid);

  const candidates = mods.filter((mod) => mod.update);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.filter((mod) => !mod.fromPack && canDownload(mod.update!)).map((mod) => mod.fileName)),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setFailures([]);
    const names = new Set(fileNames);
    let done = 0;
    const failed: string[] = [];

    for (const mod of candidates.filter((candidate) => selected.has(candidate.fileName))) {
      const name = modDisplayName(mod);
      setStatus(tExt('pages.server.mods.updateAll.progress', { mod: name, done, total: selected.size }));
      try {
        await installVersion(serverUuid, mod.update!, {
          replacing: mod,
          existing: names,
          onWait: (seconds) => setStatus(tExt('pages.server.mods.installModal.waiting', { seconds, mod: name })),
        });
        names.delete(mod.fileName);
        if (mod.update!.file) names.add(mod.update!.file.filename);
        done++;
      } catch (error) {
        failed.push(`${name}: ${httpErrorToHuman(error)}`);
      }
    }

    setRunning(false);
    setStatus(null);
    setFailures(failed);
    queryClient.invalidateQueries({ queryKey: modInstallerQueryKey('mods', serverUuid) });
    addToast(
      tExt('pages.server.mods.updateAll.done', { done, total: done + failed.length }),
      failed.length ? 'warning' : 'success',
    );
    if (failed.length === 0) onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={running ? () => {} : onClose}
      size='lg'
      title={tExt('pages.server.mods.updateAll.title', {})}
    >
      <Stack gap='sm'>
        <Text size='sm'>{tExt('pages.server.mods.updateAll.description', {})}</Text>
        {candidates.map((mod) => {
          const downloadable = canDownload(mod.update!);
          return (
            <Group key={mod.fileName} justify='space-between' wrap='nowrap' gap='xs'>
              <Checkbox
                label={modDisplayName(mod)}
                description={mod.fromPack ? tExt('pages.server.mods.updateAll.packMod', {}) : undefined}
                checked={selected.has(mod.fileName)}
                disabled={running || !downloadable}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.currentTarget.checked) next.add(mod.fileName);
                  else next.delete(mod.fileName);
                  setSelected(next);
                }}
              />
              <Text size='xs' c='dimmed' ta='right'>
                <Code>{mod.version?.versionNumber ?? mod.fileName}</Code> →{' '}
                {downloadable ? <Code>{mod.update!.versionNumber}</Code> : tExt('pages.server.mods.manualDownload', {})}
              </Text>
            </Group>
          );
        })}
        {status && (
          <Text size='sm' c='dimmed'>
            {status}
          </Text>
        )}
        {failures.length > 0 && (
          <Alert color='red'>
            <Stack gap={2}>
              {failures.map((failure) => (
                <Text key={failure} size='sm'>
                  {failure}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
        <ModalFooter>
          <Button loading={running} disabled={selected.size === 0} onClick={run}>
            {tExt('pages.server.mods.updateAll.submit', { count: selected.size })}
          </Button>
          <Button variant='default' disabled={running} onClick={onClose}>
            {t('common.button.cancel', {})}
          </Button>
        </ModalFooter>
      </Stack>
    </Modal>
  );
}

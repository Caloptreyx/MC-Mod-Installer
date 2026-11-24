import { faEraser, faPen, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Select from '@/elements/input/Select.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { Modal, ModalFooter } from '@/elements/modals/Modal.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { useTranslations } from '@/providers/TranslationProvider.tsx';
import { useServerStore } from '@/stores/server.ts';
import type { Confidence, DetectionSource, Evidence, ServerEnvironment } from '../lib/schemas.ts';
import { useModEnvironment } from '../hooks/useModEnvironment.ts';
import { loaderLabel, SOFTWARE, type Software } from '../lib/constants.ts';
import { clearOverride, saveOverride } from '../lib/modActions.ts';
import { useExtTranslations } from '../translations.ts';

const CONFIDENCE_COLORS: Record<Confidence, string> = { high: 'green', medium: 'yellow', low: 'gray' };
const EGG_FIELDS = ['egg', 'nest', 'startup', 'image'] as const;

function FieldRow({
  label,
  value,
  source,
  confidence,
}: {
  label: string;
  value: string | null;
  source: DetectionSource | null;
  confidence: Confidence | null;
}) {
  const { t: tExt } = useExtTranslations();

  return (
    <Group justify='space-between' wrap='wrap' gap='xs'>
      <Text size='sm' c='dimmed'>
        {label}
      </Text>
      <Group gap='xs' wrap='wrap'>
        <Text fw={600}>{value ?? tExt('pages.server.mods.environment.notDetected', {})}</Text>
        {source && (
          <Badge variant='default' size='sm'>
            {tExt(`pages.server.mods.environment.source.${source}`, {})}
          </Badge>
        )}
        {confidence && (
          <Badge variant='light' size='sm' color={CONFIDENCE_COLORS[confidence]}>
            {tExt(`pages.server.mods.environment.confidence.${confidence}`, {})}
          </Badge>
        )}
      </Group>
    </Group>
  );
}

function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const { t: tExt } = useExtTranslations();
  const eggField = EGG_FIELDS.find((field) => field === evidence.detail);
  const says = [
    evidence.software ? loaderLabel(evidence.software) : null,
    evidence.minecraftVersion
      ? tExt('pages.server.mods.environment.minecraft', { version: evidence.minecraftVersion })
      : null,
    evidence.loaderVersion
      ? tExt('pages.server.mods.environment.loaderVersionShort', { version: evidence.loaderVersion })
      : null,
  ].filter(Boolean);

  return (
    <Stack gap={2}>
      <Group gap='xs' wrap='wrap'>
        <Badge variant='default' size='sm'>
          {tExt(`pages.server.mods.environment.source.${evidence.source}`, {})}
        </Badge>
        {eggField ? (
          <Text size='sm'>{tExt(`pages.server.mods.environment.eggField.${eggField}`, {})}</Text>
        ) : (
          <Code style={{ wordBreak: 'break-all' }}>{evidence.detail}</Code>
        )}
        {evidence.note && (
          <Badge variant='light' size='sm' color={evidence.note === 'invalid' ? 'red' : 'gray'}>
            {tExt(`pages.server.mods.environment.note.${evidence.note}`, {})}
          </Badge>
        )}
      </Group>
      {says.length > 0 && (
        <Text size='xs' c='dimmed'>
          {says.join(' · ')}
        </Text>
      )}
    </Stack>
  );
}

function OverrideForm({ environment, onDone }: { environment: ServerEnvironment; onDone: () => void }) {
  const { t } = useTranslations();
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const serverUuid = useServerStore((state) => state.server.uuid);
  const { refresh } = useModEnvironment();

  const [software, setSoftware] = useState<Software | null>(
    environment.override?.software ?? environment.software?.value ?? null,
  );
  const [minecraftVersion, setMinecraftVersion] = useState(
    environment.override?.minecraftVersion ?? environment.minecraftVersion?.value ?? '',
  );
  const [loaderVersion, setLoaderVersion] = useState(
    environment.override?.loaderVersion ?? environment.loaderVersion?.value ?? '',
  );
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (!software) return;
    setSaving(true);
    saveOverride(serverUuid, {
      software,
      minecraftVersion: minecraftVersion.trim() || null,
      loaderVersion: loaderVersion.trim() || null,
    })
      .then(async () => {
        await refresh();
        addToast(tExt('pages.server.mods.environment.override.saved', {}), 'success');
        onDone();
      })
      .catch((error) => addToast(httpErrorToHuman(error), 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <Stack gap='sm'>
      <Text size='sm'>{tExt('pages.server.mods.environment.override.description', {})}</Text>
      <Select
        label={tExt('pages.server.mods.environment.software', {})}
        data={SOFTWARE.map((value) => ({ value, label: loaderLabel(value) }))}
        value={software}
        onChange={(value) => setSoftware(value as Software | null)}
        searchable
      />
      <TextInput
        label={tExt('pages.server.mods.environment.minecraftVersion', {})}
        placeholder='1.21.1'
        value={minecraftVersion}
        onChange={(event) => setMinecraftVersion(event.currentTarget.value)}
      />
      <TextInput
        label={tExt('pages.server.mods.environment.loaderVersion', {})}
        placeholder='0.16.5'
        value={loaderVersion}
        onChange={(event) => setLoaderVersion(event.currentTarget.value)}
      />
      <ModalFooter>
        <Button loading={saving} disabled={!software} onClick={save}>
          {t('common.button.save', {})}
        </Button>
        <Button variant='default' onClick={onDone}>
          {t('common.button.cancel', {})}
        </Button>
      </ModalFooter>
    </Stack>
  );
}

/**
 * The "Server software" panel: what was detected, from where and how sure, every hint, conflicts,
 * and the manual override (`/.mc-mod-installer.json`).
 */
export default function ServerSoftwareModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const serverUuid = useServerStore((state) => state.server.uuid);
  const { environment, refresh } = useModEnvironment();
  const canWrite = useServerCan(['files.create', 'files.update'], false);
  const canDelete = useServerCan('files.delete');

  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const doClear = () => {
    setClearing(true);
    clearOverride(serverUuid)
      .then(async () => {
        await refresh();
        addToast(tExt('pages.server.mods.environment.override.cleared', {}), 'success');
      })
      .catch((error) => addToast(httpErrorToHuman(error), 'error'))
      .finally(() => setClearing(false));
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      size='lg'
      title={tExt('pages.server.mods.environment.title', {})}
    >
      {!environment ? null : editing ? (
        <OverrideForm environment={environment} onDone={() => setEditing(false)} />
      ) : (
        <Stack gap='md'>
          <Paper withBorder p='sm' radius='md'>
            <Stack gap='xs'>
              <FieldRow
                label={tExt('pages.server.mods.environment.software', {})}
                value={environment.software ? loaderLabel(environment.software.value) : null}
                source={environment.software?.source ?? null}
                confidence={environment.software?.confidence ?? null}
              />
              <FieldRow
                label={tExt('pages.server.mods.environment.minecraftVersion', {})}
                value={environment.minecraftVersion?.value ?? null}
                source={environment.minecraftVersion?.source ?? null}
                confidence={environment.minecraftVersion?.confidence ?? null}
              />
              <FieldRow
                label={tExt('pages.server.mods.environment.loaderVersion', {})}
                value={environment.loaderVersion?.value ?? null}
                source={environment.loaderVersion?.source ?? null}
                confidence={environment.loaderVersion?.confidence ?? null}
              />
            </Stack>
          </Paper>

          {environment.override && environment.conflicts.length > 0 && (
            <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
              {tExt('pages.server.mods.environment.override.disagrees', {})}
            </Alert>
          )}
          {!environment.override && environment.conflicts.length > 0 && (
            <Alert color='yellow' icon={<FontAwesomeIcon icon={faTriangleExclamation} />}>
              {tExt('pages.server.mods.environment.conflicts', {})}
            </Alert>
          )}
          {environment.logStale && <Alert color='gray'>{tExt('pages.server.mods.environment.logStale', {})}</Alert>}

          {environment.conflicts.length > 0 && (
            <Stack gap='xs'>
              <Text fw={600}>{tExt('pages.server.mods.environment.conflictsTitle', {})}</Text>
              {environment.conflicts.map((evidence, index) => (
                <EvidenceLine key={`conflict-${index}`} evidence={evidence} />
              ))}
            </Stack>
          )}

          <Stack gap='xs'>
            <Text fw={600}>{tExt('pages.server.mods.environment.evidence', {})}</Text>
            {environment.evidence.length === 0 ? (
              <Text size='sm' c='dimmed'>
                {tExt('pages.server.mods.environment.noEvidence', {})}
              </Text>
            ) : (
              environment.evidence.map((evidence, index) => <EvidenceLine key={index} evidence={evidence} />)
            )}
          </Stack>

          <ModalFooter>
            {canWrite && (
              <Button leftSection={<FontAwesomeIcon icon={faPen} />} onClick={() => setEditing(true)}>
                {tExt('pages.server.mods.environment.override.set', {})}
              </Button>
            )}
            {environment.override && canDelete && (
              <Button
                variant='default'
                color='red'
                leftSection={<FontAwesomeIcon icon={faEraser} />}
                loading={clearing}
                onClick={doClear}
              >
                {tExt('pages.server.mods.environment.override.clear', {})}
              </Button>
            )}
          </ModalFooter>
        </Stack>
      )}
    </Modal>
  );
}

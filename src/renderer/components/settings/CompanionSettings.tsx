import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { CompanionConfig, CompanionListenMode, CompanionPairingCode, CompanionStatus } from '../../../shared/types';
import { formatDateTime, formatTime } from '../../../shared/utils/format-date-time';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { SettingsSection } from './SettingsSection';
import { SegmentedControl, SettingsRow, SettingsRows } from './SettingsRow';

/**
 * Phone companion (Settings > Phone): switch the companion server on, choose how the phone
 * reaches it, pair phones with a one-time code and revoke them
 */
export function CompanionSettings() {
  const { t } = useTranslation(['companion']);
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [portText, setPortText] = useState('');
  const [pairing, setPairing] = useState<CompanionPairingCode | null>(null);

  const show = useCallback((next: CompanionStatus) => {
    setStatus(next);
    setPortText(String(next.config.port));
  }, []);

  useEffect(() => {
    void window.electronAPI.getCompanionStatus().then((result) => {
      if (result.success && result.data) show(result.data);
    });
  }, [show]);

  const update = async (changes: Partial<CompanionConfig>) => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.setCompanionConfig(changes);
      if (result.success && result.data) show(result.data);
      else setError(result.error ?? t('companion:settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const commitPort = () => {
    const port = Number(portText);
    if (status && port !== status.config.port) void update({ port });
  };

  const createCode = async () => {
    const result = await window.electronAPI.createCompanionPairingCode();
    if (result.success && result.data) setPairing(result.data);
  };

  const revoke = async (deviceId: string) => {
    const result = await window.electronAPI.revokeCompanionDevice(deviceId);
    if (result.success && result.data) show(result.data);
  };

  if (!status) return null;
  const { config } = status;
  const stateText = status.error
    ? t('companion:settings.status.error', { error: status.error })
    : status.running
      ? t('companion:settings.status.running', { urls: status.urls.join(', ') })
      : t('companion:settings.status.off');

  return (
    <>
      <SettingsSection title={t('companion:settings.title')} description={t('companion:settings.description')}>
        <SettingsRows>
          <SettingsRow label={t('companion:settings.enabled')} description={t('companion:settings.enabledDescription')} htmlFor="companion-enabled">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-(--nav-label-color)" />}
            <Switch id="companion-enabled" checked={config.enabled} disabled={saving} onCheckedChange={(enabled) => void update({ enabled })} />
          </SettingsRow>

          <SettingsRow label={t('companion:settings.status.label')} description={stateText} />

          <SettingsRow label={t('companion:settings.listen.label')} description={t(`companion:settings.listen.${config.listen}Description`)}>
            <SegmentedControl<CompanionListenMode>
              value={config.listen}
              onValueChange={(listen) => void update({ listen })}
              ariaLabel={t('companion:settings.listen.label')}
              options={[
                { value: 'localhost', label: t('companion:settings.listen.localhost') },
                { value: 'network', label: t('companion:settings.listen.network') },
              ]}
            />
          </SettingsRow>

          {config.listen === 'localhost' && (
            <SettingsRow
              label={t('companion:settings.tailscale.label')}
              description={t('companion:settings.tailscale.description')}
              stacked
            >
              <code className="block rounded-lg bg-segment-track px-3 py-2 font-mono text-sm text-foreground select-all">
                tailscale serve --bg {config.port}
              </code>
            </SettingsRow>
          )}

          <SettingsRow label={t('companion:settings.port')} description={t('companion:settings.portDescription')} htmlFor="companion-port">
            <Input
              id="companion-port"
              className="w-24"
              inputMode="numeric"
              value={portText}
              onChange={(event) => setPortText(event.target.value.replace(/\D/g, ''))}
              onBlur={commitPort}
              onKeyDown={(event) => event.key === 'Enter' && commitPort()}
            />
          </SettingsRow>
        </SettingsRows>

        {error && <div className="mt-3 rounded-xl bg-segment-track px-4 py-3 text-sm text-foreground">{error}</div>}
      </SettingsSection>

      <SettingsSection title={t('companion:settings.devices.title')}>
        <SettingsRows>
          <SettingsRow
            label={t('companion:settings.devices.pair')}
            description={pairing
              ? t('companion:settings.devices.codeDescription', { time: formatTime(new Date(pairing.expiresAt)) })
              : t('companion:settings.devices.pairDescription')}
          >
            {pairing && <span className="font-mono text-base tracking-widest text-foreground select-all">{pairing.code}</span>}
            <Button variant="outline" size="sm" onClick={() => void createCode()} disabled={!status.running}>
              {pairing ? t('companion:settings.devices.newCode') : t('companion:settings.devices.createCode')}
            </Button>
          </SettingsRow>

          {status.devices.length === 0 && (
            <SettingsRow label={t('companion:settings.devices.none')} />
          )}
          {status.devices.map((device) => (
            <SettingsRow
              key={device.id}
              label={device.name}
              description={[
                t('companion:settings.devices.paired', { time: formatDateTime(device.pairedAt) }),
                device.lastSeenAt ? t('companion:settings.devices.lastSeen', { time: formatDateTime(device.lastSeenAt) }) : null,
              ].filter(Boolean).join(' · ')}
            >
              <Button variant="outline" size="sm" onClick={() => void revoke(device.id)}>
                {t('companion:settings.devices.revoke')}
              </Button>
            </SettingsRow>
          ))}
        </SettingsRows>
      </SettingsSection>
    </>
  );
}

import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Copy, Notice } from '@/components/ui/Stitch';
import { workingCopies } from './workingCopies';
export function WorkingCopyStatus() {
  const { t } = useTranslation();
  const status = useSyncExternalStore(workingCopies.subscribe, workingCopies.getStatus, workingCopies.getStatus);
  return Platform.OS === 'web' ? <Copy>{t('liveEnrollment.workingCopy')}</Copy>
    : status === 'failed' ? <Notice tone="danger">{t('liveEnrollment.nativeRecoveryFailed')}</Notice>
    : <Copy>{t(status === 'saving' ? 'liveEnrollment.nativeRecoverySaving' : 'liveEnrollment.nativeRecovery')}</Copy>;
}

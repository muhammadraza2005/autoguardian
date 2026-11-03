import {createNativeVault} from '../enrollment/nativeVault.native';
import {createOfflineAccess} from './offlineAccess';
export const offlineAccess=createOfflineAccess(createNativeVault('offline-access-v1'));

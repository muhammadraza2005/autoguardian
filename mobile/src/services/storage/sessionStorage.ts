import {runtime} from '@/config/runtime';
import {createTabStorage} from './tabStorage';
// Development web auth survives a reload in this tab. No domain data or passwords
// use this adapter; native auth still uses SecureStore. Production web stays in memory.
const store=createTabStorage(()=>runtime.developmentEmailAuth && typeof window!=='undefined'?window.sessionStorage:null);
export const sessionStorage = {
  async getItem(key: string) { return store.getItem(key); },
  async setItem(key: string, value: string) { store.setItem(key, value); },
  async removeItem(key: string) { store.removeItem(key); },
};
// Metro selects sessionStorage.native.ts for Android/iOS.

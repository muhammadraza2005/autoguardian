import {Platform} from 'react-native';
import {runtime} from '@/config/runtime';
import {createTabStorage} from '@/services/storage/tabStorage';
import {createWorkingCopyStore} from './workingCopyStore';
const storage=createTabStorage(()=>runtime.developmentEmailAuth && Platform.OS==='web' && typeof window!=='undefined'?window.sessionStorage:null);
export const workingCopies={...createWorkingCopyStore(storage),
  async prepare(scope:string){this.identify(scope);},async flush(){},
  getStatus:()=>'ready' as 'ready'|'saving'|'failed',subscribe:(_listener:()=>void)=>()=>{},
};

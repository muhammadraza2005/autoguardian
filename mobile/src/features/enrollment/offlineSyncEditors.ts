// Editor ownership prevents background retries from racing a manual mutation or
// changing a form while it is open. A mounted editor is conservative ownership.
let editors=0;
const listeners=new Set<()=>void>();
export const offlineSyncEditors={
  active:()=>editors>0,
  subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  enter(){editors++;for(const listener of listeners)listener();let released=false;
    return ()=>{if(released)return;released=true;editors=Math.max(0,editors-1);for(const listener of listeners)listener();};},
};

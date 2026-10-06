type BrowserStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
// Tab lifetime only. Callers decide whether browser persistence is allowed.
export function createTabStorage(browser:()=>BrowserStorage|null){
  const memory=new Map<string,string|null>();
  return {
    getItem(key:string){if(memory.has(key))return memory.get(key)??null;try{const store=browser();if(store)return store.getItem(key);}catch{/* Browser storage may be blocked. */}return null;},
    setItem(key:string,value:string){memory.set(key,value);try{browser()?.setItem(key,value);}catch{/* Keep this tab's in-memory value. */}},
    removeItem(key:string){memory.set(key,null);try{browser()?.removeItem(key);}catch{/* No persistent store available. */}},
  };
}

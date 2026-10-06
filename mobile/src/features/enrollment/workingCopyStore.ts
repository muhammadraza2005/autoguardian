import {z} from 'zod';
const uuid=z.uuid();const field=z.string().max(256);
const vehicleFields=z.object({chassisIdentifier:field,plate:field,category:field,make:field,model:field,manufactureYear:field,color:field}).strict();
const draftBody=z.object({organizationId:uuid,ownerProfileId:uuid,vehicle:z.object({chassisIdentifier:field,plate:field.nullable(),category:field,
  make:field.nullable(),model:field.nullable(),manufactureYear:z.number().int().nullable(),color:field.nullable()}).strict()}).strict();
const fittingBody=z.object({expectedDraftRevision:z.number().int().positive(),expectedFittingRevision:z.number().int().nonnegative(),
  package:z.enum(['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS']),placements:z.array(z.object({position:z.number().int().min(1).max(4),
    sealCode:field,photoId:uuid.nullable()}).strict()).max(4)}).strict();
export const draftWorkingSchema=z.object({kind:z.literal('vehicle'),baseRevision:z.number().int().positive().nullable(),organization:uuid,
  owner:z.union([uuid,z.literal('')]),fields:vehicleFields,key:uuid,
  pending:z.object({key:uuid,body:draftBody,revision:z.number().int().positive().optional()}).strict().nullable()}).strict();
export const sealWorkingSchema=z.object({kind:z.literal('seals'),draftRevision:z.number().int().positive(),fittingRevision:z.number().int().nonnegative(),
  package:z.enum(['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS']).nullable(),
  slots:z.array(z.object({position:z.number().int().min(1).max(4),sealCode:field,photoId:uuid.nullable()}).strict()).length(4),
  pending:z.object({key:uuid,body:fittingBody}).strict().nullable()}).strict();
const copySchema=z.discriminatedUnion('kind',[draftWorkingSchema,sealWorkingSchema]);
export type DraftWorking=z.infer<typeof draftWorkingSchema>;
export type SealWorking=z.infer<typeof sealWorkingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const prefix='autoguardian:working:v1:';
// Synthetic development form fields and references only. Never file bytes, names,
// credentials, PINs or a persisted query cache. Not a native encrypted/offline store.
export function createWorkingCopyStore(store:Store){
  const key=(scope:string,kind:'vehicle'|'seals',id:string)=>prefix+encodeURIComponent(scope)+':'+kind+':'+id;
  const index=prefix+'index',identity=prefix+'identity';
  function keys():string[]{try{return z.array(z.string().startsWith(prefix)).max(100).parse(JSON.parse(store.getItem(index)??'[]'));}catch{return [];}}
  function clear(){for(const k of keys())store.removeItem(k);store.removeItem(index);store.removeItem(identity);}
  return {
    clear,
    identify(scope:string){const before=store.getItem(identity);if(before && before!==scope)clear();store.setItem(identity,scope);},
    read(scope:string,kind:'vehicle'|'seals',id:string){
      if(store.getItem(identity)!==scope)return null;
      try{const raw=store.getItem(key(scope,kind,id));if(!raw || raw.length>20000)return null;
        const value=copySchema.parse(JSON.parse(raw));return value.kind===kind?value:null;}catch{return null;}
    },
    write(scope:string,id:string,value:DraftWorking|SealWorking){
      if(store.getItem(identity)!==scope)return;
      const parsed=copySchema.safeParse(value);if(!parsed.success)return;
      const k=key(scope,value.kind,id),all=keys();if(!all.includes(k)){if(all.length>=100)store.removeItem(all.shift()!);all.push(k);}
      store.setItem(index,JSON.stringify(all));store.setItem(k,JSON.stringify(parsed.data));
    },
    remove(scope:string,kind:'vehicle'|'seals',id:string){const k=key(scope,kind,id);store.removeItem(k);store.setItem(index,JSON.stringify(keys().filter(v=>v!==k)));},
  };
}

import { File, Directory, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { nativeVault } from './nativeVault.native';
import { evidenceRecoveryId, pendingEvidenceSchema, type PendingEvidence } from './pendingEvidence';
import { evidencePhotoKinds, type EvidenceKind } from './evidence';

export async function loadPendingEvidence(draftId:string,slot:string):Promise<PendingEvidence|null>{
  const raw=await nativeVault.read(evidenceRecoveryId(draftId,slot));
  return raw===null?null:pendingEvidenceSchema.parse(JSON.parse(raw));
}
export async function savePendingEvidence(draftId:string,slot:string,value:PendingEvidence){
  await nativeVault.write(evidenceRecoveryId(draftId,slot),JSON.stringify(pendingEvidenceSchema.parse(value)));
}
export async function removePendingEvidence(draftId:string,slot:string){await nativeVault.remove(evidenceRecoveryId(draftId,slot));}

async function removeTemporary(uri:string){
  const cache=Paths.cache.uri.replace(/\/$/,'')+'/';
  // Never delete an original document or a provider-owned content URI.
  if(new URL(uri).href.startsWith(cache)){const file=new File(uri);if(file.exists)await file.delete();}
}
export async function clearEvidenceCaptureCache(){
  // These two directories are owned by the app's sample capture modules. Clean
  // crash leftovers before restoring a signed-in enrollment session.
  for(const name of ['DocumentPicker','ImagePicker']){
    const directory=new Directory(Paths.cache,name);if(directory.exists)await directory.delete();
  }
}
export async function pickNativeEvidence(kind:EvidenceKind,camera:boolean):Promise<{dataUrl:string;size:number}|null>{
  let uri:string|undefined;
  try{
    if(camera){
      if(!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw new Error('Camera permission required.');
      const result=await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:0.7,exif:false,base64:false,allowsEditing:false});
      if(result.canceled)return null;uri=result.assets[0]?.uri;
    }else{
      const photo=(evidencePhotoKinds as readonly string[]).includes(kind);
      const result=await DocumentPicker.getDocumentAsync({type:photo?['image/jpeg','image/png']:['application/pdf','image/jpeg','image/png'],
        multiple:false,copyToCacheDirectory:true});
      if(result.canceled)return null;uri=result.assets[0]?.uri;
    }
    if(!uri)throw new Error('File unavailable.');
    const file=new File(uri),size=file.size;
    if(size<1 || size>2097152)throw new Error('Sample file must be at most 2 MB.');
    const bytes=await file.bytes();
    const mime=bytes[0]===0x25 && bytes[1]===0x50 && bytes[2]===0x44 && bytes[3]===0x46?'application/pdf'
      :bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4e && bytes[3]===0x47?'image/png'
      :bytes[0]===0xff && bytes[1]===0xd8?'image/jpeg':null;
    if(!mime || ((evidencePhotoKinds as readonly string[]).includes(kind) && mime==='application/pdf'))throw new Error('Invalid sample file.');
    return {dataUrl:'data:'+mime+';base64,'+await file.base64(),size};
  }finally{if(uri)await removeTemporary(uri);}
}

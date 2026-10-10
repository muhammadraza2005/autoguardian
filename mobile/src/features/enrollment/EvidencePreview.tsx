import { Image } from 'react-native';
export type PreviewProps={mimeType:string;dataBase64:string;onInspected?:()=>void;onFailed:()=>void};
export function EvidencePreview({mimeType,dataBase64,onInspected,onFailed}:PreviewProps){
  return <Image source={{uri:'data:'+mimeType+';base64,'+dataBase64}} resizeMode="contain" style={{width:'100%',height:360}}
    accessibilityLabel="Evidence" onLoad={onInspected} onError={onFailed}/>;
}

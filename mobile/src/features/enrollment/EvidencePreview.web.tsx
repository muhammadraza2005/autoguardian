import {useEffect,useMemo,useRef} from 'react';
import {Image} from 'react-native';
import {useTranslation} from 'react-i18next';
import type {PreviewProps} from './EvidencePreview';
import {pdfPreviewHtml,pdfViewerMessage} from './pdfPreview';
import {pdfRenderer} from './pdfRenderer.generated';
function PdfPreview({dataBase64,onInspected,onFailed}:PreviewProps){
  const {t}=useTranslation();const frame=useRef<HTMLIFrameElement>(null);
  const html=useMemo(()=>pdfPreviewHtml(dataBase64,pdfRenderer,{previous:t('pdfEvidence.previous'),next:t('pdfEvidence.next'),
    page:t('pdfEvidence.page'),loading:t('pdfEvidence.loading'),failed:t('pdfEvidence.failed'),text:t('pdfEvidence.text')})
    .replace('<script>','<script>window.ReactNativeWebView={postMessage:data=>window.parent.postMessage(data,"*")};'),[dataBase64,t]);
  useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||typeof event.data!=='string')return;
    const kind=pdfViewerMessage(event.data);if(kind==='INSPECTED')onInspected?.();if(kind==='FAILED')onFailed();};
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[onInspected,onFailed]);
  // A sandboxed, opaque-origin frame runs only our bundled renderer. CSP blocks
  // external fetches and links; document scripts are never interpreted.
  return <iframe ref={frame} srcDoc={html} sandbox="allow-scripts" title={t('liveEvidence.preview')}
    referrerPolicy="no-referrer" style={{height:500,width:'100%',border:0}} onError={onFailed}/>;
}
export function EvidencePreview(props:PreviewProps){const {t}=useTranslation();return props.mimeType==='application/pdf'?<PdfPreview {...props}/>:
  <Image source={{uri:'data:'+props.mimeType+';base64,'+props.dataBase64}} resizeMode="contain" style={{width:'100%',height:360}}
    accessibilityLabel={t('liveEvidence.preview')} onLoad={props.onInspected} onError={props.onFailed}/>;}

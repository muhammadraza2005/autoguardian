import { useMemo } from 'react';
import { Image, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import type { PreviewProps } from './EvidencePreview';
import { pdfPreviewHtml,isLocalPdfNavigation,pdfViewerMessage } from './pdfPreview';
import { pdfRenderer } from './pdfRenderer.generated';
function PdfPreview({dataBase64,onInspected,onFailed}:PreviewProps){
  const {t}=useTranslation();
  const html=useMemo(()=>pdfPreviewHtml(dataBase64,pdfRenderer,{previous:t('pdfEvidence.previous'),next:t('pdfEvidence.next'),
    page:t('pdfEvidence.page'),loading:t('pdfEvidence.loading'),failed:t('pdfEvidence.failed'),text:t('pdfEvidence.text')}),[dataBase64,t]);
  return <View style={{height:500,width:'100%'}}><WebView source={{html,baseUrl:'about:blank'}} originWhitelist={['*']}
    javaScriptEnabled domStorageEnabled={false} incognito cacheEnabled={false} cacheMode="LOAD_NO_CACHE"
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} javaScriptCanOpenWindowsAutomatically={false}
    mixedContentMode="never" setSupportMultipleWindows={false} webviewDebuggingEnabled={false}
    onShouldStartLoadWithRequest={request=>isLocalPdfNavigation(request.url)}
    onError={onFailed} onRenderProcessGone={onFailed} onContentProcessDidTerminate={onFailed}
    onMessage={event=>{const type=pdfViewerMessage(event.nativeEvent.data);if(type==='INSPECTED')onInspected?.();if(type==='FAILED')onFailed();}}/>
  </View>;
}
export function EvidencePreview(props:PreviewProps){
  const {t}=useTranslation();
  return props.mimeType==='application/pdf'?<PdfPreview {...props}/>:<Image source={{uri:'data:'+props.mimeType+';base64,'+props.dataBase64}}
    resizeMode="contain" style={{width:'100%',height:360}} accessibilityLabel={t('liveEvidence.preview')}
    onLoad={props.onInspected} onError={props.onFailed}/>;
}

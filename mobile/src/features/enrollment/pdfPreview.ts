export type PdfLabels={previous:string;next:string;page:string;loading:string;failed:string;text:string};
export function pdfPreviewHtml(dataBase64:string,renderer:string,labels:PdfLabels):string{
  if(dataBase64.length>Math.ceil(2097152/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)
    || !dataBase64.startsWith('JVBERi0'))throw new Error('Invalid PDF.');
  const safe=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  // No links, attachments, scripts from the document, network, persistent storage,
  // or plaintext file exports. PDF.js draws one bounded canvas at a time.
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<style>body{margin:0;font:16px sans-serif;color:#172033;background:white}nav{display:flex;gap:8px;align-items:center;padding:8px;position:sticky;top:0;background:white}button{min-height:48px;flex:1}canvas{display:block;max-width:100%;height:auto}pre{white-space:pre-wrap;padding:12px;font:16px sans-serif}</style></head>
<body><nav><button id="prev"></button><span id="page" aria-live="polite"></span><button id="next"></button></nav>
<p id="status" role="status"></p><canvas id="canvas" role="img"></canvas><details><summary id="textLabel"></summary><pre id="text"></pre></details>
<script>${renderer.replace(/<\/script/gi,'<\\/script')}</script><script>
const labels=${safe(labels)},encoded=${safe(dataBase64)};
const el=id=>document.getElementById(id),notify=type=>window.ReactNativeWebView.postMessage(JSON.stringify({type}));
el('prev').textContent=labels.previous;el('next').textContent=labels.next;el('textLabel').textContent=labels.text;
let pdf=null,number=1,busy=false,closed=false,task=null;const visited=new Set();
function buttons(){el('prev').disabled=busy||!pdf||number===1;el('next').disabled=busy||!pdf||number===pdf.numPages;}
async function render(){
  busy=true;buttons();el('status').textContent=labels.loading;
  try{
    const page=await pdf.getPage(number);if(closed)return;
    const original=page.getViewport({scale:1});
    const width=Math.min(1600,Math.max(320,window.innerWidth));
    const scale=Math.min(width/original.width,4096/original.height,Math.sqrt(8000000/(original.width*original.height)));
    if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid page');
    const viewport=page.getViewport({scale}),canvas=el('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;if(closed)return;
    const text=await page.getTextContent();if(closed)return;
    el('text').textContent=text.items.map(item=>item.str||'').join(' ');
    el('page').textContent=labels.page+' '+number+' / '+pdf.numPages;
    canvas.setAttribute('aria-label',el('page').textContent);el('status').textContent='';
    visited.add(number);if(visited.size===pdf.numPages)notify('INSPECTED');page.cleanup();
  }catch{notify('FAILED');el('status').textContent=labels.failed;}
  finally{busy=false;buttons();}
}
el('prev').onclick=()=>{if(!busy&&number>1){number--;void render();}};
el('next').onclick=()=>{if(!busy&&pdf&&number<pdf.numPages){number++;void render();}};
window.addEventListener('pagehide',()=>{closed=true;if(task)void task.destroy();el('canvas').width=0;el('text').textContent='';});
(async()=>{try{
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  task=globalThis.agPdf.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useWasm:false,
    useSystemFonts:true,disableAutoFetch:true,disableStream:true,disableRange:true,stopAtErrors:true,maxImageSize:8000000});
  pdf=await task.promise;if(closed)return;if(pdf.numPages<1||pdf.numPages>100)throw new Error('Page limit');await render();
}catch{notify('FAILED');el('status').textContent=labels.failed;buttons();}})();
</script></body></html>`;
}
export function isLocalPdfNavigation(url:string){return url==='about:blank' || url.startsWith('about:blank#');}
export function pdfViewerMessage(raw:string):'INSPECTED'|'FAILED'|null{
  if(raw.length>80)return null;
  try{const value=JSON.parse(raw);return value && Object.keys(value).length===1 && ['INSPECTED','FAILED'].includes(value.type)?value.type:null;}catch{return null;}
}

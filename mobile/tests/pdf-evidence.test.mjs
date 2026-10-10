import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {Buffer} from 'node:buffer';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {pdfRenderer} from '../src/features/enrollment/pdfRenderer.generated.ts';
import {pdfPreviewHtml,pdfViewerMessage,isLocalPdfNavigation} from '../src/features/enrollment/pdfPreview.ts';
function vectorPdf(){
  const parts=['%PDF-1.4\n'],offsets=[0];
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 26 >>\nstream\n1 0 0 rg 0 0 100 100 re f\n\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 6 0 R >>',
    '<< /Length 26 >>\nstream\n0 0 1 rg 0 0 100 100 re f\n\nendstream'];
  for(const [i,object]of objects.entries()){offsets.push(parts.join('').length);parts.push(`${i+1} 0 obj\n${object}\nendobj\n`);}
  const xref=parts.join('').length;parts.push('xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+
    `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);return Buffer.from(parts.join(''));
}
const labels={previous:'Previous',next:'Next',page:'Page',loading:'Loading',failed:'Failed',text:'Text'};
test('bundled offline engine parses and renders real PDF pages; malformed documents fail closed',async()=>{
  // Execute the exact browser bundle without network or a browser. Canvas is a
  // real native Node canvas. This does not replace Android WebView acceptance.
  const context=vm.createContext({console,setTimeout,clearTimeout,URL,DOMMatrix,ImageData,Path2D,
    TextEncoder,TextDecoder,ReadableStream,WritableStream,TransformStream,structuredClone,atob,btoa,MessageChannel,
    Uint8Array,Uint32Array,ArrayBuffer,DataView,Promise,Blob,Response,Request,Headers,AbortController,AbortSignal,DOMException,performance,queueMicrotask,URLSearchParams,
    fetch:()=>{throw new Error('Network forbidden in evidence viewer');}});
  vm.runInContext(pdfRenderer,context);
  const task=context.agPdf.getDocument({data:new Uint8Array(vectorPdf()),isEvalSupported:false,useWasm:false,disableFontFace:true});
  try{
    const pdf=await task.promise;assert.equal(pdf.numPages,2);
    for(const [number,color]of [[1,[255,0,0,255]],[2,[0,0,255,255]]]){
      const page=await pdf.getPage(number),canvas=createCanvas(100,100),ctx=canvas.getContext('2d');
      await page.render({canvasContext:ctx,viewport:page.getViewport({scale:1})}).promise;
      assert.deepEqual([...ctx.getImageData(50,50,1,1).data],color);page.cleanup();
    }
  }finally{await task.destroy();}
  const bad=context.agPdf.getDocument({data:new Uint8Array(Buffer.from('%PDF-1.4\ninvalid\n%%EOF')),isEvalSupported:false});
  try{await assert.rejects(bad.promise);}finally{await bad.destroy();}
});
test('PDF preview restricts navigation, messages, payloads and network; labels cannot inject markup',()=>{
  const html=pdfPreviewHtml(vectorPdf().toString('base64'),'/*bundled*/',{...labels,next:'</script><script>attack()</script>'});
  assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("worker-src 'none'"));assert.ok(html.includes('isEvalSupported:false'));
  assert.ok(!html.includes('<script>attack()'));assert.ok(!html.includes('localStorage'));assert.ok(!html.includes('fetch('));
  for(const url of ['https://example.com','file:///private/document.pdf','intent://export','data:text/html,attack','javascript:attack()'])assert.equal(isLocalPdfNavigation(url),false);
  assert.equal(isLocalPdfNavigation('about:blank'),true);
  assert.equal(pdfViewerMessage('{"type":"INSPECTED"}'),'INSPECTED');assert.equal(pdfViewerMessage('{"type":"FAILED"}'),'FAILED');
  for(const value of ['{}','{"type":"INSPECTED","document":"secret"}','{"type":"ACTIVE"}','bad'])assert.equal(pdfViewerMessage(value),null);
  assert.throws(()=>pdfPreviewHtml('JVBERi0'+ 'A'.repeat(3000000),'',labels));assert.throws(()=>pdfPreviewHtml('not-pdf','',labels));
});
test('PDF review only marks inspection after every page renders, and rendering errors are reported',async()=>{
  const html=pdfPreviewHtml(vectorPdf().toString('base64'),'',labels);
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const nodes=new Map(),messages=[];for(const id of ['prev','next','page','status','canvas','textLabel','text'])nodes.set(id,{textContent:'',disabled:false,setAttribute(){},getContext(){return {};}});
  let fail=false;const pdf={numPages:2,getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:100*scale}),
    render:()=>({promise:fail?Promise.reject(new Error('Synthetic render failure')):Promise.resolve()}),getTextContent:async()=>({items:[{str:'<script>document text</script>'}]}),cleanup(){}})};
  const context={document:{getElementById:id=>nodes.get(id)},window:{innerWidth:360,ReactNativeWebView:{postMessage:raw=>messages.push(JSON.parse(raw))},addEventListener(){}},
    agPdf:{getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}})},atob,Uint8Array,console};
  vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.length,0);
  assert.equal(nodes.get('prev').disabled,true);assert.equal(nodes.get('next').disabled,false);
  nodes.get('next').onclick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(messages,[{type:'INSPECTED'}]);
  assert.equal(nodes.get('text').textContent,'<script>document text</script>');
  fail=true;nodes.get('prev').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(messages.at(-1).type,'FAILED');
});

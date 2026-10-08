import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput,View} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {useTranslation} from 'react-i18next';
import {Action,Copy,Label,Notice,stitchStyles} from '@/components/ui/Stitch';
import {ApiError} from '@/services/api/client';
import {parseFittingCode,type SealIssue} from './sealValidation';

export function SealCodeEntry({onUse,onClose}:{onUse:(code:string)=>Promise<SealIssue[]>;onClose:()=>void}) {
  const {t}=useTranslation();const [permission,requestPermission]=useCameraPermissions();
  const [code,setCode]=useState(''),[camera,setCamera]=useState(false),[busy,setBusy]=useState(false);
  const [problem,setProblem]=useState<string|null>(null),[issues,setIssues]=useState<SealIssue[]>([]);
  const scanned=useRef(false),generation=useRef(0),active=useRef(true),checking=useRef(false);
  const stop=useCallback(()=>{generation.current++;setCamera(false);},[]);
  useFocusEffect(useCallback(()=>{
    active.current=true;
    return ()=>{active.current=false;stop();};
  },[stop]));
  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>{if(state!=='active')stop();});
    return ()=>{active.current=false;stop();listener.remove();};
  },[stop]);
  async function openCamera(){
    const current=++generation.current;setProblem(null);
    try {
      const result=permission?.granted?permission:await requestPermission();
      if(!active.current || current!==generation.current)return;
      if(!result.granted){setProblem('cameraUnavailable');return;}
      scanned.current=false;setCamera(true);
    } catch {if(active.current && current===generation.current)setProblem('cameraUnavailable');}
  }
  function scan(raw:string){
    if(scanned.current)return;scanned.current=true;stop();
    const value=parseFittingCode(raw);setIssues([]);
    if(value){setCode(value);setProblem(null);}else setProblem('invalidCode');
  }
  async function confirmCode(){
    if(checking.current)return;
    const value=parseFittingCode(code);setIssues([]);setProblem(null);
    if(!value){setProblem('invalidCode');return;}
    checking.current=true;setBusy(true);stop();
    try {const result=await onUse(value);if(active.current)setIssues(result);}
    catch(error){if(active.current)setProblem(error instanceof ApiError && error.status===409?'conflict'
      :error instanceof ApiError && error.status===503?'setup':'failed');}
    finally {checking.current=false;if(active.current)setBusy(false);}
  }
  return <View style={{gap:12}}>
    <Label>{t('liveSeals.scanner.title')}</Label>
    <Copy>{t('liveSeals.scanner.hint')}</Copy>
    <TextInput accessibilityLabel={t('liveSeals.code')} value={code} style={stitchStyles.input} maxLength={50}
      autoCapitalize="characters" autoCorrect={false} editable={!busy} placeholder="DEV-SEAL-STD-001"
      onChangeText={value=>{setCode(value);setIssues([]);setProblem(null);}}/>
    <Action secondary icon="qr-code-outline" label={t('liveSeals.scanner.scan')} disabled={busy} onPress={()=>void openCamera()}/>
    {camera && <>
      <CameraView style={{height:240,width:'100%'}} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}}
        onBarcodeScanned={result=>scan(result.data)} onMountError={()=>{stop();setProblem('cameraUnavailable');}}/>
      <Action secondary label={t('liveSeals.scanner.stop')} onPress={stop}/>
    </>}
    {problem && <Notice tone="danger">{t(['conflict','setup','failed'].includes(problem)?'liveSeals.'+problem:'liveSeals.scanner.'+problem)}</Notice>}
    {issues.map(issue=><Notice key={issue} tone="danger">{t('liveSeals.validation.issues.'+issue)}</Notice>)}
    <Action label={t(busy?'liveSeals.validation.checking':'liveSeals.scanner.use')} disabled={busy} onPress={()=>void confirmCode()}/>
    <Action secondary label={t('liveSeals.scanner.cancel')} disabled={busy} onPress={()=>{stop();onClose();}}/>
  </View>;
}

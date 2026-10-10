import {useEffect,useRef,useState} from 'react';
import {TextInput,View} from 'react-native';
import {Redirect,useRouter} from 'expo-router';
import {useTranslation} from 'react-i18next';
import {getSupabaseClient} from '@/services/supabase/client';
import {useSession} from './SessionProvider';
import {normalizePhone,resendSeconds,validOtp} from './phone';
import {sendPhoneOtp,verifyPhoneOtp} from './phoneOtp';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';

export default function LivePhoneScreen(){
  const {t}=useTranslation(),router=useRouter(),{session,loading,error,refreshProfile}=useSession();
  const [phone,setPhone]=useState('+243'),[sent,setSent]=useState<string|null>(null),[otp,setOtp]=useState('');
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[seconds,setSeconds]=useState(0);
  const deadline=useRef(0),lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;const timer=setInterval(()=>setSeconds(resendSeconds(deadline.current)),1000);
    return()=>{mounted.current=false;clearInterval(timer);};},[]);
  if(session?.source==='server')return <Redirect href="/live-account"/>;
  async function send(){
    if(lock.current||resendSeconds(deadline.current)>0)return;
    lock.current=true;setBusy(true);setFailed(false);
    try{
      const normalized=normalizePhone(phone);
      // Provider rate limits and expiry are authoritative. The UI timer does not
      // weaken them. No test OTP or local success path exists here.
      deadline.current=Date.now()+60000;setSeconds(60);
      await sendPhoneOtp(getSupabaseClient().auth,normalized);
      if(mounted.current){setSent(normalized);setOtp('');}
    }catch{if(mounted.current)setFailed(true);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function verify(){
    if(lock.current||!sent||!validOtp(otp))return;
    lock.current=true;setBusy(true);setFailed(false);
    try{
      await verifyPhoneOtp(getSupabaseClient().auth,sent,otp);
      if(mounted.current)setOtp('');
    }catch{if(mounted.current)setFailed(true);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('m2.phoneTitle')}</Heading>
    <Notice>{t('m2.phoneHelp')}</Notice><Card><Label>{t('stitch.phoneLabel')}</Label>
      <TextInput accessibilityLabel={t('stitch.phoneLabel')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel"
        maxLength={32} editable={!busy&&!sent} style={u.input}/>
      {!sent?<Action label={t('stitch.sendCode')} disabled={busy||seconds>0} onPress={()=>void send()}/>:<>
        <Copy>{sent}</Copy><Label>{t('stitch.code')}</Label><TextInput accessibilityLabel={t('stitch.code')} value={otp} onChangeText={v=>setOtp(v.replace(/\D/g,''))}
          style={u.input} maxLength={6} keyboardType="number-pad" autoComplete="sms-otp" editable={!busy}/>
        <Action label={t('stitch.verify')} disabled={busy||!validOtp(otp)} onPress={()=>void verify()}/>
        <Action secondary label={t('stitch.resend')} disabled={busy||seconds>0} onPress={()=>void send()}/>
        <Action secondary label={t('stitch.editNumber')} disabled={busy} onPress={()=>{setSent(null);setOtp('');}}/>
      </>}{seconds>0&&<Copy>{t('m2.resendWait',{seconds})}</Copy>}</Card>
    {(busy||loading)&&<Copy accessibilityLiveRegion="polite">{t('devAuth.working')}</Copy>}
    {failed&&<Notice tone="danger">{t('m2.otpError')}</Notice>}
    {error&&<><Notice tone="danger">{t('devAuth.profileError')}</Notice><Action label={t('devAuth.retry')} onPress={refreshProfile}/></>}
    <Action secondary label={t('m2.staffSignIn')} onPress={()=>router.push('/staff-sign-in')}/>
  </StitchPage></View>;
}

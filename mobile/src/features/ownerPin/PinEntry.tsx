import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {Label,stitchStyles as u} from '@/components/ui/Stitch';
import {ownerPinStatus} from './contracts';
export function useTransientPin(){
 const [pin,setPin]=useState(''),generation=useRef(0);
 const clear=useCallback(()=>{generation.current++;setPin('');},[]);
 useFocusEffect(useCallback(()=>()=>clear(),[clear]));
 useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state!=='active')clear();});return()=>subscription.remove();},[clear]);
 return {pin,setPin,clear,generation};
}
export function useOwnerPinStatus(enabled:boolean){
 const {request,profile}=useSession();
 return useQuery({queryKey:['owner-pin-status',profile?.tenantId,profile?.id],enabled,retry:false,gcTime:0,staleTime:0,refetchOnMount:'always',
  queryFn:async({signal})=>{
   try{return ownerPinStatus.parse(await request('/v1/me/owner-pin',{signal}));}
   catch(error){if(error instanceof ApiError&&error.status===404)return {policyEnabled:false,configured:false,phoneCurrent:false,cooldown:false};throw error;}
  }});
}
export function PinEntry({value,onChange,disabled=false,label='ownerPin.pin'}:{value:string;onChange:(value:string)=>void;disabled?:boolean;label?:string}){
 const {t}=useTranslation();return <><Label>{t(label)}</Label><TextInput accessibilityLabel={t(label)} style={u.input} value={value}
  onChangeText={v=>onChange(v.replace(/\D/g,''))} secureTextEntry keyboardType="number-pad" maxLength={6}
  autoComplete="off" autoCorrect={false} autoCapitalize="none" editable={!disabled}/></>;
}

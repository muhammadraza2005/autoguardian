import {normalizePhone,validOtp} from './phone.ts';
export type PhoneOtpGateway={
  signInWithOtp(input:{phone:string}):Promise<{error:unknown}>;
  verifyOtp(input:{phone:string;token:string;type:'sms'}):Promise<{error:unknown;data:{session:unknown}}>;
};
export async function sendPhoneOtp(auth:PhoneOtpGateway,phone:string){
  const normalized=normalizePhone(phone),result=await auth.signInWithOtp({phone:normalized});
  if(result.error)throw new Error('OTP unavailable');return normalized;
}
export async function verifyPhoneOtp(auth:PhoneOtpGateway,phone:string,token:string){
  if(!validOtp(token))throw new Error('Invalid OTP');
  const result=await auth.verifyOtp({phone:normalizePhone(phone),token,type:'sms'});
  if(result.error||!result.data.session)throw new Error('OTP verification failed');
}

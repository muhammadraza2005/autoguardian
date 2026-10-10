// No country-specific length or national-prefix guesses. Require an explicit
// international prefix, accepting formatting spaces, hyphens and parentheses.
export function normalizePhone(value:string):string{
  if(!/^\+?[0-9 ()-]+$/.test(value.trim()))throw new Error('Invalid phone');
  let phone=value.trim().replace(/[ ()-]/g,'');
  if(phone.startsWith('00'))phone='+'+phone.slice(2);
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Invalid phone');
  return phone;
}
export function validOtp(token:string){return /^\d{6}$/.test(token);}
export function resendSeconds(deadline:number,now=Date.now()){return Math.max(0,Math.ceil((deadline-now)/1000));}

import {randomInt,randomUUID,randomBytes,createHash} from 'node:crypto';
import {BadRequestException,ForbiddenException,HttpException} from '@nestjs/common';
import {SmsConfiguration,formBody,phonePattern,messageIdPattern,verifyGateway} from './sms';
import {TelecomCipher,TelecomStorage,TelecomTx,DurableTelecomSender,TelecomSend} from './telecomStore';
import {verifyOwnerPin} from './ownerPin';

type Language='en'|'fr';
type Outcome={reply:string;sends:TelecomSend[]};
const help={en:'TEST: CHECK PLATE <plate>; CHECK CHASSIS <chassis>; CHECK SEAL <code>; STATUS <ref>; APPROVE <ref>; REFUSE <ref>. Verify through USSD first.',
 fr:'TEST: CHECK PLATE <plaque>; CHECK CHASSIS <chassis>; STATUS <ref>; APPROVE <ref>; REFUSE <ref>. Verifiez par USSD.'};
const menu={en:'CON TEST AutoGuardian\n1 Plate\n2 Chassis\n3 Status\n4 Approve\n5 Refuse\n6 Pending requests\n0 Exit',
 fr:'CON TEST AutoGuardian\n1 Plaque\n2 Chassis\n3 Statut\n4 Approuver\n5 Refuser\n6 Demandes\n0 Quitter'};
export class AfricasTalkingChannels {
 constructor(private readonly config:SmsConfiguration,private readonly serviceCode:string,private readonly shortcode:string,
  private readonly storage:TelecomStorage,private readonly cipher:TelecomCipher,private readonly sender:DurableTelecomSender,
  private readonly now=()=>Date.now(),private readonly code=()=>String(randomInt(100000,1000000)),private readonly maxReplyChars=160,private readonly pinSupport=false){
   if(!Number.isInteger(maxReplyChars)||maxReplyChars<120||maxReplyChars>512)throw new Error('Invalid USSD reply limit.');
  }
 private channel(phone:string){return this.cipher.hash(['channel',this.config.providerAccount,phone]);}
 private async rate(phone:string,kind:string,max:number,window:number,job?:string){
  await this.storage.transact(this.cipher.hash(['rate',this.config.providerAccount,phone,kind]),async state=>{
   const now=this.now();state??={at:now,count:0};
   if(now-state.at>=window)state={at:now,count:0};
   if(job&&state.job===job)return {state,result:null};
   if(state.count>=max)throw new HttpException({code:'CHANNEL_RATE_LIMIT'},429);
   state.count++;if(job)state.job=job;
   return {state,result:null,ttl:Math.ceil(window/1000)};
  });
 }
 private error(language:Language){return language==='fr'?'TEST: operation indisponible ou non autorisee. Verifiez par USSD.':'TEST: operation unavailable or not authorized. Verify through USSD.';}
 private validate(token:string|undefined,type:string|undefined,body:unknown){
  verifyGateway(token,this.config.gatewayToken);const p=formBody(type,body);
  const phone=p.phoneNumber??p.from;
  if(!phonePattern.test(phone??'')||!this.config.allowedRecipients.includes(phone))throw new ForbiddenException({code:'TEST_RECIPIENT_REQUIRED'});
  return p;
 }
 private async command(tx:TelecomTx,phone:string,language:Language,message:string,key:string){
  const tokens=/^(HELP|CHECK|STATUS|APPROVE|REFUSE)(?:\s+(.+))?$/i.exec(message.trim());
  if(!tokens||/[\x00-\x1f\x7f]/.test(message)||message.length>512)return help[language];
  const name=tokens[1].toUpperCase(),argument=tokens[2]?.trim();
  if(name==='HELP')return help[language];
  let operation:string,args:Record<string,unknown>;
  if(name==='CHECK'){
   const check=/^(PLATE|CHASSIS|SEAL)\s+(.{1,160})$/i.exec(argument??'');
   if(!check||check[1].toUpperCase()==='SEAL'&&!/^AG[A-F0-9]{32}$/.test(check[2]))return help[language];
   operation='check';args={method:check[1].toLowerCase(),value:check[2],key};
  }else{
   if(!/^[A-F0-9]{12}$/i.test(argument??''))return help[language];
   operation=name==='STATUS'?'status':'decision';args={id:argument,decision:name==='APPROVE'?'approved':'refused'};
  }
  const result=await tx.call<any>('telecom_operation',[this.channel(phone),phone,operation,args]);
  if(result.error)return this.error(language);
  if(operation==='decision')return language==='fr'?'TEST: reponse enregistree.':'TEST: response recorded.';
  return `TEST ${result.reference??argument}: ${result.expired?(language==='fr'?'expire':'expired'):result.outcome}. `
   +(language==='fr'?"Ceci n'autorise aucune vente.":'This does not authorize a sale.');
 }
 private uuid(value:unknown){const hex=this.cipher.hash(value);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;}
 async inbound(token:string|undefined,type:string|undefined,body:unknown){
  const p=this.validate(token,type,body);
  if(!this.shortcode||p.to!==this.shortcode||!phonePattern.test(p.from??'')||!this.config.allowedRecipients.includes(p.from)
   ||!messageIdPattern.test(p.id??'')||typeof p.text!=='string'||p.text.length>512)
   throw new BadRequestException({code:'INVALID_INBOUND_SMS'});
  await this.rate(p.from,'sms',20,60000);
  const key=this.cipher.hash(['inbound',this.config.providerAccount,p.id]),hash=this.cipher.hash([p.from,p.to,p.text]);
  const result=await this.storage.transact<Outcome>(key,async (state,tx)=>{
   if(state){if(state.hash!==hash)throw new BadRequestException({code:'INBOUND_REPLAY_CONFLICT'});return {state,result:state.result,ttl:86400};}
   const account=await tx.call<{language:Language}|null>('telecom_resolve',[p.from]);
   const reply=await this.command(tx,p.from,account?.language??'fr',p.text,this.uuid(['sms',p.id,p.from]));
   const result={reply,sends:[{key:`${this.config.providerAccount}:sms-reply:${p.id}`,phone:p.from,body:reply}]};
   return {state:{hash,result},result,ttl:86400};
  });
  for(const job of result.sends)await this.sender.send(job);
 }
 async ussd(token:string|undefined,type:string|undefined,body:unknown){
  const p=this.validate(token,type,body);
  if(!this.serviceCode||p.serviceCode!==this.serviceCode||!messageIdPattern.test(p.sessionId??'')||typeof p.text!=='string'||p.text.length>1024
   ||/[\x00-\x1f\x7f]/.test(p.text))throw new BadRequestException({code:'INVALID_USSD_CALLBACK'});
  const key=this.cipher.hash(['ussd',this.config.providerAccount,p.sessionId]);
  const hash=this.cipher.hash(p.text),parts=p.text===''?[]:p.text.split('*'),phone=p.phoneNumber;
  await this.rate(phone,'ussd',60,60000);
  if(parts.length>=2&&/^\d{6}$/.test(parts.at(-1)??''))await this.rate(phone,'otp-attempt',10,900000,this.cipher.hash([p.sessionId,p.text]));
  // Resolve the cooldown before entering the session transaction; no nested locks.
  const result=await this.storage.transact<Outcome>(key,async (state,tx)=>{
   const now=this.now(),binding=this.cipher.hash([phone,p.serviceCode]);
   if(state&&state.binding!==binding)throw new ForbiddenException({code:'USSD_SESSION_MISMATCH'});
   if(state&&state.expires<=now)return {state:{binding,expires:state.expires,closed:true},
    result:{reply:'END Session expired. Redial. Session expiree.',sends:[]},ttl:60};
   if(state&&state.hash===hash)return {state,result:state.result};
   if(!state&&p.text!=='')return {state:{binding,expires:now,closed:true},result:{reply:'END Session expired. Redial.',sends:[]}};
   if(state&&(state.closed||parts.length!==state.length+1||this.cipher.hash(parts.slice(0,-1).join('*'))!==state.hash))
    return {state,result:{reply:'END Invalid session sequence. Redial.',sends:[]}};
   state??={binding,expires:now+180000,phase:'language',length:0,attempts:0};
   let reply:string,sends:TelecomSend[]=[];const input=parts.at(-1)??'';
   const language:Language=state.language??'fr';
   if(p.text==='')reply='CON TEST AutoGuardian\n1 English\n2 Francais\n0 Exit';
   else if(input==='0'){state.closed=true;reply='END';}
   else if(state.phase==='language'){
    if(!['1','2'].includes(input))reply='CON 1 English\n2 Francais\n0 Exit';
    else{
     state.language=input==='1'?'en':'fr';
     const account=await tx.call<{authUserId:string;language:Language}|null>('telecom_resolve',[phone]);
     if(!account){state.closed=true;reply='END Account verification unavailable. Contact enrollment support.';}
     else{
      // Code generation is random; only its HMAC and an encrypted send intent persist.
      const code=this.code();state.challenge=this.cipher.hash(['challenge',key,code]);state.actor=account.authUserId;state.phase='otp';
      sends=[{key:`${this.config.providerAccount}:ussd-otp:${p.sessionId}`,phone,body:`AutoGuardian USSD: ${code}. Do not share. Ne partagez pas. Valid 3 min.`}];
      reply=state.language==='fr'?'CON Saisissez le code SMS.\n0 Quitter':'CON Enter the SMS code.\n0 Exit';
     }
    }
   }else if(state.phase==='otp'){
    state.attempts++;
    if(!/^\d{6}$/.test(input)||this.cipher.hash(['challenge',key,input])!==state.challenge){
     if(state.attempts>=5){state.closed=true;reply='END Verification failed. Redial later.';}
     else reply=language==='fr'?'CON Code invalide. Reessayez.\n0 Quitter':'CON Invalid code. Try again.\n0 Exit';
    }else{
     const verified=await tx.call('telecom_verify_channel',[this.channel(phone),phone,state.actor]);
     delete state.challenge;delete state.actor;state.phase='menu';
     if(!verified){state.closed=true;reply='END Verification unavailable.';}else reply=menu[language];
    }
   }else if(state.phase==='menu'){
    if(input==='6'){
     const pending=await tx.call<{items:{reference:string;plate?:string}[]}>('telecom_operation',[this.channel(phone),phone,'pending',{}]);
     if(!pending.items){state.closed=true;reply='END '+this.error(language);}
     else{
     reply='END TEST: '+(pending.items.map(r=>r.reference+(r.plate?' '+r.plate.slice(0,20):'')).join('; ')||(language==='fr'?'aucune demande':'no pending requests'));state.closed=true;
     }
    }else if(['1','2','3','4','5'].includes(input)){
     state.phase=({'1':'plate','2':'chassis','3':'status','4':'approve','5':'refuse'} as Record<string,string>)[input];
     reply=language==='fr'?'CON Saisissez la plaque, le chassis ou la reference.\n0 Quitter':'CON Enter plate, chassis or request reference.\n0 Exit';
    }else reply=menu[language];
   }else if(state.phase==='pin'){
    const nonce=randomUUID(),decision=state.decision==='approve'?'approved':'refused';
    const attempt=await tx.call<{credential:string}|null>('telecom_pin_begin',[this.channel(phone),phone,state.reference,decision,nonce]);
    if(!attempt){reply='END '+this.error(language);state.closed=true;}
    else{
     const valid=await verifyOwnerPin(input,attempt.credential),proof=createHash('sha256').update(randomBytes(32)).digest('hex');
     const accepted=await tx.call('telecom_pin_finish',[this.channel(phone),phone,state.reference,decision,nonce,valid,proof]);
     if(accepted){reply=language==='fr'?'END TEST: reponse enregistree.':'END TEST: response recorded.';state.closed=true;}
     else reply=language==='fr'?'CON PIN invalide ou action indisponible. Reessayez.\n0 Quitter':'CON Invalid PIN or unavailable action. Try again.\n0 Exit';
    }
   }else if(this.pinSupport&&['approve','refuse'].includes(state.phase)&&/^[A-F0-9]{12}$/i.test(input)&&await tx.call('telecom_pin_policy',[])){
    state.reference=input;state.decision=state.phase;state.phase='pin';
    reply=language==='fr'?'CON Saisissez votre PIN de 4 a 6 chiffres.\n0 Quitter':'CON Enter your 4-6 digit owner PIN.\n0 Exit';
   }else{
    const command=['plate','chassis'].includes(state.phase)?`CHECK ${state.phase.toUpperCase()} ${input}`:`${state.phase.toUpperCase()} ${input}`;
    reply='END '+await this.command(tx,phone,language,command,this.uuid(['ussd',p.sessionId,binding]));state.closed=true;
   }
   const result={reply,sends};state.hash=hash;state.length=parts.length;state.result=result;
   return {state,result};
  });
  // Intent committed before sending. A repeated callback replays the same intent;
  // the durable send ledger never resubmits uncertain external sends.
  for(const job of result.sends){await this.rate(phone,'otp-send',1,60000,job.key);await this.sender.send(job);}
  return result.reply.length<=this.maxReplyChars?result.reply:'END TEST: invalid input. Redial. Entree invalide. Recomposez le code.';
 }
 async event(token:string|undefined,type:string|undefined,body:unknown){
  verifyGateway(token,this.config.gatewayToken);const p=formBody(type,body);
  if(!messageIdPattern.test(p.sessionId??''))throw new BadRequestException({code:'INVALID_USSD_EVENT'});
  const key=this.cipher.hash(['ussd',this.config.providerAccount,p.sessionId]);
  await this.storage.transact(key,async state=>({state:{binding:state?.binding,closed:true,expires:0},result:null,ttl:60}));
 }
}

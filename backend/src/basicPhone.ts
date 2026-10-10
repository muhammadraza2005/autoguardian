import {CheckLookup,CheckResult,CheckService} from './checks';
import {BadRequestException,ForbiddenException} from '@nestjs/common';

export type SmsCommand={type:'help'}|{type:'check';lookup:CheckLookup}|{type:'status';id:string}|{type:'decision';id:string;decision:'approved'|'refused'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseSmsCommand(text:unknown):SmsCommand{
  if(typeof text!=='string'||text.length>512||/[\x00-\x1f\x7f]/.test(text))throw new BadRequestException({code:'INVALID_SMS_COMMAND'});
  const match=/^(HELP|CHECK|STATUS|APPROVE|REFUSE)(?:\s+(.+))?$/i.exec(text.trim());
  const invalid=()=>{throw new BadRequestException({code:'INVALID_SMS_COMMAND'});};
  if(!match)return invalid();const command=match[1].toUpperCase(),argument=match[2]?.trim();
  if(command==='HELP')return argument?invalid():{type:'help'};
  if(command==='CHECK'){
    const input=/^(PLATE|CHASSIS|SEAL)\s+(.+)$/i.exec(argument??'');
    if(!input||input[2].length>160||(input[1].toUpperCase()==='SEAL'&&!/^AG[A-F0-9]{32}$/.test(input[2])))return invalid();
    return {type:'check',lookup:{method:input[1].toLowerCase() as 'plate'|'chassis'|'seal',value:input[2].trim()}};
  }
  if(!argument||!uuid.test(argument))return invalid();
  return command==='STATUS'?{type:'status',id:argument.toLowerCase()}:{type:'decision',id:argument.toLowerCase(),decision:command==='APPROVE'?'approved':'refused'};
}
export const phoneHelp={en:'TEST: CHECK PLATE <plate>; CHECK CHASSIS <chassis>; CHECK SEAL <code>; STATUS <request>; APPROVE <request>; REFUSE <request>.',
  fr:'TEST : CHECK PLATE <plaque> ; CHECK CHASSIS <chassis> ; CHECK SEAL <code> ; STATUS <demande> ; APPROVE <demande> ; REFUSE <demande>.'};
function statusText(result:CheckResult,language:'en'|'fr'){
  const names={en:{pending:'Waiting for owner',approved:'Owner approved',refused:'Owner refused',timed_out:'No response'},
    fr:{pending:'En attente du proprietaire',approved:'Approuve par le proprietaire',refused:'Refuse par le proprietaire',timed_out:'Aucune reponse'}};
  return `TEST ${result.id}: ${result.expired?(language==='fr'?'Resultat expire':'Result expired'):names[language][result.outcome]}. `
    +(language==='fr'?'Consultez le statut actuel. Ceci n\'autorise aucune vente.':'Retrieve current status. This does not authorize a sale.');
}
// Deliberately no public HTTP webhook. A future gateway must establish a verified
// session/challenge; a caller-supplied sender number is NEVER sufficient.
export type SimulatedPrincipal={simulation:true;authUserId:string;language:'en'|'fr'};
export class SimulatedSmsAdapter{
  constructor(private readonly checks:Pick<CheckService,'create'|'read'|'decide'|'list'>){}
  async pending(principal:SimulatedPrincipal){
    if(principal.simulation!==true||!uuid.test(principal.authUserId))throw new ForbiddenException({code:'SIMULATED_SESSION_REQUIRED'});
    const page=await this.checks.list(principal.authUserId,true,null,2) as {items:{id:string}[]};
    return page.items.length?`TEST: ${page.items.map(r=>r.id).join('; ')}`:principal.language==='fr'?'TEST : aucune demande.':'TEST: no pending requests.';
  }
  async execute(principal:SimulatedPrincipal,message:unknown,idempotencyKey:string){
    if(principal.simulation!==true||!uuid.test(principal.authUserId)||!uuid.test(idempotencyKey))throw new ForbiddenException({code:'SIMULATED_SESSION_REQUIRED'});
    const command=parseSmsCommand(message);
    if(command.type==='help')return phoneHelp[principal.language];
    if(command.type==='check')return statusText(await this.checks.create(principal.authUserId,idempotencyKey,command.lookup),principal.language);
    if(command.type==='status')return statusText(await this.checks.read(principal.authUserId,command.id),principal.language);
    await this.checks.decide(principal.authUserId,command.id,command.decision);
    return principal.language==='fr'?'TEST : reponse enregistree.':'TEST: response recorded.';
  }
}
type UssdSession={principal:SimulatedPrincipal;expires:number;step:'menu'|'plate'|'chassis'|'status'|'approve'|'refuse';lastSequence:number;lastInput:string;lastReply:string;closed:boolean};
export class SimulatedUssdAdapter{
  private readonly sessions=new Map<string,UssdSession>();
  private readonly pending=new Map<string,Promise<string>>();
  constructor(private readonly sms:SimulatedSmsAdapter,private readonly now=()=>Date.now(),private readonly ttlMs=120000){
    if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>300000)throw new Error('Invalid simulated session TTL');
  }
  open(sessionId:string,principal:SimulatedPrincipal){
    if(!uuid.test(sessionId)||principal.simulation!==true||!uuid.test(principal.authUserId))throw new ForbiddenException({code:'SIMULATED_SESSION_REQUIRED'});
    for(const [id,s] of this.sessions)if(s.expires<=this.now())this.sessions.delete(id);
    if(this.sessions.has(sessionId)||this.sessions.size>=100)throw new BadRequestException({code:'USSD_SESSION_CONFLICT'});
    const menu=principal.language==='fr'?'CON 1 Plaque\n2 Chassis\n3 Statut\n4 Approuver\n5 Refuser\n6 Demandes\n0 Quitter':'CON 1 Plate\n2 Chassis\n3 Status\n4 Approve\n5 Refuse\n6 Pending requests\n0 Exit';
    this.sessions.set(sessionId,{principal,expires:this.now()+this.ttlMs,step:'menu',lastSequence:0,lastInput:'',lastReply:menu,closed:false});return menu;
  }
  async input(sessionId:string,principal:SimulatedPrincipal,sequence:number,input:string,key:string){
    const previous=this.pending.get(sessionId)??Promise.resolve('');
    const next=previous.catch(()=>'').then(()=>this.process(sessionId,principal,sequence,input,key));
    this.pending.set(sessionId,next);
    try{return await next;}finally{if(this.pending.get(sessionId)===next)this.pending.delete(sessionId);}
  }
  private async process(sessionId:string,principal:SimulatedPrincipal,sequence:number,input:string,key:string){
    const s=this.sessions.get(sessionId);
    if(!s||s.expires<=this.now()){this.sessions.delete(sessionId);throw new ForbiddenException({code:'USSD_SESSION_EXPIRED'});}
    if(principal.simulation!==true||s.principal.authUserId!==principal.authUserId)throw new ForbiddenException({code:'SIMULATED_SESSION_REQUIRED'});
    if(sequence===s.lastSequence&&input===s.lastInput)return s.lastReply;
    if(s.closed||sequence!==s.lastSequence+1||input.length>160||/[\x00-\x1f\x7f]/.test(input))throw new BadRequestException({code:'USSD_INVALID_SEQUENCE'});
    let reply:string;
    if(input==='0'){reply='END';s.closed=true;}
    else if(s.step==='menu'&&input==='6'){reply='END '+await this.sms.pending(s.principal);s.closed=true;}
    else if(s.step==='menu'){
      const steps={'1':'plate','2':'chassis','3':'status','4':'approve','5':'refuse'} as const;
      const step=steps[input as keyof typeof steps];
      if(!step)reply=s.lastReply;else{s.step=step;reply=s.principal.language==='fr'?'CON Saisissez la plaque, le chassis ou la reference de demande.':'CON Enter plate, chassis or full request reference.';}
    }else{
      const command=s.step==='plate'||s.step==='chassis'?`CHECK ${s.step.toUpperCase()} ${input}`:`${s.step.toUpperCase()} ${input}`;
      reply='END '+await this.sms.execute(s.principal,command,key);s.closed=true;
    }
    s.lastSequence=sequence;s.lastInput=input;s.lastReply=reply;return reply;
  }
}

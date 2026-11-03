import {Pool} from 'pg';
import {AfricasTalkingSmsProvider,enabled,smsConfiguration} from './sms';
import {TelecomCipher,PostgresDispatchStorage,PostgresTelecomStorage,DurableTelecomSender,telecomKey} from './telecomStore';
import {AfricasTalkingChannels} from './telecomChannels';
import {hookSecrets,SupabaseSmsHook} from './smsHook';
import {TelecomServices} from './telecomControllers';
import {OwnerPinService,OwnerPinStore} from './ownerPin';
import {RelationshipService} from './relationships';
import {PostgresWorkflowStore} from './checks';

export function configuredTelecom(env:NodeJS.ProcessEnv,pool:Pool,tenant:string):TelecomServices|undefined{
 const channels=enabled(env,'AFRICASTALKING_CHANNELS_ENABLED'),hook=enabled(env,'SUPABASE_SMS_HOOK_ENABLED'),pin=enabled(env,'OWNER_PIN_ENABLED');
 const relationships=enabled(env,'AUTOGUARDIAN_RELATIONSHIPS_ENABLED');
 if(!channels&&!hook&&!pin&&!relationships)return undefined;
 const config=smsConfiguration(env);if(!config)throw new Error('Telecom channels/hooks require Africa Talking SMS configuration.');
 const cipher=new TelecomCipher(telecomKey(env),tenant),storage=new PostgresTelecomStorage(pool,tenant,cipher);
 const sender=new DurableTelecomSender(new PostgresDispatchStorage(pool,tenant),new AfricasTalkingSmsProvider(config),cipher);
 const serviceCode=env.AFRICASTALKING_USSD_SERVICE_CODE??'',shortcode=env.AFRICASTALKING_SMS_SHORTCODE??'';
 if(channels&&(!/^\*[0-9*]{1,30}#$/.test(serviceCode)||!/^\d{3,15}$/.test(shortcode)))throw new Error('Configure Africa Talking USSD service code and two-way SMS shortcode.');
 const replyLimit=Number(env.AFRICASTALKING_USSD_MAX_REPLY_CHARS??160);
 return {channels:channels?new AfricasTalkingChannels(config,serviceCode,shortcode,storage,cipher,sender,undefined,undefined,replyLimit,pin):undefined,
  hook:hook?new SupabaseSmsHook(hookSecrets(env.SUPABASE_SMS_HOOK_SECRET??''),config,cipher,storage,sender):undefined,
  pin:pin?new OwnerPinService(new OwnerPinStore(pool,tenant),cipher,sender):undefined,
  relationships:relationships?new RelationshipService(new PostgresWorkflowStore(pool,tenant),cipher,sender):undefined};
}

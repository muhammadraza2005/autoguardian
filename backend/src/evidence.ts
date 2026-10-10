import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, PayloadTooLargeException,
  ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { Pool, PoolClient } from 'pg';
export const EVIDENCE_MAX=2097152;
export const EVIDENCE_BUCKET='development-enrollment-evidence';
export const evidencePhotoKinds=['VEHICLE_PHOTO','SEAL_FITTING_PHOTO','VEHICLE_FRONT','VEHICLE_REAR',
  'VEHICLE_LEFT','VEHICLE_RIGHT','CHASSIS_PHOTO','PLATE_PHOTO'] as const;
export const evidenceKinds=['OWNER_ID','REGISTRATION_DOCUMENT','PURCHASE_PROOF',...evidencePhotoKinds] as const;
type Kind=typeof evidenceKinds[number];
type Metadata={id:string;kind:Kind;mimeType:string;byteSize:number;status:'PENDING'|'STAGED';createdAt:string};
type ReviewInput={expectedDraftRevision:number;expectedReviewRevision:number;decision:'ACCEPTED_SAMPLE'|'NEEDS_CORRECTION';
  reason:null|'BLURRY'|'INCOMPLETE'|'WRONG_DOCUMENT'|'DETAILS_MISMATCH'};
type Reviews={version:1;draftId:string;draftRevision:number;sampleOnly:true;productionApproved:false;canSubmit:false;
  items:{attachmentId:string;kind:Kind;uploadStatus:'PENDING'|'STAGED';reviewRevision:number;
    decision:'NOT_REVIEWED'|'ACCEPTED_SAMPLE'|'NEEDS_CORRECTION';reason:ReviewInput['reason'];reviewedAt:string|null}[]};
export function evidenceReviewInput(body:unknown):ReviewInput {
  const invalid=()=>new BadRequestException({code:'INVALID_EVIDENCE_REVIEW'});
  if(!body || typeof body!=='object' || Array.isArray(body)
    || Object.keys(body).length!==4 || Object.keys(body).some(k=>!['expectedDraftRevision','expectedReviewRevision','decision','reason'].includes(k))) throw invalid();
  const value=body as ReviewInput;
  if(!Number.isSafeInteger(value.expectedDraftRevision) || value.expectedDraftRevision<1 || value.expectedDraftRevision>2147483647
    || !Number.isSafeInteger(value.expectedReviewRevision) || value.expectedReviewRevision<0 || value.expectedReviewRevision>=2147483647
    || !['ACCEPTED_SAMPLE','NEEDS_CORRECTION'].includes(value.decision)
    || (value.decision==='ACCEPTED_SAMPLE' ? value.reason!==null
      : !['BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH'].includes(value.reason??''))) throw invalid();
  return value;
}
type RecordRow={id:string;tenant_id:string;draft_id:string;owner_profile_id:string;kind:Kind;mime_type:string;byte_size:number;
  sha256:string;object_path:string;status:'PENDING'|'STAGED';created_at:string};
const unavailable=()=>new ServiceUnavailableException({code:'EVIDENCE_UNAVAILABLE'});
export const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const aad=(row:RecordRow)=>Buffer.from(JSON.stringify([row.tenant_id,row.draft_id,row.owner_profile_id,row.id,row.kind,row.mime_type,row.byte_size,row.sha256]));
export function evidenceCipher(key:Buffer) {
  if(key.length!==32) throw new Error('Evidence encryption key must contain 32 bytes.');
  return {
    encrypt(bytes:Buffer,row:RecordRow) {
      const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(row));
      const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
      return Buffer.concat([Buffer.from('AG01'),nonce,cipher.getAuthTag(),encrypted]);
    },
    decrypt(bytes:Buffer,row:RecordRow) {
      if(bytes.length<33 || bytes.length>EVIDENCE_MAX+32 || bytes.subarray(0,4).toString()!=='AG01') throw unavailable();
      try {
        const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));
        cipher.setAAD(aad(row));cipher.setAuthTag(bytes.subarray(16,32));
        const plain=Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]);
        if(plain.length!==row.byte_size || digest(plain)!==row.sha256) throw unavailable();
        return plain;
      } catch {throw unavailable();}
    },
  };
}
export async function evidenceInput(body:unknown) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['kind','dataBase64','uploadContext'].includes(k))) {
    throw new BadRequestException({code:'INVALID_EVIDENCE'});
  }
  const {kind,dataBase64,uploadContext}=body as {kind:Kind;dataBase64:string;uploadContext?:UploadContext};
  if(uploadContext!==undefined && (!uploadContext || typeof uploadContext!=='object' || Array.isArray(uploadContext)
    || Object.keys(uploadContext).length!==2 || Object.keys(uploadContext).some(k=>!['draftRevision','ownerGeneration'].includes(k))
    || !Number.isInteger(uploadContext.draftRevision) || uploadContext.draftRevision<1 || uploadContext.draftRevision>2147483647
    || !Number.isInteger(uploadContext.ownerGeneration) || uploadContext.ownerGeneration<1 || uploadContext.ownerGeneration>2147483647)) {
    throw new BadRequestException({code:'INVALID_UPLOAD_CONTEXT'});
  }
  if(!evidenceKinds.includes(kind) || typeof dataBase64!=='string') throw new BadRequestException({code:'INVALID_EVIDENCE'});
  if(dataBase64.length>Math.ceil(EVIDENCE_MAX/3)*4) throw new PayloadTooLargeException({code:'EVIDENCE_TOO_LARGE'});
  if(!dataBase64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    throw new BadRequestException({code:'INVALID_EVIDENCE'});
  }
  const raw=Buffer.from(dataBase64,'base64');
  if(!raw.length || raw.length>EVIDENCE_MAX || raw.toString('base64')!==dataBase64) throw new BadRequestException({code:'INVALID_EVIDENCE'});
  let bytes:Buffer;let mime:string;
  if(raw.subarray(0,5).toString()==='%PDF-') {
    if((evidencePhotoKinds as readonly string[]).includes(kind) || !/%%EOF\s*$/.test(raw.subarray(-1024).toString('latin1'))
      || /\/(JavaScript|JS|Launch|EmbeddedFiles|RichMedia|Encrypt)\b/i.test(raw.toString('latin1'))) {
      throw new BadRequestException({code:'INVALID_EVIDENCE'});
    }
    // Signature/content screening only, not malware clearance. PDFs remain staged.
    bytes=raw;mime='application/pdf';
  } else {
    try {
      const image=sharp(raw,{limitInputPixels:20000000,animated:false,failOn:'warning'});
      const meta=await image.metadata();
      if(!['jpeg','png'].includes(meta.format??'') || (meta.pages??1)>1) throw new Error();
      // Re-encoding drops EXIF/GPS and other metadata; never call withMetadata().
      bytes=await image.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
      mime='image/jpeg';
    } catch {throw new BadRequestException({code:'INVALID_EVIDENCE'});}
  }
  if(bytes.length>EVIDENCE_MAX) throw new PayloadTooLargeException({code:'EVIDENCE_TOO_LARGE'});
  return {kind,bytes,mime,sha:digest(bytes),...(uploadContext?{uploadContext}: {})};
}
type UploadContext={draftRevision:number;ownerGeneration:number};
export interface EvidenceStorage {check():Promise<void>;put(path:string,bytes:Buffer):Promise<void>;get(path:string):Promise<Buffer>}
export class SupabaseEvidenceStorage implements EvidenceStorage {
  private readonly client:SupabaseClient;
  constructor(url:string,secret:string) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:' || !parsed.hostname.endsWith('.supabase.co') || !secret.startsWith('sb_secret_')) {
      throw new Error('Evidence storage needs the hosted Supabase URL and a server-only secret key.');
    }
    this.client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
  }
  async check() {
    const {data,error}=await this.client.storage.getBucket(EVIDENCE_BUCKET);
    if(error || !data || data.public || data.file_size_limit!==EVIDENCE_MAX+64
      || data.allowed_mime_types?.length!==1 || data.allowed_mime_types[0]!=='application/octet-stream') throw unavailable();
  }
  async put(path:string,bytes:Buffer) {
    const {error}=await this.client.storage.from(EVIDENCE_BUCKET).upload(path,bytes,{contentType:'application/octet-stream',upsert:false});
    if(error && String((error as unknown as {statusCode?:string}).statusCode)!=='409') throw unavailable();
    // Existing objects are not overwritten; the service verifies their contents before finalizing.
  }
  async get(path:string) {
    const {data,error}=await this.client.storage.from(EVIDENCE_BUCKET).download(path);
    if(error || !data || data.size>EVIDENCE_MAX+64) throw unavailable();
    return Buffer.from(await data.arrayBuffer());
  }
}
export class PostgresEvidenceStore {
  constructor(private readonly pool:Pool,private readonly tenantId:string) {}
  list(actor:string,id:string):Promise<{items:Metadata[];evidenceChecklist:{version:number;complete:boolean;items:{code:string;status:string}[]}}> {
    return this.call(actor,'enrollment_attachment_list',[id]);
  }
  reserve(actor:string,id:string,key:string,input:Awaited<ReturnType<typeof evidenceInput>>):Promise<RecordRow> {
    if(input.uploadContext) return this.call(actor,'enrollment_attachment_reserve_bound',
      [id,key,input.kind,input.mime,input.bytes.length,input.sha,input.uploadContext.draftRevision,input.uploadContext.ownerGeneration]);
    return this.call(actor,'enrollment_attachment_reserve',[id,key,input.kind,input.mime,input.bytes.length,input.sha]);
  }
  finish(actor:string,id:string,key:string,context?:UploadContext):Promise<Metadata> {
    return context?this.call(actor,'enrollment_attachment_finish_bound',[id,key,context.draftRevision,context.ownerGeneration])
      :this.call(actor,'enrollment_attachment_finish',[id,key]);
  }
  async nativeContext(actor:string,id:string):Promise<UploadContext|null> {
    try {return await this.call(actor,'native_evidence_upload_context',[id]);}
    catch(error) {if(error instanceof ServiceUnavailableException
      && (error.getResponse() as {code?:string}).code==='EVIDENCE_SETUP_REQUIRED')return null;throw error;}
  }
  read(actor:string,id:string,key:string):Promise<RecordRow> {return this.call(actor,'enrollment_attachment_read',[id,key,'ENROLLMENT_REVIEW']);}
  reviews(actor:string,id:string):Promise<Reviews> {return this.call(actor,'development_evidence_reviews_read',[id]);}
  saveReview(actor:string,id:string,attachment:string,key:string,input:ReviewInput):Promise<Reviews> {
    return this.call(actor,'save_development_evidence_review',[id,attachment,key,input.expectedDraftRevision,
      input.expectedReviewRevision,input.decision,input.reason]);
  }
  private async call<T>(actor:string,name:string,params:unknown[]):Promise<T> {
    const client:PoolClient=await this.pool.connect();
    try {
      await client.query('begin');await client.query('set local role autoguardian_enrollment_api');
      await client.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)",[this.tenantId,actor]);
      const allowed=await client.query('select private.enrollment_agent_id(null) as actor');
      if(!allowed.rows[0].actor) throw new ForbiddenException({code:'AGENT_ACCESS_REQUIRED'});
      const result=await client.query(`select private.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) as result`,params);
      await client.query('commit');return result.rows[0].result;
    } catch(error) {
      await client.query('rollback');const code=(error as {code?:string}).code;
      if(code==='AG404') throw new NotFoundException({code:'EVIDENCE_NOT_FOUND'});
      if(code==='AG403') throw new ForbiddenException({code:'AGENT_ACCESS_REQUIRED'});
      if(code==='AG409' || code==='23505') throw new ConflictException({code:'EVIDENCE_CONFLICT'});
      if(code==='42883' || code==='42P01') throw new ServiceUnavailableException({code:'EVIDENCE_SETUP_REQUIRED'});
      if(code==='AG422') throw new UnprocessableEntityException({code:'OWNER_PROFILE_UNAVAILABLE'});
      if(code==='AG400' || code==='23514') throw new BadRequestException({code:'INVALID_EVIDENCE'});
      throw error;
    } finally {client.release();}
  }
}
export class EvidenceService {
  constructor(private readonly store:PostgresEvidenceStore,private readonly storage?:EvidenceStorage,
    private readonly cipher?:ReturnType<typeof evidenceCipher>) {}
  async reviews(actor:string,id:string) {return this.validReviews(await this.store.reviews(actor,id));}
  async saveReview(actor:string,id:string,attachment:string,key:string,body:unknown) {
    return this.validReviews(await this.store.saveReview(actor,id,attachment,key,evidenceReviewInput(body)));
  }
  private validReviews(value:Reviews) {
    if(value.version!==1 || value.sampleOnly!==true || value.productionApproved!==false || value.canSubmit!==false)
      throw new ServiceUnavailableException({code:'EVIDENCE_SETUP_REQUIRED'});
    return value;
  }
  async list(actor:string,id:string) {
    const result=await this.store.list(actor,id);
    if(result.evidenceChecklist?.version!==1) throw new ServiceUnavailableException({code:'EVIDENCE_SETUP_REQUIRED'});
    let enabled=false;
    if(this.storage && this.cipher) {try {await this.storage.check();enabled=true;} catch { /* Keep setup failures generic. */ }}
    const nativeUploadContext=await this.store.nativeContext(actor,id);
    return {...result,uploadsEnabled:enabled,nativeUploadContext,sampleOnly:true,maxBytes:EVIDENCE_MAX};
  }
  async upload(actor:string,id:string,key:string,body:unknown) {
    if(!this.storage || !this.cipher) throw unavailable();
    // Check draft authorization before parsing or handing bytes to privileged Storage.
    const saved=await this.store.list(actor,id);
    if(saved.evidenceChecklist?.version!==1) throw new ServiceUnavailableException({code:'EVIDENCE_SETUP_REQUIRED'});
    await this.storage.check();
    const input=await evidenceInput(body);const row=await this.store.reserve(actor,id,key,input);
    if(row.status!=='STAGED') {
      await this.storage.put(row.object_path,this.cipher.encrypt(input.bytes,row));
    }
    // Read-back proves the stored ciphertext decrypts to this exact scoped payload.
    this.cipher.decrypt(await this.storage.get(row.object_path),row);
    return {attachment:await this.store.finish(actor,id,key,input.uploadContext)};
  }
  async read(actor:string,id:string,key:string,body:unknown) {
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1
      || (body as {reason?:unknown}).reason!=='ENROLLMENT_REVIEW') throw new BadRequestException({code:'READ_REASON_REQUIRED'});
    if(!this.storage || !this.cipher) throw unavailable();
    const row=await this.store.read(actor,id,key); // Commits an audit entry before object access.
    return this.readReviewRecord(row);
  }
  async readReviewRecord(row:RecordRow) {
    if(!this.storage || !this.cipher) throw unavailable();
    await this.storage.check();const bytes=this.cipher.decrypt(await this.storage.get(row.object_path),row);
    return {id:row.id,mimeType:row.mime_type,dataBase64:bytes.toString('base64')};
  }
}
export function configuredEvidence(env:NodeJS.ProcessEnv,store:PostgresEvidenceStore,development:boolean) {
  if(!development || !env.SUPABASE_STORAGE_SECRET_KEY?.trim()) return new EvidenceService(store);
  if(!/^[0-9a-f]{64}$/i.test(env.ENROLLMENT_EVIDENCE_KEY_HEX??'')) throw new Error('Configure ENROLLMENT_EVIDENCE_KEY_HEX before enabling uploads.');
  const cipher=evidenceCipher(Buffer.from(env.ENROLLMENT_EVIDENCE_KEY_HEX!,'hex'));
  return new EvidenceService(store,new SupabaseEvidenceStorage(env.SUPABASE_URL!,env.SUPABASE_STORAGE_SECRET_KEY.trim()),cipher);
}

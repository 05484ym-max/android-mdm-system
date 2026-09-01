require('dotenv').config();
const express=require('express');
const path=require('path');
const db=require('./db');
const {normalizeScan}=require('./lib/normalize');
const {decide}=require('./lib/decision');
const {listMdmDevices}=require('./lib/mdmSync');
const {buildFlashPlan}=require('./lib/preflight');

const app=express();
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'admin-panel')));
const key=process.env.LAB_ADMIN_KEY;
const bridgeKey=process.env.LAB_MDM_BRIDGE_KEY||null;
if(!key){console.error('FATAL: LAB_ADMIN_KEY is required');process.exit(1)}
function auth(req,res,next){
 const supplied=req.get('x-lab-key')||(req.get('authorization')||'').replace(/^Bearer\s+/,'');
 if(supplied!==key)return res.status(401).json({error:'unauthorized'}); next();
}
function bridgeAuth(req,res,next){
 if(!bridgeKey)return res.status(503).json({error:'bridge not configured'});
 if(req.get('x-mdm-bridge-key')!==bridgeKey)return res.status(401).json({error:'unauthorized'});
 next();
}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

function approvedFlashProfileErrors(body){
 const p=body?.profile||{};
 if((body?.status||'REVIEW')!=='APPROVED') return [];
 const errors=[];
 if(!p.familyFingerprint) errors.push('familyFingerprint required');
 if(!Array.isArray(p.allowedExactFingerprints)||p.allowedExactFingerprints.length===0) errors.push('allowedExactFingerprints required');
 if(!Array.isArray(p.codenames)||p.codenames.length===0) errors.push('codenames required');
 if(!p.targetFirmware||p.targetFirmware==='TBD') errors.push('targetFirmware required');
 if(!p.requiredTool||p.requiredTool==='TBD') errors.push('requiredTool required');
 if(!p.requiredHostOs||p.requiredHostOs==='TBD') errors.push('requiredHostOs required');
 if(!p.requiredBootMode||p.requiredBootMode==='TBD') errors.push('requiredBootMode required');
 if(!p.antiRollbackConstraints||p.antiRollbackConstraints==='UNKNOWN') errors.push('antiRollbackConstraints required');
 if(!Array.isArray(p.files)||p.files.length===0) errors.push('files required');
 else if(p.files.some(f=>!f?.name||!/^[a-f0-9]{64}$/i.test(String(f.sha256||'')))) errors.push('all files need name + SHA-256');
 if(!Array.isArray(p.steps)||p.steps.length===0) errors.push('steps required');
 if(!Array.isArray(p.postFlash)||p.postFlash.length===0) errors.push('postFlash required');
 return errors;
}
async function classify(normalized){
 const [families,flashProfiles,compatibilityProfiles]=await Promise.all([
  db.listFamilies(),db.listFlashProfiles(),db.listCompatibilityProfiles()
 ]);
 const mapped=families.map(f=>({id:f.id,displayName:f.display_name,manufacturer:f.manufacturer,brand:f.brand,
  device:f.device,board:f.board,hardware:f.hardware,platform:f.platform,
  familyFingerprint:f.family_fingerprint,status:f.status}));
 return decide(normalized,mapped,flashProfiles,compatibilityProfiles);
}
app.get('/health',(req,res)=>res.json({status:'ok',service:'device-lab'}));
app.post('/api/lab/scans',auth,wrap(async(req,res)=>{
 const normalized=normalizeScan(req.body||{});
 const row=await db.createScan(req.body,normalized,req.body.source||'scanner');
 const decision=await classify(normalized); await db.saveDecision(row.id,decision);
 res.status(201).json({id:row.id,normalized,decision});
}));
app.get('/api/lab/scans',auth,wrap(async(req,res)=>res.json(await db.listScans())));
app.get('/api/lab/scans/:id',auth,wrap(async(req,res)=>{
 const row=await db.getScan(req.params.id); if(!row)return res.status(404).json({error:'not found'}); res.json(row);
}));
app.post('/api/lab/scans/:id/reclassify',auth,wrap(async(req,res)=>{
 const row=await db.getScan(req.params.id); if(!row)return res.status(404).json({error:'not found'});
 const decision=await classify(row.normalized); await db.saveDecision(row.id,decision); res.json(decision);
}));
app.post('/api/lab/scans/:id/link-mdm',auth,wrap(async(req,res)=>{
 if(!req.body.deviceId)return res.status(400).json({error:'deviceId required'});
 const deviceId=String(req.body.deviceId);
 if(process.env.MDM_DATABASE_URL){
   const devices=await listMdmDevices();
   if(!devices.some(d=>String(d.deviceId)===deviceId)) return res.status(404).json({error:'MDM device not found'});
 }
 const row=await db.linkMdm(req.params.id,deviceId);
 if(!row)return res.status(404).json({error:'scan not found'}); res.json({status:'linked',deviceId});
}));
app.get('/api/lab/scans/:id/flash-plan',auth,wrap(async(req,res)=>{
 const row=await db.getScan(req.params.id); if(!row)return res.status(404).json({error:'not found'});
 const profileId=row.decision?.flashProfileId;
 if(!profileId)return res.json(buildFlashPlan(row.normalized,row.decision,null));
 const flashProfile=await db.getFlashProfile(profileId);
 res.json(buildFlashPlan(row.normalized,row.decision,flashProfile));
}));
app.post('/api/lab/scans/:id/promote-family',auth,wrap(async(req,res)=>{
 const row=await db.getScan(req.params.id); if(!row)return res.status(404).json({error:'not found'});
 const n=row.normalized||{};
 const family=await db.createFamily({
  displayName:req.body.displayName||[n.manufacturer,n.model,n.device].filter(Boolean).join(' ')||'משפחה חדשה',
  manufacturer:n.manufacturer,brand:n.brand,device:n.device,board:n.board,hardware:n.hardware,platform:n.platform,
  familyFingerprint:n.familyFingerprint,status:'REVIEW',notes:'נוצר אוטומטית מסריקה '+row.id
 });
 const decision=await classify(n); await db.saveDecision(row.id,decision);
 res.status(201).json({family,decision});
}));
app.get('/api/lab/families',auth,wrap(async(req,res)=>res.json(await db.listFamilies())));
app.post('/api/lab/families',auth,wrap(async(req,res)=>{
 if(!req.body.displayName)return res.status(400).json({error:'displayName required'});
 res.status(201).json(await db.createFamily(req.body));
}));
app.get('/api/lab/compatibility-profiles',auth,wrap(async(req,res)=>res.json(await db.listCompatibilityProfiles())));
app.post('/api/lab/compatibility-profiles',auth,wrap(async(req,res)=>{
 if(!req.body.familyId||!req.body.name)return res.status(400).json({error:'familyId and name required'});
 res.status(201).json(await db.createCompatibilityProfile(req.body));
}));
app.get('/api/lab/flash-profiles',auth,wrap(async(req,res)=>res.json(await db.listFlashProfiles())));
app.post('/api/lab/flash-profiles',auth,wrap(async(req,res)=>{
 if(!req.body.familyId||!req.body.name)return res.status(400).json({error:'familyId and name required'});
 const errors=approvedFlashProfileErrors(req.body);
 if(errors.length)return res.status(400).json({error:'approved flash profile is incomplete',details:errors});
 res.status(201).json(await db.createFlashProfile(req.body));
}));
app.get('/api/lab/mdm/devices',auth,wrap(async(req,res)=>res.json(await listMdmDevices())));
app.get('/api/lab/audit',auth,wrap(async(req,res)=>res.json(await db.listAudit())));
app.get('/api/bridge/mdm/:deviceId/compatibility',bridgeAuth,wrap(async(req,res)=>{
 const row=await db.getMdmCompatibility(String(req.params.deviceId));
 if(!row)return res.status(404).json({error:'no linked compatibility data'});
 res.json({
  deviceId:String(req.params.deviceId),
  scanId:row.scan_id,
  scannedAt:row.created_at,
  normalized:row.normalized,
  decision:row.decision,
  compatibilityProfile:row.compatibility_profile_id?{
   id:row.compatibility_profile_id,name:row.compatibility_profile_name,
   status:row.compatibility_profile_status,profile:row.compatibility_profile
  }:null
 });
}));
app.use((req,res,next)=>{ if(req.method==='GET'&&!req.path.startsWith('/api/')) return res.sendFile(path.join(__dirname,'admin-panel/index.html')); next(); });
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'internal error'})});
const port=Number(process.env.PORT||3100);
db.init().then(()=>app.listen(port,()=>console.log('Device Lab listening on',port)))
 .catch(err=>{console.error(err);process.exit(1)});

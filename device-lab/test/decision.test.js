const test=require('node:test');
const assert=require('node:assert/strict');
const {decide}=require('../lib/decision');
const {scoreFamily,flashProfileMatches}=require('../lib/matcher');
const {buildFlashPlan}=require('../lib/preflight');

const scan={device:'foo',board:'b',hardware:'h',platform:'p',manufacturer:'X',
 familyFingerprint:'fam',exactFingerprint:'exact',provisioningAllowed:false};
const family={id:'f1',device:'foo',board:'b',hardware:'h',platform:'p',manufacturer:'X',familyFingerprint:'fam'};

test('unknown hardware never becomes flashable',()=>{
 const d=decide({...scan,device:'other',familyFingerprint:'other'},[family],[],[]);
 assert.notEqual(d.status,'SUPPORTED_NEEDS_FLASH');
});

test('single matching field is never HIGH confidence',()=>{
 const s={manufacturer:'X'};
 const f={id:'f',manufacturer:'X'};
 assert.equal(scoreFamily(s,f).confidence,'LOW');
});

test('hard hardware mismatch forces LOW confidence',()=>{
 const s={...scan,device:'different'};
 const result=scoreFamily(s,family);
 assert.equal(result.confidence,'LOW');
 assert.equal(result.hardMismatch,'device');
});

test('approved flash profile must be exact-scoped',()=>{
 const broad={id:'p',familyId:'f1',status:'APPROVED'};
 assert.equal(flashProfileMatches(scan,broad).ok,false);
});

test('approved exact profile may produce flash decision',()=>{
 const fp={id:'p1',familyId:'f1',status:'APPROVED',familyFingerprint:'fam',allowedExactFingerprints:['exact'],codenames:['foo']};
 const d=decide(scan,[family],[fp],[]);
 assert.equal(d.status,'SUPPORTED_NEEDS_FLASH');
 assert.equal(d.confidence,'HIGH');
});

test('preflight hides instructions when anti rollback unknown',()=>{
 const d={status:'SUPPORTED_NEEDS_FLASH',confidence:'HIGH',flashProfileId:'p1'};
 const p={id:'p1',familyId:'f1',status:'APPROVED',profile:{
  familyFingerprint:'fam',allowedExactFingerprints:['exact'],codenames:['foo'],
  targetFirmware:'v1',requiredTool:'tool',requiredHostOs:'WINDOWS',requiredBootMode:'FASTBOOT',
  antiRollbackConstraints:'UNKNOWN',files:[{name:'rom.bin',sha256:'a'.repeat(64)}],
  steps:['flash'],postFlash:['verify']
 }};
 const plan=buildFlashPlan(scan,d,p);
 assert.equal(plan.safeToShowInstructions,false);
 assert.ok(plan.blocks.includes('anti_rollback_unknown'));
 assert.deepEqual(plan.steps,[]);
});

test('preflight requires at least one checksummed flash file',()=>{
 const d={status:'SUPPORTED_NEEDS_FLASH',confidence:'HIGH',flashProfileId:'p1'};
 const p={id:'p1',familyId:'f1',status:'APPROVED',profile:{
  familyFingerprint:'fam',allowedExactFingerprints:['exact'],codenames:['foo'],
  targetFirmware:'v1',requiredTool:'tool',requiredHostOs:'WINDOWS',requiredBootMode:'FASTBOOT',
  antiRollbackConstraints:'SAFE',files:[],steps:['flash'],postFlash:['verify']
 }};
 const plan=buildFlashPlan(scan,d,p);
 assert.equal(plan.safeToShowInstructions,false);
 assert.ok(plan.blocks.includes('flash_files_missing'));
});

test('fully scoped approved profile may expose instructions',()=>{
 const d={status:'SUPPORTED_NEEDS_FLASH',confidence:'HIGH',flashProfileId:'p1'};
 const p={id:'p1',familyId:'f1',status:'APPROVED',profile:{
  familyFingerprint:'fam',allowedExactFingerprints:['exact'],codenames:['foo'],
  targetFirmware:'v1',requiredTool:'tool',requiredHostOs:'WINDOWS',requiredBootMode:'FASTBOOT',
  antiRollbackConstraints:'SAFE',files:[{name:'rom.bin',sha256:'a'.repeat(64)}],
  steps:['flash'],postFlash:['verify']
 }};
 const plan=buildFlashPlan(scan,d,p);
 assert.equal(plan.safeToShowInstructions,true);
 assert.deepEqual(plan.steps,['flash']);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const {decide}=require('../lib/decision');
const {buildFlashPlan}=require('../lib/preflight');

const scan={device:'foo',board:'b',hardware:'h',platform:'p',manufacturer:'X',
 familyFingerprint:'fam',exactFingerprint:'exact',provisioningAllowed:false};
const family={id:'f1',device:'foo',board:'b',hardware:'h',platform:'p',manufacturer:'X',familyFingerprint:'fam'};

test('unknown hardware never becomes flashable',()=>{
 const d=decide({...scan,device:'other',familyFingerprint:'other'},[family],[],[]);
 assert.notEqual(d.status,'SUPPORTED_NEEDS_FLASH');
});

test('approved exact profile may produce flash decision',()=>{
 const fp={id:'p1',familyId:'f1',status:'APPROVED',familyFingerprint:'fam',allowedExactFingerprints:['exact'],codenames:['foo']};
 const d=decide(scan,[family],[fp],[]);
 assert.equal(d.status,'SUPPORTED_NEEDS_FLASH');
 assert.equal(d.confidence,'HIGH');
});

test('preflight hides instructions when anti rollback unknown',()=>{
 const d={status:'SUPPORTED_NEEDS_FLASH',confidence:'HIGH'};
 const p={status:'APPROVED',profile:{targetFirmware:'v1',requiredTool:'tool',antiRollbackConstraints:'UNKNOWN',steps:['flash']}};
 const plan=buildFlashPlan(scan,d,p);
 assert.equal(plan.safeToShowInstructions,false);
 assert.deepEqual(plan.steps,[]);
});

const {Pool}=require('pg');
const crypto=require('crypto');
const pool=new Pool({
  connectionString:process.env.LAB_DATABASE_URL,
  ssl:process.env.LAB_DATABASE_SSL==='disable'?false:{rejectUnauthorized:true},
  max:5
});
const SCHEMA=`
CREATE TABLE IF NOT EXISTS lab_device_scans(
 id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),source TEXT NOT NULL DEFAULT 'scanner',
 raw JSONB NOT NULL,normalized JSONB NOT NULL,exact_fingerprint TEXT,family_fingerprint TEXT,
 decision JSONB,linked_mdm_device_id TEXT,notes TEXT);
CREATE INDEX IF NOT EXISTS lab_scans_exact_idx ON lab_device_scans(exact_fingerprint);
CREATE INDEX IF NOT EXISTS lab_scans_family_idx ON lab_device_scans(family_fingerprint);

CREATE TABLE IF NOT EXISTS lab_hardware_families(
 id UUID PRIMARY KEY,display_name TEXT NOT NULL,manufacturer TEXT,brand TEXT,device TEXT,board TEXT,
 hardware TEXT,platform TEXT,family_fingerprint TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'REVIEW',
 notes TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS lab_firmware_builds(
 id UUID PRIMARY KEY,family_id UUID REFERENCES lab_hardware_families(id) ON DELETE CASCADE,
 build_fingerprint TEXT,build_id TEXT,android_version TEXT,api_level INTEGER,region TEXT,
 status TEXT NOT NULL DEFAULT 'REVIEW',notes TEXT,UNIQUE(family_id,build_fingerprint));

CREATE TABLE IF NOT EXISTS lab_compatibility_profiles(
 id UUID PRIMARY KEY,family_id UUID REFERENCES lab_hardware_families(id) ON DELETE CASCADE,
 name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'REVIEW',profile JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS lab_flash_profiles(
 id UUID PRIMARY KEY,family_id UUID REFERENCES lab_hardware_families(id) ON DELETE CASCADE,
 name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'REVIEW',profile JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS lab_flash_files(
 id UUID PRIMARY KEY,flash_profile_id UUID REFERENCES lab_flash_profiles(id) ON DELETE CASCADE,
 name TEXT NOT NULL,source_url TEXT,sha256 TEXT NOT NULL,size_bytes BIGINT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS lab_host_tools(
 id UUID PRIMARY KEY,name TEXT NOT NULL,version TEXT,host_os TEXT,driver_required BOOLEAN NOT NULL DEFAULT false,
 oem_auth_required BOOLEAN NOT NULL DEFAULT false,notes TEXT);

CREATE TABLE IF NOT EXISTS lab_test_results(
 id UUID PRIMARY KEY,scan_id UUID REFERENCES lab_device_scans(id) ON DELETE CASCADE,
 test_name TEXT NOT NULL,status TEXT NOT NULL,details JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS lab_flash_sessions(
 id UUID PRIMARY KEY,scan_id UUID REFERENCES lab_device_scans(id),flash_profile_id UUID REFERENCES lab_flash_profiles(id),
 status TEXT NOT NULL DEFAULT 'PLANNED',preflight JSONB,result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS lab_audit_log(
 id UUID PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),actor TEXT,action TEXT NOT NULL,
 entity_type TEXT,entity_id TEXT,details JSONB);
`;
const id=()=>crypto.randomUUID();
async function init(){await pool.query(SCHEMA)}
async function audit(action,entityType,entityId,details,actor='admin'){
 await pool.query('INSERT INTO lab_audit_log(id,actor,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
 [id(),actor,action,entityType,entityId,details||{}]);
}
async function createScan(raw,normalized,source='scanner'){
 const scanId=id();
 const {rows}=await pool.query(`
  INSERT INTO lab_device_scans(id,source,raw,normalized,exact_fingerprint,family_fingerprint)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
 [scanId,source,raw,normalized,normalized.exactFingerprint,normalized.familyFingerprint]);
 await audit('SCAN_CREATED','scan',scanId,{source}); return rows[0];
}
async function saveDecision(scanId,decision){
 const {rows}=await pool.query('UPDATE lab_device_scans SET decision=$2 WHERE id=$1 RETURNING *',[scanId,decision]);
 return rows[0];
}
async function listScans(){return (await pool.query('SELECT * FROM lab_device_scans ORDER BY created_at DESC LIMIT 300')).rows}
async function getScan(scanId){const {rows}=await pool.query('SELECT * FROM lab_device_scans WHERE id=$1',[scanId]);return rows[0]||null}
async function listFamilies(){return (await pool.query('SELECT * FROM lab_hardware_families ORDER BY display_name')).rows}
async function createFamily(b){
 const familyId=id();
 const {rows}=await pool.query(`
  INSERT INTO lab_hardware_families(id,display_name,manufacturer,brand,device,board,hardware,platform,family_fingerprint,status,notes)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
 [familyId,b.displayName,b.manufacturer||null,b.brand||null,b.device||null,b.board||null,b.hardware||null,b.platform||null,
  b.familyFingerprint||null,b.status||'REVIEW',b.notes||null]);
 await audit('FAMILY_CREATED','family',familyId,{displayName:b.displayName}); return rows[0];
}
async function listCompatibilityProfiles(){
 return (await pool.query('SELECT id,family_id AS "familyId",name,status,profile,created_at AS "createdAt" FROM lab_compatibility_profiles ORDER BY created_at DESC')).rows;
}
async function createCompatibilityProfile(b){
 const profileId=id();
 const {rows}=await pool.query(`
  INSERT INTO lab_compatibility_profiles(id,family_id,name,status,profile)
  VALUES($1,$2,$3,$4,$5) RETURNING id,family_id AS "familyId",name,status,profile`,
 [profileId,b.familyId,b.name,b.status||'REVIEW',b.profile||{}]);
 await audit('COMPAT_PROFILE_CREATED','compatibility_profile',profileId,{familyId:b.familyId}); return rows[0];
}
async function listFlashProfiles(){
 const {rows}=await pool.query('SELECT id,family_id AS "familyId",name,status,profile,created_at AS "createdAt" FROM lab_flash_profiles ORDER BY created_at DESC');
 return rows.map(r=>({...r,...r.profile,id:r.id,familyId:r.familyId,name:r.name,status:r.status}));
}
async function createFlashProfile(b){
 const profileId=id();
 const {rows}=await pool.query(`
  INSERT INTO lab_flash_profiles(id,family_id,name,status,profile)
  VALUES($1,$2,$3,$4,$5) RETURNING id,family_id AS "familyId",name,status,profile`,
 [profileId,b.familyId,b.name,b.status||'REVIEW',b.profile||{}]);
 await audit('FLASH_PROFILE_CREATED','flash_profile',profileId,{familyId:b.familyId,status:b.status||'REVIEW'}); return rows[0];
}
async function linkMdm(scanId,deviceId){
 const {rows}=await pool.query('UPDATE lab_device_scans SET linked_mdm_device_id=$2 WHERE id=$1 RETURNING *',[scanId,deviceId]);
 await audit('MDM_LINKED','scan',scanId,{deviceId}); return rows[0]||null;
}
async function listAudit(){return (await pool.query('SELECT * FROM lab_audit_log ORDER BY created_at DESC LIMIT 300')).rows}
module.exports={init,createScan,saveDecision,listScans,getScan,listFamilies,createFamily,listCompatibilityProfiles,
 createCompatibilityProfile,listFlashProfiles,createFlashProfile,linkMdm,listAudit,audit};

const {Pool}=require('pg');
let pool;
function getPool(){
  if(!process.env.MDM_DATABASE_URL)return null;
  if(!pool)pool=new Pool({
    connectionString:process.env.MDM_DATABASE_URL,
    ssl:process.env.MDM_DATABASE_SSL==='disable'?false:{rejectUnauthorized:true},
    max:2
  });
  return pool;
}
async function listMdmDevices(){
  const p=getPool(); if(!p)return [];
  // Defense in depth: MDM_DATABASE_URL is documented as needing a read-only DB role, but
  // nothing enforces that at the connection level. Force the session itself into a
  // read-only transaction mode so a misconfigured (write-capable) credential still can't
  // let a bug here mutate the production MDM database — Postgres will reject any write
  // attempt on this connection regardless of the role's real grants.
  const client=await p.connect();
  try{
    await client.query('SET default_transaction_read_only = on');
    const {rows}=await client.query(`
      SELECT device_id,customer_name,customer_number,status,policy,last_seen_at,
             current_version_name,manufacturer
        FROM devices ORDER BY registered_at DESC LIMIT 1000`);
    return rows.map(r=>({
      deviceId:r.device_id,customerName:r.customer_name,customerNumber:r.customer_number,
      status:r.status,policy:r.policy,lastSeenAt:r.last_seen_at,
      currentVersionName:r.current_version_name,manufacturer:r.manufacturer
    }));
  } finally {
    client.release();
  }
}
module.exports={listMdmDevices};

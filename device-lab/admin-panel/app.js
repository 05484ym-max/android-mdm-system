const $=s=>document.querySelector(s);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let scans=[],mdm=[];
const key=()=>localStorage.getItem('labKey')||'';
async function api(path,options={}){
 const r=await fetch(path,{...options,headers:{'content-type':'application/json','x-lab-key':key(),...(options.headers||{})}});
 if(!r.ok)throw new Error(await r.text()); return r.json();
}
function badge(decision){
 const s=decision?.status||'UNKNOWN_BUILD';
 const map={SUPPORTED_NO_FLASH:['מוכן ל-MDM','ok'],SUPPORTED_NEEDS_PROVISIONING:['דורש Provisioning','ok'],
  SUPPORTED_NEEDS_FLASH:['דורש צריבה','warn'],UNKNOWN_BUILD:['ROM לא מוכר','unknown'],
  FLASH_BLOCKED:['לא לצרוב כרגע','bad'],UNSUPPORTED:['לא נתמך','bad']};
 const pair=map[s]||[s,'unknown']; return '<span class="badge '+pair[1]+'">'+esc(pair[0])+'</span>';
}
function render(){
 const counts=scans.reduce((a,s)=>{const k=s.decision?.status||'UNKNOWN_BUILD';a[k]=(a[k]||0)+1;return a},{});
 $('#stats').innerHTML=[
  ['סה״כ סריקות',scans.length],['מוכנים',counts.SUPPORTED_NO_FLASH||0],
  ['דורשים צריבה',counts.SUPPORTED_NEEDS_FLASH||0],['לא מוכרים',(counts.UNKNOWN_BUILD||0)+(counts.FLASH_BLOCKED||0)]
 ].map(x=>'<div class="stat"><span>'+x[0]+'</span><b>'+x[1]+'</b></div>').join('');
 $('#scans').innerHTML=scans.length?scans.map(s=>'<div class="item">'+
  '<div><b>'+esc(s.normalized?.model||s.normalized?.device)+'</b><div class="muted">'+esc(s.normalized?.manufacturer)+' · Android '+esc(s.normalized?.androidVersion)+'</div></div>'+
  '<div>'+esc(s.normalized?.device)+'<div class="muted">'+esc(s.normalized?.hardware||s.normalized?.platform)+'</div></div>'+
  '<div>'+badge(s.decision)+'<div class="muted">Confidence: '+esc(s.decision?.confidence)+'</div></div>'+
  '<button onclick="showDetail(\''+s.id+'\')">פתח</button></div>').join(''):'<p class="muted">אין סריקות עדיין.</p>';
 $('#mdmDevices').innerHTML=mdm.length?mdm.slice(0,30).map(d=>'<div class="item">'+
  '<div><b>#'+esc(d.deviceId)+'</b><div class="muted">'+esc(d.customerName)+'</div></div>'+
  '<div>'+esc(d.manufacturer)+'</div><div>'+esc(d.currentVersionName)+'</div><div>'+esc(d.lastSeenAt)+'</div></div>').join(''):
  '<p class="muted">לא הוגדר MDM_DATABASE_URL או שאין מכשירים.</p>';
}
window.showDetail=id=>{
 const s=scans.find(x=>x.id===id); if(!s)return;
 const n=s.normalized||{},d=s.decision||{};
 const fields=[['דגם',n.model],['יצרן',n.manufacturer],['Device/Codename',n.device],['Board',n.board],
  ['Hardware',n.hardware],['Platform',n.platform],['Android',n.androidVersion],['API',n.apiLevel],
  ['Build fingerprint',n.buildFingerprint],['Bootloader',n.bootloader],['Verified Boot',n.verifiedBootState],
  ['Flash locked',n.flashLocked],['Device Owner',n.deviceOwner],['Setup Wizard',n.setupWizardPackage],
  ['ADB',n.adbState],['Fastboot product',n.fastbootProduct],['USB VID:PID',(n.usbVid||'—')+':'+(n.usbPid||'—')],
  ['Family fingerprint',n.familyFingerprint],['Exact fingerprint',n.exactFingerprint]];
 $('#detail').innerHTML='<div class="row"><div>'+badge(d)+'</div><b>'+esc(d.recommendedAction)+'</b></div>'+
  '<div class="grid">'+fields.map(x=>'<div class="field"><span>'+x[0]+'</span><b>'+esc(x[1])+'</b></div>').join('')+'</div>'+
  '<div class="instructions"><b>החלטה</b>\nסטטוס: '+esc(d.status)+'\nסיבות: '+esc((d.reasons||[]).join(', '))+
  '\nפעולה מומלצת: '+esc(d.recommendedAction)+'</div>';
 $('#detailCard').hidden=false; $('#detailCard').scrollIntoView({behavior:'smooth'});
};
async function load(){
 try{
  [scans,mdm]=await Promise.all([api('/api/lab/scans'),api('/api/lab/mdm/devices')]);
  $('#updated').textContent='עודכן '+new Date().toLocaleTimeString('he-IL'); render();
 }catch(e){$('#scans').innerHTML='<p class="bad">שגיאה: '+esc(e.message)+'</p>'}
}
$('#saveKey').onclick=()=>{localStorage.setItem('labKey',$('#key').value);load()};
$('#refresh').onclick=load; $('#closeDetail').onclick=()=>$('#detailCard').hidden=true;
$('#key').value=key(); if(key())load();

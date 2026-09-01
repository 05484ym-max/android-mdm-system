const $=s=>document.querySelector(s);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let scans=[],mdm=[],families=[];
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
async function promoteFamily(id){
 const name=prompt('שם משפחה להצגה (אפשר להשאיר ריק לשם אוטומטי):')||'';
 try{await api('/api/lab/scans/'+id+'/promote-family',{method:'POST',body:JSON.stringify({displayName:name||undefined})});await load();}
 catch(e){alert('שגיאה: '+e.message)}
}
async function reclassify(id){
 try{await api('/api/lab/scans/'+id+'/reclassify',{method:'POST'});await load();showDetail(id)}
 catch(e){alert('שגיאה: '+e.message)}
}
async function linkMdm(id){
 const deviceId=prompt('מספר המכשיר ב-MDM:'); if(!deviceId)return;
 try{await api('/api/lab/scans/'+id+'/link-mdm',{method:'POST',body:JSON.stringify({deviceId})});await load();showDetail(id)}
 catch(e){alert('שגיאה: '+e.message)}
}
async function showFlashPlan(id){
 try{
  const p=await api('/api/lab/scans/'+id+'/flash-plan');
  const lines=['בטוח להציג הוראות: '+(p.safeToShowInstructions?'כן':'לא')];
  if(p.blocks?.length)lines.push('חסימות: '+p.blocks.join(', '));
  if(p.summary)for(const [k,v] of Object.entries(p.summary))lines.push(k+': '+(v??'—'));
  if(p.prerequisites?.length)lines.push('\nלפני התחלה:\n- '+p.prerequisites.join('\n- '));
  if(p.steps?.length)lines.push('\nשלבי צריבה:\n'+p.steps.map((x,i)=>(i+1)+'. '+x).join('\n'));
  if(p.postFlash?.length)lines.push('\nאחרי צריבה:\n- '+p.postFlash.join('\n- '));
  const box=document.querySelector('#flashPlan'); if(box){box.textContent=lines.join('\n');box.hidden=false}
 }catch(e){alert('שגיאה: '+e.message)}
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
  '<div class="instructions"><b>החלטה</b>\nסטטוס: '+esc(d.status)+'\nסיבות: '+esc((d.reasons||[]).join(', '))+'\nפעולה מומלצת: '+esc(d.recommendedAction)+'</div>'+'<div class="row" style="margin-top:12px;flex-wrap:wrap"><button onclick="reclassify(\''+id+'\')">סווג מחדש</button><button onclick="promoteFamily(\''+id+'\')">צור משפחה</button><button onclick="linkMdm(\''+id+'\')">קשר ל-MDM</button><button onclick="showFlashPlan(\''+id+'\')">בדוק הוראות צריבה</button></div><pre id="flashPlan" class="instructions" hidden></pre>';
 $('#detailCard').hidden=false; $('#detailCard').scrollIntoView({behavior:'smooth'});
};
async function load(){
 try{
  [scans,mdm,families]=await Promise.all([api('/api/lab/scans'),api('/api/lab/mdm/devices'),api('/api/lab/families')]);
  $('#updated').textContent='עודכן '+new Date().toLocaleTimeString('he-IL'); render();
  $('#families').innerHTML=families.length?families.map(f=>'<div class="item"><div><b>'+esc(f.display_name)+'</b><div class="muted">'+esc(f.manufacturer)+' '+esc(f.device)+'</div></div><div>'+esc(f.hardware)+'</div><div>'+esc(f.status)+'</div><div>'+esc((f.family_fingerprint||'').slice(0,12))+'</div></div>').join(''):'<p class="muted">אין משפחות עדיין. צור משפחה מתוך סריקה מוכרת.</p>';
 }catch(e){$('#scans').innerHTML='<p class="bad">שגיאה: '+esc(e.message)+'</p>'}
}
$('#saveKey').onclick=()=>{localStorage.setItem('labKey',$('#key').value);load()};
$('#refresh').onclick=load; $('#loadFamilies').onclick=load; $('#closeDetail').onclick=()=>$('#detailCard').hidden=true;
$('#key').value=key(); if(key())load();

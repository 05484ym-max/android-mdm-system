#!/usr/bin/env node
const {execFileSync}=require('child_process');
const SERVER=(process.env.LAB_SERVER_URL||'').replace(/\/$/,'');
const KEY=process.env.LAB_ADMIN_KEY||'';

function cmd(bin,args,timeout=5000){
 try{return execFileSync(bin,args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim()}
 catch{return ''}
}
function adbShell(...args){return cmd('adb',['shell',...args])}
function prop(name){return adbShell('getprop',name)}
function parseDeviceOwner(text){
  if(!text) return null;
  if(/no\s+device\s+owner/i.test(text)) return null;
  if(!/Device Owner:/i.test(text)) return null;
  return text.trim() || 'Device Owner';
}
function fastbootVar(name){
 // `fastboot getvar` writes its answer to stderr; execFileSync above only captures stdout,
 // so this one call intentionally shells out with 2>&1 to merge them. Passed as a single
 // execFileSync arg (no string concatenation into a shell command line), so `name` cannot
 // break out of the fastboot argv even though the surrounding pipeline is a shell string.
 const text=cmd('sh',['-c','fastboot getvar "$1" 2>&1','_',name],4000);
 const marker=name+':';
 const line=text.split(/\r?\n/).find(x=>x.toLowerCase().includes(marker.toLowerCase()));
 return line?line.slice(line.toLowerCase().indexOf(marker.toLowerCase())+marker.length).trim():null;
}
function usbProbe(){
 const ls=cmd('sh',['-lc','command -v lsusb >/dev/null && lsusb | head -20 || true']);
 const m=ls.match(/ID\s+([0-9a-f]{4}):([0-9a-f]{4})/i);
 return {vid:m?.[1]||null,pid:m?.[2]||null,mode:ls?'USB_DETECTED':null,raw:ls||null};
}
const serial=cmd('adb',['get-serialno']);
const state=cmd('adb',['get-state']);
const ownersRaw=adbShell('dpm','list','owners');
const raw={
 source:'termux-scanner',
 hostType:process.platform==='android'?'ANDROID':'NODE_HOST',
 capturedAt:new Date().toISOString(),
 adbSerial:serial&&serial!=='unknown'?serial:null,
 adbState:state||null,
 properties:{
  manufacturer:prop('ro.product.manufacturer'),brand:prop('ro.product.brand'),model:prop('ro.product.model'),
  product:prop('ro.product.name'),device:prop('ro.product.device'),board:prop('ro.product.board'),
  hardware:prop('ro.hardware'),platform:prop('ro.board.platform'),cpuAbi:prop('ro.product.cpu.abi'),
  androidVersion:prop('ro.build.version.release'),apiLevel:prop('ro.build.version.sdk'),
  buildFingerprint:prop('ro.build.fingerprint'),buildId:prop('ro.build.id'),
  buildIncremental:prop('ro.build.version.incremental'),securityPatch:prop('ro.build.version.security_patch'),
  bootloader:prop('ro.bootloader'),verifiedBootState:prop('ro.boot.verifiedbootstate'),
  flashLocked:prop('ro.boot.flash.locked'),slotSuffix:prop('ro.boot.slot_suffix'),
  dynamicPartitions:prop('ro.boot.dynamic_partitions')
 },
 setupWizardPackage:adbShell('cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.SETUP_WIZARD'),
 deviceOwner:parseDeviceOwner(ownersRaw),
 provisioningAllowed:null,
 usb:usbProbe(),
 fastboot:{product:fastbootVar('product'),unlocked:fastbootVar('unlocked'),secure:fastbootVar('secure'),currentSlot:fastbootVar('current-slot')}
};
console.log(JSON.stringify(raw,null,2));

if(SERVER&&KEY){
 fetch(SERVER+'/api/lab/scans',{
  method:'POST',headers:{'content-type':'application/json','x-lab-key':KEY},body:JSON.stringify(raw)
 }).then(async r=>{
  const body=await r.text(); if(!r.ok)throw new Error(body);
  console.log('\n--- Device Lab ---\n'+body);
 }).catch(err=>{console.error('Upload failed:',err.message);process.exitCode=2});
}

const { flashProfileMatches } = require('./matcher');

function buildFlashPlan(scan, decision, flashProfile) {
  const blocks=[];
  if(!decision||decision.status!=='SUPPORTED_NEEDS_FLASH') blocks.push('decision_not_flashable');
  if(decision?.confidence!=='HIGH') blocks.push('identity_confidence_not_high');
  if(!flashProfile||flashProfile.status!=='APPROVED') blocks.push('flash_profile_not_approved');

  const p=flashProfile?.profile||flashProfile||{};
  const liveProfile = flashProfile ? {...p,status:flashProfile.status,id:flashProfile.id,familyId:flashProfile.familyId} : null;
  if (liveProfile) {
    const match = flashProfileMatches(scan, liveProfile);
    blocks.push(...match.reasons.map(x=>'live_'+x));
    if (decision?.flashProfileId && flashProfile.id && decision.flashProfileId !== flashProfile.id) {
      blocks.push('decision_profile_changed');
    }
  }

  if(!p.targetFirmware||p.targetFirmware==='TBD') blocks.push('target_firmware_missing');
  if(!p.requiredTool||p.requiredTool==='TBD') blocks.push('required_tool_missing');
  if(!p.requiredHostOs||p.requiredHostOs==='TBD') blocks.push('required_host_os_missing');
  if(!p.requiredBootMode||p.requiredBootMode==='TBD') blocks.push('required_boot_mode_missing');
  if(!p.antiRollbackConstraints||p.antiRollbackConstraints==='UNKNOWN') blocks.push('anti_rollback_unknown');
  if(p.unlockRequired===true && !p.unlockProcedureApproved) blocks.push('unlock_procedure_not_approved');
  if(p.oemAuthorizationRequired===true && !p.oemAuthorizationAvailable) blocks.push('oem_authorization_missing');

  const files=Array.isArray(p.files)?p.files:[];
  if(files.length===0) blocks.push('flash_files_missing');
  if(files.some(f=>!f?.name || !/^[a-f0-9]{64}$/i.test(String(f.sha256||'')))) {
    blocks.push('file_checksum_missing_or_invalid');
  }

  if(!Array.isArray(p.steps)||p.steps.length===0) blocks.push('flash_steps_missing');
  if(!Array.isArray(p.postFlash)||p.postFlash.length===0) blocks.push('post_flash_steps_missing');

  const safe=[...new Set(blocks)].length===0;
  return {
    safeToShowInstructions:safe,
    blocks:[...new Set(blocks)],
    summary:{
      model:scan?.model||null,device:scan?.device||null,buildFingerprint:scan?.buildFingerprint||null,
      targetFirmware:p.targetFirmware||null,requiredTool:p.requiredTool||null,requiredToolVersion:p.requiredToolVersion||null,
      requiredHostOs:p.requiredHostOs||null,requiredDriver:p.requiredDriver||null,requiredBootMode:p.requiredBootMode||null,
      oemAuthorizationRequired:p.oemAuthorizationRequired===true,wipeRequired:p.wipeRequired===true,
      expectedDataLoss:p.expectedDataLoss||null
    },
    prerequisites:safe?[
      'ודא זיהוי HIGH והתאמת variant.',
      'ודא סוללה מעל 50%.',
      'גבה מידע נדרש.',
      'אמת SHA-256 של כל קובץ לפני צריבה.',
      'ודא מצב boot/bootloader לפי הפרופיל.'
    ]:[],
    steps:safe?p.steps:[],
    postFlash:safe?p.postFlash:[]
  };
}
module.exports={buildFlashPlan};

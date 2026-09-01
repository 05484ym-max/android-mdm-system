function buildFlashPlan(scan, decision, flashProfile) {
  const blocks=[];
  if(!decision||decision.status!=='SUPPORTED_NEEDS_FLASH') blocks.push('decision_not_flashable');
  if(decision?.confidence!=='HIGH') blocks.push('identity_confidence_not_high');
  if(!flashProfile||flashProfile.status!=='APPROVED') blocks.push('flash_profile_not_approved');
  const p=flashProfile?.profile||flashProfile||{};
  if(!p.targetFirmware||p.targetFirmware==='TBD') blocks.push('target_firmware_missing');
  if(!p.requiredTool||p.requiredTool==='TBD') blocks.push('required_tool_missing');
  if(!p.antiRollbackConstraints||p.antiRollbackConstraints==='UNKNOWN') blocks.push('anti_rollback_unknown');
  if(p.unlockRequired===true && !p.unlockProcedureApproved) blocks.push('unlock_procedure_not_approved');
  if(p.oemAuthorizationRequired===true && !p.oemAuthorizationAvailable) blocks.push('oem_authorization_missing');

  const files=Array.isArray(p.files)?p.files:[];
  if(files.some(f=>!f.sha256)) blocks.push('file_checksum_missing');

  const safe=blocks.length===0;
  return {
    safeToShowInstructions:safe,
    blocks,
    summary:{
      model:scan?.model||null,device:scan?.device||null,buildFingerprint:scan?.buildFingerprint||null,
      targetFirmware:p.targetFirmware||null,requiredTool:p.requiredTool||null,requiredToolVersion:p.requiredToolVersion||null,requiredHostOs:p.requiredHostOs||null,requiredDriver:p.requiredDriver||null,requiredBootMode:p.requiredBootMode||null,oemAuthorizationRequired:p.oemAuthorizationRequired===true,
      wipeRequired:p.wipeRequired===true,expectedDataLoss:p.expectedDataLoss||null
    },
    prerequisites:safe?[
      'ודא זיהוי HIGH והתאמת variant.',
      'ודא סוללה מעל 50%.',
      'גבה מידע נדרש.',
      'אמת SHA-256 של כל קובץ לפני צריבה.',
      'ודא מצב boot/bootloader לפי הפרופיל.'
    ]:[],
    steps:safe?(p.steps||[]):[],
    postFlash:safe?(p.postFlash||[]):[]
  };
}
module.exports={buildFlashPlan};

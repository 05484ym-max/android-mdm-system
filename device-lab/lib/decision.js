const {pickBestFamily,flashProfileMatches}=require('./matcher');

function decide(scan,families,flashProfiles,compatibilityProfiles){
  const best=pickBestFamily(scan,families);
  if(!best||best.confidence==='LOW') return {
    status:'UNKNOWN_BUILD',confidence:best?.confidence||'LOW',familyId:best?.family?.id||null,
    reasons:['hardware_family_not_confirmed'],recommendedAction:'עצור לבדיקה ידנית. אין לבצע צריבה.'
  };
  const compat=compatibilityProfiles.find(p=>p.familyId===best.family.id&&p.status==='APPROVED');
  if(scan.deviceOwner&&/device owner/i.test(scan.deviceOwner)) return {
    status:'SUPPORTED_NO_FLASH',confidence:best.confidence,familyId:best.family.id,
    compatibilityProfileId:compat?.id||null,reasons:['device_owner_already_present'],
    recommendedAction:'המכשיר כבר מנוהל. בצע בדיקות MDM בלבד.'
  };
  if(scan.provisioningAllowed===true&&compat) return {
    status:'SUPPORTED_NEEDS_PROVISIONING',confidence:best.confidence,familyId:best.family.id,
    compatibilityProfileId:compat.id,reasons:['provisioning_available'],
    recommendedAction:'אין צורך בצריבה. בצע Device Owner provisioning.'
  };
  const candidates=flashProfiles.filter(p=>p.familyId===best.family.id)
    .map(p=>({profile:p,match:flashProfileMatches(scan,p)})).filter(x=>x.match.ok);
  if(candidates.length&&best.confidence==='HIGH') return {
    status:'SUPPORTED_NEEDS_FLASH',confidence:'HIGH',familyId:best.family.id,
    flashProfileId:candidates[0].profile.id,compatibilityProfileId:compat?.id||null,
    reasons:['approved_flash_profile_available'],recommendedAction:'נדרשת צריבה לפי הפרופיל המאושר.'
  };
  return {status:'FLASH_BLOCKED',confidence:best.confidence,familyId:best.family.id,
    compatibilityProfileId:compat?.id||null,reasons:['no_high_confidence_approved_flash_profile'],
    recommendedAction:'לא ניתן לצרוב בבטחה כרגע. חסר פרופיל מאושר/התאמה ודאית.'};
}
module.exports={decide};

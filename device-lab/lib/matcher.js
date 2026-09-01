function scoreFamily(scan, family) {
  let score=0, possible=0;
  for (const [key,weight] of [['device',30],['board',20],['hardware',20],['platform',20],['manufacturer',5],['brand',5]]) {
    if (scan[key] && family[key]) {
      possible += weight;
      if (String(scan[key]).toLowerCase() === String(family[key]).toLowerCase()) score += weight;
    }
  }
  if (scan.familyFingerprint && family.familyFingerprint) {
    possible += 50;
    if (scan.familyFingerprint === family.familyFingerprint) score += 50;
  }
  const ratio=possible?score/possible:0;
  return {score:Math.round(ratio*100),confidence:ratio>=0.9?'HIGH':ratio>=0.65?'MEDIUM':'LOW'};
}
function pickBestFamily(scan,families){
  return families.map(f=>({family:f,...scoreFamily(scan,f)})).sort((a,b)=>b.score-a.score)[0]||null;
}
function flashProfileMatches(scan, profile) {
  const reasons=[];
  if (profile.status!=='APPROVED') reasons.push('profile_not_approved');
  if (profile.familyFingerprint && scan.familyFingerprint!==profile.familyFingerprint) reasons.push('family_mismatch');
  if (profile.allowedExactFingerprints?.length && !profile.allowedExactFingerprints.includes(scan.exactFingerprint))
    reasons.push('build_not_approved');
  if (profile.codenames?.length && scan.device &&
      !profile.codenames.map(x=>String(x).toLowerCase()).includes(scan.device.toLowerCase()))
    reasons.push('codename_mismatch');
  return {ok:reasons.length===0,reasons};
}
module.exports={scoreFamily,pickBestFamily,flashProfileMatches};

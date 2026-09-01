const norm = value => value == null ? null : String(value).trim().toLowerCase() || null;

function scoreFamily(scan, family) {
  let score=0, possible=0, evidenceCount=0;
  const hardMismatchKeys = ['device','board','hardware','platform'];
  for (const key of hardMismatchKeys) {
    if (scan[key] && family[key] && norm(scan[key]) !== norm(family[key])) {
      return {score:0,confidence:'LOW',evidenceCount:0,hardMismatch:key};
    }
  }

  for (const [key,weight] of [['device',30],['board',20],['hardware',20],['platform',20],['manufacturer',5],['brand',5]]) {
    if (scan[key] && family[key]) {
      possible += weight;
      evidenceCount += 1;
      if (norm(scan[key]) === norm(family[key])) score += weight;
    }
  }

  let fingerprintMatch = false;
  if (scan.familyFingerprint && family.familyFingerprint) {
    possible += 50;
    evidenceCount += 1;
    fingerprintMatch = scan.familyFingerprint === family.familyFingerprint;
    if (fingerprintMatch) score += 50;
  }

  const ratio=possible?score/possible:0;
  const enoughEvidence = fingerprintMatch || evidenceCount >= 3;
  const confidence = enoughEvidence && ratio >= 0.9 ? 'HIGH' :
    enoughEvidence && ratio >= 0.65 ? 'MEDIUM' : 'LOW';
  return {score:Math.round(ratio*100),confidence,evidenceCount,hardMismatch:null};
}
function pickBestFamily(scan,families){
  return families.map(f=>({family:f,...scoreFamily(scan,f)}))
    .sort((a,b)=>b.score-a.score || b.evidenceCount-a.evidenceCount)[0]||null;
}
function flashProfileMatches(scan, profile) {
  const reasons=[];
  if (profile.status!=='APPROVED') reasons.push('profile_not_approved');

  if (!profile.familyFingerprint) reasons.push('profile_family_fingerprint_required');
  else if (!scan.familyFingerprint || scan.familyFingerprint!==profile.familyFingerprint) reasons.push('family_mismatch');

  if (!Array.isArray(profile.allowedExactFingerprints) || profile.allowedExactFingerprints.length===0) {
    reasons.push('approved_exact_fingerprints_required');
  } else if (!scan.exactFingerprint || !profile.allowedExactFingerprints.includes(scan.exactFingerprint)) {
    reasons.push('build_not_approved');
  }

  if (!Array.isArray(profile.codenames) || profile.codenames.length===0) {
    reasons.push('approved_codenames_required');
  } else if (!scan.device || !profile.codenames.map(norm).includes(norm(scan.device))) {
    reasons.push('codename_mismatch');
  }

  return {ok:reasons.length===0,reasons};
}
module.exports={scoreFamily,pickBestFamily,flashProfileMatches};

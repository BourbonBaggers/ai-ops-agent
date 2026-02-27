export function selectCandidateForContact(candidates, contact, weeklyRun) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("selectCandidateForContact: candidates must be a non-empty array");
  }
  if (!contact?.id) {
    throw new Error("selectCandidateForContact: contact.id is required");
  }
  if (!weeklyRun?.week_of) {
    throw new Error("selectCandidateForContact: weeklyRun.week_of is required");
  }

  const salt = String(weeklyRun.week_of);
  const bucket = stableHash(`${contact.id}${salt}`) % 4;
  const isCold = Number(contact.order_count ?? 0) === 0;

  let targetStage;
  if (isCold) {
    targetStage = bucket === 3 ? "mid" : "top";
  } else {
    targetStage = bucket === 3 ? "mid" : "bottom";
  }

  const selected = candidates.find((c) => c?.funnel_stage === targetStage);
  if (!selected) {
    throw new Error(`selectCandidateForContact: missing candidate for funnel_stage=${targetStage}`);
  }

  return selected;
}

export function stableHash(input) {
  let hash = 5381;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

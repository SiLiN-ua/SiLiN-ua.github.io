// engine/report.js
// Derived evaluator for REPORT (evidence audit) and FINAL REPORT (analyst filing).
// Pure function of (caseData, state.evidence, state.finalSubmission). No state of
// its own. Every field returned is derived — nothing here is persisted.
//
// Three orthogonal questions this module answers:
//
//   VERDICT     — "Is the authored evidence chain complete?"
//                 (sections + allMet + missing)
//   QUALITY     — "How thoroughly was the investigation conducted?"
//                 (quality.* dimensions + composite overall 0..100)
//   SUBMISSION  — "What conclusion did the analyst formally file?"
//                 (submission — mirrors state.finalSubmission)
//
// Three different questions. Three different states. They are ALLOWED to
// diverge: the same verdict can carry different quality; a filed conclusion
// can exist regardless of quality.

import { getState } from './state.js';

function evidenceIdSet() {
  const state = getState();
  return new Set((state && state.evidence || []).map(e => e.sourceId));
}

function isCriterionMet(criterion, ids) {
  if (criterion.requires_all && criterion.requires_all.length) {
    return criterion.requires_all.every(id => ids.has(id));
  }
  if (criterion.requires_any && criterion.requires_any.length) {
    return criterion.requires_any.some(id => ids.has(id));
  }
  return true;
}

// -------- QUALITY --------

// Discover all artifact ids that can potentially become evidence, and index
// them by their `tool` field and by their `type` field. This is what "available
// snapshots" and "total tools" refer to.
function surveyCase(caseData) {
  const arts = caseData?.artifacts || {};
  const allTools = new Set();
  let availableSnapshots = 0;
  for (const id of Object.keys(arts)) {
    const a = arts[id];
    if (a && a.tool) allTools.add(a.tool);
    if (a && a.type === 'archive_snapshot') availableSnapshots += 1;
  }
  return { allTools, availableSnapshots };
}

// Order-agnostic pair matcher. A spec pair {from, to, reason} is EARNED when
// state.links contains a link whose endpoints are the same unordered pair AND
// whose reason string equals the spec reason exactly. A link with a mismatched
// reason (e.g. spec pair is `operator_lead` but player linked with reason
// `content_overlap`) does NOT count — reason must be spec-conformant.
function computeEarnedLinkedPairs(caseData, links) {
  const specPairs = (caseData && caseData.linked_pairs) || [];
  if (!specPairs.length || !links || !links.length) return [];
  const key = (a, b, r) => `${[String(a), String(b)].sort().join('|')}::${String(r)}`;
  const activeKeys = new Set(links.map(l => key(l.from, l.to, l.reason)));
  return specPairs.filter(p => activeKeys.has(key(p.from, p.to, p.reason)));
}

function computeQuality(caseData, ids, requiredFlat, missingRequired) {
  const state = getState();
  const collectedItems = (state && state.evidence) || [];
  const stateLinks = (state && state.links) || [];
  const { allTools, availableSnapshots } = surveyCase(caseData);

  // Chain
  let chainRequired;
  if (!ids.size) chainRequired = 'EMPTY';
  else if (missingRequired === 0 && requiredFlat.length > 0) chainRequired = 'COMPLETE';
  else chainRequired = 'INCOMPLETE';

  // Independent findings (optional criteria met / total)
  const optionalCriteria = (caseData?.report_criteria || []).filter(c => c.type === 'optional');
  const optionalMet = optionalCriteria.filter(c => isCriterionMet(c, ids)).length;
  const independentFindings = { met: optionalMet, total: optionalCriteria.length };

  // Source diversity — tools present in evidence, in order of first appearance
  const seenTools = [];
  const seenToolsSet = new Set();
  for (const e of collectedItems) {
    const t = e && e.tool;
    if (t && !seenToolsSet.has(t)) {
      seenToolsSet.add(t);
      seenTools.push(t);
    }
  }
  const sourceDiversity = { toolsUsed: seenTools, total: allTools.size };

  // Temporal depth — archive snapshots collected / available
  const collectedSnapshots = collectedItems.filter(
    e => e && e.type === 'archive_snapshot'
  ).length;
  const temporalDepth = { collectedSnapshots, availableSnapshots };

  // Composite: hardcoded weights for MVP1 (per session-8 spec).
  //   50 chain COMPLETE
  //   20 independent findings ratio
  //   15 source diversity ratio
  //   15 temporal depth ratio
  //   +2 per earned linked pair (V2 §6.2), capped at +8
  //   final overall capped at 100
  const chainScore = chainRequired === 'COMPLETE' ? 50 : 0;
  const indScore = independentFindings.total > 0
    ? 20 * (independentFindings.met / independentFindings.total) : 0;
  const divScore = sourceDiversity.total > 0
    ? 15 * (Math.min(sourceDiversity.toolsUsed.length, sourceDiversity.total) / sourceDiversity.total) : 0;
  const tempScore = temporalDepth.availableSnapshots > 0
    ? 15 * (Math.min(temporalDepth.collectedSnapshots, temporalDepth.availableSnapshots) / temporalDepth.availableSnapshots) : 0;

  const earnedPairs = computeEarnedLinkedPairs(caseData, stateLinks);
  const linkBonus = Math.min(2 * earnedPairs.length, 8);
  const earnedReasons = earnedPairs.map(p => p.reason);

  const overall = Math.min(
    Math.round(chainScore + indScore + divScore + tempScore + linkBonus),
    100,
  );

  return {
    chainRequired,
    independentFindings,
    sourceDiversity,
    temporalDepth,
    linkBonus,
    earnedPairs,
    earnedReasons,
    overall,
  };
}

// -------- SUBMISSION EVALUATOR --------

function matchAttribution(answer, finalAnswer) {
  if (!finalAnswer || finalAnswer.attribution_expected == null) return true;
  const mode = finalAnswer.attribution_match || 'substring_ci';
  const a = String(answer || '');
  const expected = finalAnswer.attribution_expected;
  const expArr = Array.isArray(expected) ? expected : [String(expected)];
  const aLower = a.toLowerCase();
  const aTrimLower = a.trim().toLowerCase();
  switch (mode) {
    case 'substring_ci':
      return aLower.includes(String(expArr[0]).toLowerCase());
    case 'substring_ci_any':
      return expArr.some(e => aLower.includes(String(e).toLowerCase()));
    case 'exact_ci':
      return aTrimLower === String(expArr[0]).trim().toLowerCase();
    case 'exact_ci_any':
      return expArr.some(e => aTrimLower === String(e).trim().toLowerCase());
    case 'exact':
      return a === String(expArr[0]);
    default:
      return aLower.includes(String(expArr[0]).toLowerCase());
  }
}

// Evaluate a candidate submission against final_answer + current evidence.
// Pure — does not persist anything.
export function evaluateSubmission(caseData, candidate) {
  const finalAnswer = caseData?.final_answer;
  if (!finalAnswer) {
    return { outcome: 'CLOSED', reason: 'no_final_answer_defined' };
  }
  const ids = evidenceIdSet();
  const required = new Set(finalAnswer.supporting_evidence_required || []);
  const minCount = finalAnswer.supporting_evidence_min_count || 1;

  const selectedInEvidence = (candidate.supportingEvidenceIds || [])
    .filter(id => ids.has(id));
  const requiredMatches = selectedInEvidence.filter(id => required.has(id));

  const attributionOk = matchAttribution(candidate.attribution, finalAnswer);
  const evidenceOk = requiredMatches.length >= minCount;

  const outcome = (attributionOk && evidenceOk) ? 'SOLVED' : 'CLOSED';
  return {
    outcome,
    attributionOk,
    evidenceOk,
    selectedCount: selectedInEvidence.length,
    requiredMatchesCount: requiredMatches.length,
    minCount,
  };
}

// -------- TOP-LEVEL EVALUATION --------

export function evaluateReport(caseData) {
  const criteria = (caseData && caseData.report_criteria) || [];
  const ids = evidenceIdSet();

  const sectionOrder = [];
  const bySection = new Map();

  for (const c of criteria) {
    const section = c.section || 'CRITERIA';
    if (!bySection.has(section)) {
      bySection.set(section, []);
      sectionOrder.push(section);
    }
    const baseLabel = c.label || c.label_en || c.label_uk || c.id;
    const baseMissing = c.missing_label || c.missing_label_en || c.missing_label_uk || (baseLabel.toUpperCase() + ' — MISSING');
    bySection.get(section).push({
      id: c.id,
      label: baseLabel,
      label_en: c.label_en,
      label_uk: c.label_uk,
      missing_label: baseMissing,
      missing_label_en: c.missing_label_en,
      missing_label_uk: c.missing_label_uk,
      met: isCriterionMet(c, ids),
      optional: c.type === 'optional',
    });
  }

  const flat = sectionOrder.flatMap(s => bySection.get(s));
  const requiredFlat = flat.filter(item => !item.optional);
  const totalRequired = requiredFlat.length;
  const missingRequired = requiredFlat.filter(c => !c.met).length;
  const allMet = totalRequired > 0 && missingRequired === 0;
  const nothingCollected = ids.size === 0;

  const quality = computeQuality(caseData, ids, requiredFlat, missingRequired);

  const state = getState();
  const submission = (state && state.finalSubmission) || null;

  return {
    sections: sectionOrder.map(name => ({ name, items: bySection.get(name) })),
    total: totalRequired,
    missing: missingRequired,
    allMet,
    nothingCollected,
    quality,
    submission,
  };
}

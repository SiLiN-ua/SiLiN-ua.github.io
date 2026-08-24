// engine/report.js
// Derived evaluator for the mini Final Report checkpoint.
// Pure function of (caseData.report_criteria, state.evidence). No state of its own.
//
// A criterion is "met" when its requirement is satisfied by the collected evidence:
//   - requires_any: at least one listed evidence id is present
//   - requires_all: every listed evidence id is present
// A criterion with neither requirement is considered met (author authored it "always ok").
//
// A criterion with type: "optional" is an independent finding, NOT part of the
// authored chain. It shows up in its own section but is excluded from the
// completion verdict — its absence never turns the chain into "incomplete".
// The rule REPORT answers is "is the authored chain closed?", not "has the
// investigation been exhausted?" — optional criteria preserve that distinction.

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

// Returns [{ section, items: [{ id, label, missing_label, met, optional }, ...] }, ...]
// in declaration order. Sections are grouped in the order they first appear.
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
    bySection.get(section).push({
      id: c.id,
      label: c.label || c.id,
      missing_label: c.missing_label || (c.label || c.id).toUpperCase() + ' — MISSING',
      met: isCriterionMet(c, ids),
      optional: c.type === 'optional',
    });
  }

  // Verdict is derived from REQUIRED criteria only.
  const requiredFlat = sectionOrder
    .flatMap(s => bySection.get(s))
    .filter(item => !item.optional);
  const totalRequired = requiredFlat.length;
  const missingRequired = requiredFlat.filter(c => !c.met).length;
  const allMet = totalRequired > 0 && missingRequired === 0;
  const nothingCollected = ids.size === 0;

  return {
    sections: sectionOrder.map(name => ({ name, items: bySection.get(name) })),
    total: totalRequired,
    missing: missingRequired,
    allMet,
    nothingCollected,
  };
}

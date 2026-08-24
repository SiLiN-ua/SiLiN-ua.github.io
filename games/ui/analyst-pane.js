// ui/analyst-pane.js
// Analyst Mode — post-submission methodology explainer.
//
// Iron rule for this pane, encoded in the render logic:
//   Analyst Mode explains techniques, not the player's performance.
//
// - Read-only: never adds evidence, never opens tools, never touches
//   submission, quality, notes or links.
// - Personalisation is evidence-conditional only: observations state facts
//   about what evidence was collected, never grade whether the player was
//   "right" or "wrong" to collect it.
// - Missing observations are silently omitted — no ⚠, no "you didn't", no
//   "missing". If nothing matched for a concept, a neutral fallback is shown.

import { getState } from '../engine/state.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function evidenceIdSet() {
  const state = getState();
  return new Set((state && state.evidence || []).map(e => e.sourceId));
}

// Same semantics as engine/report.js.isCriterionMet (kept local to avoid a
// circular import — this pane never imports report evaluation).
function conditionMet(when, ids) {
  if (!when) return true;
  if (when.requires_all && when.requires_all.length) {
    return when.requires_all.every(id => ids.has(id));
  }
  if (when.requires_any && when.requires_any.length) {
    return when.requires_any.some(id => ids.has(id));
  }
  return true;
}

function observationsHtml(concept, ids) {
  const active = (concept.player_observations || [])
    .filter(o => conditionMet(o.when, ids));
  if (!active.length) {
    return `
      <div class="analyst-obs analyst-obs--empty">
        This case contained several signals that can be combined using this technique.
      </div>
    `;
  }
  return `
    <ul class="analyst-obs__list">
      ${active.map(o => `
        <li class="analyst-obs__item">
          <span class="analyst-obs__mark">✓</span>
          <span class="analyst-obs__text">${esc(o.text)}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function conceptHtml(concept, ids) {
  return `
    <section class="analyst-concept">
      <div class="analyst-concept__eyebrow">CONCEPT</div>
      <h3 class="analyst-concept__title">${esc(concept.title)}</h3>

      <div class="analyst-block">
        <div class="analyst-block__label">WHY IT MATTERED</div>
        <p class="analyst-block__body">${esc(concept.why_it_mattered)}</p>
      </div>

      <div class="analyst-block">
        <div class="analyst-block__label">WHAT YOUR CASE LOOKS LIKE</div>
        ${observationsHtml(concept, ids)}
      </div>

      ${concept.real_world_reference ? `
        <div class="analyst-block analyst-block--ref">
          <div class="analyst-block__label">REAL-WORLD REFERENCE</div>
          <p class="analyst-block__body">${esc(concept.real_world_reference)}</p>
        </div>
      ` : ''}
    </section>
  `;
}

function hookHtml(hook) {
  if (!hook) return '';
  const url = hook.url || '';
  return `
    <section class="analyst-hook">
      ${hook.text ? `<p class="analyst-hook__text">${esc(hook.text)}</p>` : ''}
      ${url ? `<a class="analyst-hook__cta" href="${esc(url)}" target="_blank" rel="noopener">${esc(hook.cta || 'Read more →')}</a>` : ''}
    </section>
  `;
}

export function renderAnalystPane(paneEl, caseData) {
  const analyst = caseData && caseData.analyst_mode;
  if (!analyst) {
    paneEl.innerHTML = `
      <div class="analyst"><div class="analyst__empty">No analyst content for this case.</div></div>
    `;
    return;
  }

  const ids = evidenceIdSet();
  const concepts = analyst.concepts || [];

  paneEl.innerHTML = `
    <div class="analyst">
      <div class="analyst__title">CASE 001 · ANALYST MODE</div>
      ${analyst.intro ? `<p class="analyst__intro">${esc(analyst.intro)}</p>` : ''}
      <div class="analyst__divider"></div>
      ${concepts.map(c => conceptHtml(c, ids)).join('<div class="analyst__divider"></div>')}
      ${analyst.hook ? '<div class="analyst__divider analyst__divider--wide"></div>' : ''}
      ${hookHtml(analyst.hook)}
    </div>
  `;
}

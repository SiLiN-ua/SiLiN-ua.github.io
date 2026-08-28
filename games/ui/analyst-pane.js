// ui/analyst-pane.js
// Analyst Mode — post-submission methodology explainer.
//
// Iron rule for this pane, encoded in the render logic:
//   Analyst Mode explains techniques, not the player's performance.

import { getState } from '../engine/state.js';
import { t, pick } from '../engine/i18n.js';

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
        ${t('analyst.empty_obs')}
      </div>
    `;
  }
  return `
    <ul class="analyst-obs__list">
      ${active.map(o => `
        <li class="analyst-obs__item">
          <span class="analyst-obs__mark">✓</span>
          <span class="analyst-obs__text">${esc(pick(o, 'text'))}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function conceptHtml(concept, ids) {
  const title = pick(concept, 'title');
  const why = pick(concept, 'why_it_mattered');
  const ref = pick(concept, 'real_world_reference');
  return `
    <section class="analyst-concept">
      <div class="analyst-concept__eyebrow">${t('analyst.block.concept')}</div>
      <h3 class="analyst-concept__title">${esc(title)}</h3>

      <div class="analyst-block">
        <div class="analyst-block__label">${t('analyst.block.why')}</div>
        <p class="analyst-block__body">${esc(why)}</p>
      </div>

      <div class="analyst-block">
        <div class="analyst-block__label">${t('analyst.block.your_case')}</div>
        ${observationsHtml(concept, ids)}
      </div>

      ${ref ? `
        <div class="analyst-block analyst-block--ref">
          <div class="analyst-block__label">${t('analyst.block.reference')}</div>
          <p class="analyst-block__body">${esc(ref)}</p>
        </div>
      ` : ''}
    </section>
  `;
}

function hookHtml(hook) {
  if (!hook) return '';
  const url = hook.url || '';
  const text = pick(hook, 'text');
  const cta = pick(hook, 'cta') || t('analyst.hook.default_cta');
  return `
    <section class="analyst-hook">
      ${text ? `<p class="analyst-hook__text">${esc(text)}</p>` : ''}
      ${url ? `<a class="analyst-hook__cta" href="${esc(url)}" target="_blank" rel="noopener">${esc(cta)}</a>` : ''}
    </section>
  `;
}

export function renderAnalystPane(paneEl, caseData) {
  const analyst = caseData && caseData.analyst_mode;
  if (!analyst) {
    paneEl.innerHTML = `
      <div class="analyst"><div class="analyst__empty">${t('analyst.empty')}</div></div>
    `;
    return;
  }

  const ids = evidenceIdSet();
  const concepts = analyst.concepts || [];
  const intro = pick(analyst, 'intro');

  paneEl.innerHTML = `
    <div class="analyst">
      <div class="analyst__title">${t('analyst.title')}</div>
      ${intro ? `<p class="analyst__intro">${esc(intro)}</p>` : ''}
      <div class="analyst__divider"></div>
      ${concepts.map(c => conceptHtml(c, ids)).join('<div class="analyst__divider"></div>')}
      ${analyst.hook ? '<div class="analyst__divider analyst__divider--wide"></div>' : ''}
      ${hookHtml(analyst.hook)}
    </div>
  `;
}

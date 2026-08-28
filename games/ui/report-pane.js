// ui/report-pane.js
// REPORT — a single-scroll investigative document. Sections read as editorial
// prose (serif italic placeholders until backed by evidence). Attribution and
// SUBMIT sit at the very bottom of the document. See S4_EVIDENCE_PROGRESSION_
// ACCEPTANCE.md §7.
//
// CR-1: UI emits {attribution, supportingEvidenceIds} through the action bus.
// The verdict outcome is computed in the state handler for `submit_report`
// (engine/state.js), never in this file.

import { evaluateReport } from '../engine/report.js';
import { setActiveTool, getState } from '../engine/state.js';
import { t, pick } from '../engine/i18n.js';
import * as actions from '../engine/actions.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Author-facing section names → i18n keys.
const SECTION_KEY_BY_NAME = {
  'IDENTITY':                             'report.section.identity',
  'CONTENT':                              'report.section.content',
  'TEMPORAL PROOF':                       'report.section.temporal',
  'OPERATOR':                             'report.section.operator',
  'CORROBORATION':                        'report.section.corroboration',
  'CORROBORATION · INDEPENDENT FINDINGS': 'report.section.corroboration',
};

function localizedSectionName(name) {
  const key = SECTION_KEY_BY_NAME[String(name || '').toUpperCase()];
  return key ? t(key) : name;
}

// Find which evidence items satisfy an item's requirement.
function evidenceIdsSatisfying(item, criterionSource, evidenceItems) {
  const bySource = new Map(evidenceItems.map(e => [e.sourceId, e]));
  const ids = new Set();
  const reqAll = criterionSource?.requires_all || [];
  const reqAny = criterionSource?.requires_any || [];
  for (const id of [...reqAll, ...reqAny]) {
    if (bySource.has(id)) ids.add(id);
  }
  return Array.from(ids);
}

function evidenceExcerpt(evidence) {
  const snap = evidence.snapshot;
  if (snap.type === 'chat_profile') {
    return (snap.display_name || snap.handle || snap.id) +
      (snap.handle ? ' — @' + snap.handle : '');
  }
  if (snap.type === 'archive_snapshot') {
    return (pick(snap, 'kind_label') || 'archive') +
      (snap.captured_at ? ' — ' + snap.captured_at : '');
  }
  if (snap.type === 'atlas_location_claim') {
    return (snap.subject || 'record') +
      (pick(snap, 'location_claimed') ? ' — ' + pick(snap, 'location_claimed') : '');
  }
  return snap.display_name || snap.username || snap.title || snap.id;
}

function itemBodyHtml(item, criterionSource, evidenceItems, earnedReasons) {
  const label = pick(item, 'label') || item.label;
  const earnedBonus = earnedReasons && earnedReasons.has(item.id);
  // ✚ badge (V2 §6.2) — appears only on met rows whose criterion.id matches an
  // earned linked-pair reason. Absent when the row is unmet or when no pair
  // with that reason is present in state.links with matching endpoints.
  const badgeHtml = earnedBonus
    ? `<span class="report-item__link-badge" title="+2 · linked pair" aria-label="+2 quality bonus (linked pair)">✚</span>`
    : '';
  if (!item.met) {
    return `
      <div class="report-item is-empty" data-criterion="${esc(item.id)}">
        <div class="report-item__label">${esc(label)}</div>
        <div class="report-item__placeholder">${t('report.item.placeholder')}</div>
      </div>
    `;
  }
  const supportingIds = evidenceIdsSatisfying(item, criterionSource, evidenceItems);
  const supporting = supportingIds
    .map(id => evidenceItems.find(e => e.sourceId === id))
    .filter(Boolean);
  const listHtml = supporting.map(ev => `
    <li class="report-item__evidence">
      <span class="report-item__evidence-id">${esc(ev.evidenceId)} · ${esc(String(ev.tool || '').toUpperCase())}</span>
      <span class="report-item__evidence-excerpt">${esc(evidenceExcerpt(ev))}</span>
    </li>
  `).join('');
  return `
    <div class="report-item is-met${earnedBonus ? ' has-link-bonus' : ''}" data-criterion="${esc(item.id)}">
      <div class="report-item__label">${esc(label)}${badgeHtml}</div>
      ${supporting.length ? `<ul class="report-item__evidence-list">${listHtml}</ul>` : ''}
    </div>
  `;
}

function sectionHtml(section, caseData, evidenceItems, earnedReasons) {
  const criteriaSource = caseData.report_criteria || [];
  const items = section.items.map(item => {
    const src = criteriaSource.find(c => c.id === item.id);
    return itemBodyHtml(item, src, evidenceItems, earnedReasons);
  }).join('');
  return `
    <section class="report-doc__section">
      <div class="report-doc__eyebrow">${esc(localizedSectionName(section.name))}</div>
      <div class="report-doc__section-body">
        ${items}
      </div>
    </section>
  `;
}

// ---- Attribution + SUBMIT at document tail ----

function attributionAndSubmitHtml(caseData, prefill, submitEnabled, missingCriteriaLabels) {
  const q = pick(caseData.final_answer || {}, 'question') || t('report.finalform.attribution_question');
  const attributionOk = (prefill.attribution || '').trim().length >= 2;
  const supportOk = (prefill.supportingEvidenceIds || []).length >= 1;
  const ready = attributionOk && supportOk;
  const disabled = !submitEnabled || !ready;
  // P0 fix (from Agent Player Simulation): whenever the button is disabled,
  // show a helper that names EXACTLY what is missing. Previously the helper
  // was gated on `submitEnabled && !ready` — so when criteria were missing
  // (submitEnabled=false), no explanation appeared and the player saw only a
  // grey button. Now we always show the helper on disabled, and it explains
  // the specific block:
  //   - missing report criteria (chain incomplete) — highest priority
  //   - missing attribution text
  //   - missing supporting evidence
  const chainMissing = !submitEnabled;
  const helperVisible = disabled;  // was: submitEnabled && !ready
  const missingChainHtml = chainMissing && Array.isArray(missingCriteriaLabels) && missingCriteriaLabels.length
    ? `<span data-helper-chain>${t('report.finalform.needs_chain')}: ${missingCriteriaLabels.map(esc).join(' · ')}</span>`
    : '';
  return `
    <section class="report-doc__attribution">
      <div class="report-doc__eyebrow">${t('report.attribution.eyebrow')}</div>
      <div class="report-doc__attribution-question">${esc(q)}</div>
      <input id="attribution-input" class="report-doc__attribution-input" type="text"
             placeholder="${esc(t('report.finalform.attribution_placeholder'))}"
             value="${esc(prefill.attribution || '')}">
      <div class="report-doc__evidence-prompt">${t('report.finalform.evidence_prompt')}</div>
      <div class="report-doc__evidence-options">
        ${evidenceOptionsHtml(prefill.supportingEvidenceIds || [])}
      </div>
      <div class="report-doc__submit">
        <button type="button" class="report-doc__submit-btn" data-action="submit-report" ${disabled ? 'disabled' : ''}>
          ${prefill.submittedOnce ? t('report.finalform.revise') : t('report.finalform.submit')}
        </button>
        <div class="report-doc__helper" data-helper style="display:${helperVisible ? 'block' : 'none'}">
          ${missingChainHtml}
          <span data-helper-attribution style="display:${(!chainMissing && !attributionOk) ? 'inline' : 'none'}">${t('report.finalform.needs_attribution')}</span>
          <span data-helper-sep style="display:${(!chainMissing && !attributionOk && !supportOk) ? 'inline' : 'none'}"> · </span>
          <span data-helper-support style="display:${(!chainMissing && !supportOk) ? 'inline' : 'none'}">${t('report.finalform.needs_support')}</span>
        </div>
      </div>
    </section>
  `;
}

function evidenceOptionLabel(e) {
  const snap = e.snapshot;
  let label = e.evidenceId + ' · ';
  if (snap.type === 'chat_profile') {
    label += (snap.handle ? '@' + snap.handle : snap.display_name);
  } else if (snap.type === 'archive_snapshot') {
    const kind = pick(snap, 'kind_label') || 'archive';
    label += kind + ' · ' + snap.captured_at;
  } else if (snap.type === 'atlas_location_claim') {
    label += snap.subject + ' — ' + snap.status;
  } else {
    label += (snap.username ? '@' + snap.username : (snap.display_name || snap.id));
  }
  return label;
}

function evidenceOptionsHtml(selectedIds) {
  const items = getState().evidence || [];
  if (!items.length) return `<div class="report-doc__no-evidence">${t('report.finalform.no_evidence')}</div>`;
  const sel = new Set(selectedIds || []);
  return items.map(e => `
    <label class="report-doc__option${sel.has(e.sourceId) ? ' is-selected' : ''}">
      <input type="checkbox" name="supporting" value="${esc(e.sourceId)}" ${sel.has(e.sourceId) ? 'checked' : ''}>
      <span>${esc(evidenceOptionLabel(e))}</span>
    </label>
  `).join('');
}

// ---- Quality panel (preserved) ----

function qualityRow(label, value) {
  return `
    <div class="quality-row">
      <div class="quality-row__label">${esc(label)}</div>
      <div class="quality-row__value">${esc(value)}</div>
    </div>
  `;
}
function localizedChainStatus(status) {
  if (status === 'COMPLETE')   return t('report.quality.chain.complete');
  if (status === 'INCOMPLETE') return t('report.quality.chain.incomplete');
  return t('report.quality.chain.empty');
}
function qualityPanelHtml(quality, showComposite) {
  const q = quality;
  const evidenceCount = (getState().evidence || []).length;
  return `
    <section class="quality">
      <div class="quality__title">${t('report.quality.title')}</div>
      <div class="quality__rows">
        ${qualityRow(t('report.quality.evidence_coverage'), t('report.quality.evidence_count', { n: evidenceCount }))}
        ${qualityRow(t('report.quality.required_chain'),    localizedChainStatus(q.chainRequired))}
        ${qualityRow(t('report.quality.independent'),       `${q.independentFindings.met} / ${q.independentFindings.total}`)}
        ${qualityRow(t('report.quality.diversity'),         `${q.sourceDiversity.toolsUsed.length} / ${q.sourceDiversity.total}`)}
        ${qualityRow(t('report.quality.temporal'),          `${q.temporalDepth.collectedSnapshots} / ${q.temporalDepth.availableSnapshots}`)}
        ${showComposite ? qualityRow(t('report.quality.composite'), `${q.overall} / 100`) : ''}
      </div>
    </section>
  `;
}

// ---- Outcome block (preserved verbatim styling) ----

function outcomeBlockHtml(submission, quality) {
  const sol = submission.outcome === 'SOLVED';
  // The persisted submission carries the derived outcome (set by state
  // handler under CR-1). We just display it — no re-evaluation here.
  const attrLine = esc(submission.attribution || '—');
  const selCount = (submission.supportingEvidenceIds || []).length;
  const evLine = t('report.outcome.support_short', { selected: selCount });
  const headline = sol ? t('report.outcome.headline.solved') : t('report.outcome.headline.closed');
  const verdictLabel = sol ? t('report.outcome.solved') : t('report.outcome.closed');
  return `
    <section class="outcome ${sol ? 'is-solved' : 'is-closed'}">
      <div class="outcome__label">${t('report.outcome.label')}</div>
      <div class="outcome__verdict">${esc(verdictLabel)}</div>
      <div class="outcome__headline">${esc(headline)}</div>
      <div class="outcome__grid">
        <div class="outcome__row">
          <div class="outcome__key">${t('report.outcome.key.quality')}</div>
          <div class="outcome__value">${quality.overall} / 100</div>
        </div>
        <div class="outcome__row">
          <div class="outcome__key">${t('report.outcome.key.attribution')}</div>
          <div class="outcome__value">${attrLine}</div>
        </div>
        <div class="outcome__row">
          <div class="outcome__key">${t('report.outcome.key.supporting')}</div>
          <div class="outcome__value">${evLine}</div>
        </div>
      </div>
    </section>
  `;
}

// ---- Render ----

let formState = { attribution: '', supportingEvidenceIds: [] };
let prevMetIds = new Set();
let prevSubmissionAt = null;
let hasEverRendered = false;

export function renderReportPane(paneEl, caseData) {
  const result = evaluateReport(caseData);
  const evidenceItems = getState().evidence || [];
  const earnedReasons = new Set(result.quality?.earnedReasons || []);

  // Partition required vs optional (corroboration) — corroboration keeps its
  // existing panel style (not a document section).
  const requiredSections = [];
  const optionalItems = [];
  for (const s of result.sections) {
    const allOptional = s.items.every(i => i.optional);
    if (allOptional) optionalItems.push(...s.items);
    else requiredSections.push(s);
  }

  const chainComplete = result.allMet;
  const submitted = !!result.submission;
  // P0 helper: labels of unmet REQUIRED criteria (optional/corroboration excluded).
  // Passed to attributionAndSubmitHtml so a disabled submit button lists exactly
  // which sections still need evidence — no more silent grey-out.
  const missingCriteriaLabels = [];
  for (const s of result.sections) {
    for (const it of s.items) {
      if (!it.optional && !it.met) {
        missingCriteriaLabels.push(pick(it, 'missing_label') || it.missing_label || it.label || it.id);
      }
    }
  }

  const currentMetIds = new Set();
  for (const s of requiredSections) {
    for (const it of s.items) if (it.met) currentMetIds.add(it.id);
  }
  const flippedIds = new Set();
  if (hasEverRendered) {
    for (const id of currentMetIds) if (!prevMetIds.has(id)) flippedIds.add(id);
  }
  const currentSubmissionAt = submitted ? result.submission.submittedAt : null;
  const outcomeAppearing = hasEverRendered && submitted && currentSubmissionAt !== prevSubmissionAt;

  const prefill = submitted
    ? {
        attribution: result.submission.attribution,
        supportingEvidenceIds: result.submission.supportingEvidenceIds,
        submittedOnce: true,
      }
    : {
        attribution: formState.attribution,
        supportingEvidenceIds: formState.supportingEvidenceIds,
        submittedOnce: false,
      };

  paneEl.innerHTML = `
    <div class="report-doc">
      <div class="report-doc__eyebrow report-doc__eyebrow--doc">${t('report.title')}</div>
      <h1 class="report-doc__doc-title">${t('report.doc.title')}</h1>
      <div class="report-doc__lede">${t('report.doc.lede')}</div>

      ${requiredSections.map(s => sectionHtml(s, caseData, evidenceItems, earnedReasons)).join('')}

      ${optionalItems.length ? corroborationHtml(optionalItems) : ''}

      ${chainComplete ? qualityPanelHtml(result.quality, submitted) : ''}

      ${attributionAndSubmitHtml(caseData, prefill, chainComplete, missingCriteriaLabels)}

      ${submitted ? outcomeBlockHtml(result.submission, result.quality) : ''}

      <div class="report-doc__footer">
        <button class="btn-ghost" data-action="review-evidence">${t('report.actions.review')}</button>
      </div>
    </div>
  `;

  for (const id of flippedIds) {
    const el = paneEl.querySelector(`.report-item[data-criterion="${id}"]`);
    if (el) {
      el.classList.add('is-just-met');
      setTimeout(() => el.classList.remove('is-just-met'), 800);
    }
  }
  if (outcomeAppearing) {
    const el = paneEl.querySelector('.outcome');
    if (el) {
      el.classList.add('is-appearing');
      setTimeout(() => el.classList.remove('is-appearing'), 900);
    }
  }
  prevMetIds = currentMetIds;
  prevSubmissionAt = currentSubmissionAt;
  hasEverRendered = true;

  paneEl.querySelector('[data-action="review-evidence"]')?.addEventListener('click', () => {
    setActiveTool('evidence');
  });

  function syncSubmitGate() {
    const attribution = (paneEl.querySelector('#attribution-input')?.value || '').trim();
    const selected = paneEl.querySelectorAll('.report-doc__option input[type=checkbox]:checked').length;
    const attributionOk = attribution.length >= 2;
    const supportOk = selected >= 1;
    const ready = attributionOk && supportOk;
    const disabled = !chainComplete || !ready;
    const btn = paneEl.querySelector('[data-action="submit-report"]');
    if (btn) btn.disabled = disabled;
    const helper = paneEl.querySelector('[data-helper]');
    if (helper) {
      // Whenever the button is disabled, the helper is visible with the reason.
      helper.style.display = disabled ? 'block' : 'none';
      const chainMissing = !chainComplete;
      const ha = paneEl.querySelector('[data-helper-attribution]');
      const hs = paneEl.querySelector('[data-helper-support]');
      const sep = paneEl.querySelector('[data-helper-sep]');
      // Chain hint is static per render (criteria don't change from typing).
      // Attribution/support hints hide when chain is the only issue — so the
      // player sees ONE clear reason at a time, not a stack.
      if (ha) ha.style.display = (!chainMissing && !attributionOk) ? 'inline' : 'none';
      if (hs) hs.style.display = (!chainMissing && !supportOk) ? 'inline' : 'none';
      if (sep) sep.style.display = (!chainMissing && !attributionOk && !supportOk) ? 'inline' : 'none';
    }
  }

  const input = paneEl.querySelector('#attribution-input');
  if (input) {
    input.addEventListener('input', () => {
      formState.attribution = input.value;
      syncSubmitGate();
    });
  }
  paneEl.querySelectorAll('.report-doc__option input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const sel = new Set(formState.supportingEvidenceIds);
      if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
      formState.supportingEvidenceIds = Array.from(sel);
      cb.closest('.report-doc__option').classList.toggle('is-selected', cb.checked);
      syncSubmitGate();
    });
  });

  const submitBtn = paneEl.querySelector('[data-action="submit-report"]');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (submitBtn.disabled) return;
      const attribution = (paneEl.querySelector('#attribution-input')?.value || '').trim();
      const selected = Array.from(paneEl.querySelectorAll('.report-doc__option input[type=checkbox]:checked'))
        .map(cb => cb.value);
      if (attribution.length < 2) return;
      if (selected.length < 1) return;
      formState.attribution = attribution;
      formState.supportingEvidenceIds = selected;
      // CR-1: no outcome in payload. State handler derives it via
      // evaluateSubmission and calls submitFinalReport.
      actions.emit('submit_report', {
        attribution,
        supportingEvidenceIds: selected,
      });
    });
  }
}

function corroborationHtml(optionalItems) {
  return `
    <section class="report-doc__section report-doc__section--corroboration">
      <div class="report-doc__eyebrow">${t('report.section.corroboration')}</div>
      <div class="report-doc__section-body">
        <div class="report-doc__corroboration-note">${t('report.corroboration.note')}</div>
        <ul class="report-doc__corroboration-list">
          ${optionalItems.map(item => {
            const label = pick(item, 'label') || item.label;
            return `
              <li class="report-doc__corroboration-item${item.met ? ' is-collected' : ''}">
                <span class="report-doc__corroboration-label">${esc(label)}</span>
                ${item.met ? `<span class="report-doc__corroboration-status">${t('report.corroboration.status_collected')}</span>` : ''}
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    </section>
  `;
}

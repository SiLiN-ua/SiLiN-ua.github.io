// ui/report-pane.js
// Renders CASE REPORT / FINAL REPORT. Fully derived from evidence state +
// persisted finalSubmission.

import { evaluateReport, evaluateSubmission } from '../engine/report.js';
import { setActiveTool, getState, submitFinalReport } from '../engine/state.js';
import { t, pick } from '../engine/i18n.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verdictText(evalResult) {
  if (evalResult.nothingCollected) return t('report.verdict.empty');
  if (evalResult.allMet) return t('report.verdict.complete');
  return t('report.verdict.incomplete');
}

// Map author-facing section names (from case.json) to i18n keys. Case files may
// eventually declare their own `section_uk`; if they don't, this table takes
// over. Adding a new section only requires either adding a key here OR adding
// `section_uk` / `section_en` fields in case.json.
const SECTION_KEY_BY_NAME = {
  'IDENTITY':                              'report.section.identity',
  'CONTENT':                               'report.section.content',
  'TEMPORAL PROOF':                        'report.section.temporal',
  'OPERATOR':                              'report.section.operator',
  'CORROBORATION':                         'report.section.corroboration',
  'CORROBORATION · INDEPENDENT FINDINGS':  'report.section.corroboration',
};

function localizedSectionName(name) {
  const key = SECTION_KEY_BY_NAME[String(name || '').toUpperCase()];
  return key ? t(key) : name;
}

// ---- Required checklist ----

function requiredItemHtml(item) {
  const label = pick(item, 'label') || item.label;
  if (item.met) {
    return `
      <li class="report-item is-met" data-criterion="${esc(item.id)}">
        <span class="report-item__mark">✓</span>
        <span class="report-item__label">${esc(label)}</span>
      </li>
    `;
  }
  const missing = pick(item, 'missing_label') || item.missing_label;
  return `
    <li class="report-item is-missing">
      <span class="report-item__mark">⚠</span>
      <span class="report-item__body">
        <span class="report-item__label">${esc(label)}:</span>
        <span class="report-item__missing">${esc(missing)}</span>
      </span>
    </li>
  `;
}

function requiredSectionHtml(section) {
  return `
    <section class="report-section">
      <div class="report-section__title">${esc(localizedSectionName(section.name))}</div>
      <ul class="report-section__items">
        ${section.items.map(requiredItemHtml).join('')}
      </ul>
    </section>
  `;
}

// ---- Independent findings (deliberately not a checklist) ----

function optionalItemHtml(item) {
  const label = pick(item, 'label') || item.label;
  return `
    <li class="report-finding${item.met ? ' is-collected' : ''}">
      <span class="report-finding__label">${esc(label)}</span>
      ${item.met ? `<span class="report-finding__status">${t('report.corroboration.status_collected')}</span>` : ''}
    </li>
  `;
}

function optionalPanelHtml(optionalItems) {
  if (!optionalItems.length) return '';
  return `
    <section class="report-findings">
      <div class="report-findings__title">${t('report.section.corroboration')}</div>
      <div class="report-findings__note">${t('report.corroboration.note')}</div>
      <ul class="report-findings__items">
        ${optionalItems.map(optionalItemHtml).join('')}
      </ul>
    </section>
  `;
}

// ---- Investigation quality dimensions ----

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

// ---- Final Report form ----

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

function evidenceOptionsHtml(caseData, selectedIds) {
  const items = getState().evidence || [];
  if (!items.length) return `<div class="finalform__no-evidence">${t('report.finalform.no_evidence')}</div>`;
  const sel = new Set(selectedIds || []);
  return items.map(e => `
    <label class="finalform__option${sel.has(e.sourceId) ? ' is-selected' : ''}">
      <input type="checkbox" name="supporting" value="${esc(e.sourceId)}" ${sel.has(e.sourceId) ? 'checked' : ''}>
      <span>${esc(evidenceOptionLabel(e))}</span>
    </label>
  `).join('');
}

function finalFormHtml(caseData, prefill, submitEnabled) {
  const q = pick(caseData.final_answer || {}, 'question') || 'Who is behind the account?';
  return `
    <section class="finalform">
      <div class="finalform__title">${t('report.finalform.title')}</div>

      <div class="finalform__field">
        <label class="finalform__label" for="attribution-input">${esc(q)}</label>
        <input id="attribution-input" class="finalform__input" type="text"
               placeholder="${esc(t('report.finalform.attribution_placeholder'))}"
               value="${esc(prefill.attribution || '')}">
      </div>

      <div class="finalform__field">
        <div class="finalform__label">${t('report.finalform.evidence_prompt')}</div>
        <div class="finalform__options">
          ${evidenceOptionsHtml(caseData, prefill.supportingEvidenceIds || [])}
        </div>
      </div>

      <div class="finalform__actions">
        <button class="btn-primary" data-action="submit-report" ${submitEnabled ? '' : 'disabled'}>
          ${prefill.submittedOnce ? t('report.finalform.revise') : t('report.finalform.submit')}
        </button>
      </div>
    </section>
  `;
}

// ---- Outcome block ----

function outcomeBlockHtml(caseData, submission, quality) {
  const sol = submission.outcome === 'SOLVED';
  const evaluation = evaluateSubmission(caseData, {
    attribution: submission.attribution,
    supportingEvidenceIds: submission.supportingEvidenceIds,
  });
  const attrTag = evaluation.attributionOk ? t('report.outcome.attr.match') : t('report.outcome.attr.no_match');
  const attrLine = `${esc(submission.attribution || '—')} · ${attrTag}`;
  const evLine = t('report.outcome.support', {
    selected: evaluation.selectedCount,
    matches: evaluation.requiredMatchesCount,
    required: evaluation.minCount,
  });
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

// ---- Main render ----

let formState = { attribution: '', supportingEvidenceIds: [] };

// Track which required criterion ids were "met" on the last render so we can
// mark the ones that just flipped false→true and let CSS animate the transition.
let prevMetIds = new Set();
let prevSubmissionAt = null;
let hasEverRendered = false;

export function renderReportPane(paneEl, caseData) {
  const result = evaluateReport(caseData);

  const requiredSections = [];
  const optionalItems = [];
  for (const s of result.sections) {
    const allOptional = s.items.every(i => i.optional);
    if (allOptional) optionalItems.push(...s.items);
    else requiredSections.push(s);
  }

  const chainComplete = result.allMet;
  const submitted = !!result.submission;

  // Detect items that just flipped miss→met since the last render.
  // Suppress on the very first render (post-reload restore is not a flip).
  const currentMetIds = new Set();
  for (const s of requiredSections) {
    for (const it of s.items) if (it.met) currentMetIds.add(it.id);
  }
  const flippedIds = new Set();
  if (hasEverRendered) {
    for (const id of currentMetIds) if (!prevMetIds.has(id)) flippedIds.add(id);
  }

  // Detect a brand-new submission this render (same suppression rule).
  const currentSubmissionAt = submitted ? result.submission.submittedAt : null;
  const outcomeAppearing = hasEverRendered
    && submitted
    && currentSubmissionAt !== prevSubmissionAt;

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
    <div class="report">
      <div class="report__title">${t('report.title')}</div>

      ${requiredSections.map(requiredSectionHtml).join('')}

      <div class="report__divider"></div>

      <div class="report__verdict ${chainComplete ? 'is-complete' : ''}">
        ${esc(verdictText(result))}
      </div>

      <div class="report__actions">
        <button class="btn-ghost" data-action="review-evidence">${t('report.actions.review')}</button>
      </div>

      ${optionalItems.length ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${optionalPanelHtml(optionalItems)}

      ${chainComplete ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${chainComplete ? qualityPanelHtml(result.quality, submitted) : ''}

      ${chainComplete ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${chainComplete ? finalFormHtml(caseData, prefill, chainComplete) : ''}

      ${submitted ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${submitted ? outcomeBlockHtml(caseData, result.submission, result.quality) : ''}
    </div>
  `;

  // Mark just-flipped criteria for the CSS anim, then persist current
  // state as the new baseline for the next render.
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

  paneEl.querySelector('[data-action="review-evidence"]').addEventListener('click', () => {
    setActiveTool('evidence');
  });

  const input = paneEl.querySelector('#attribution-input');
  if (input) {
    input.addEventListener('input', () => { formState.attribution = input.value; });
  }
  paneEl.querySelectorAll('.finalform__option input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const sel = new Set(formState.supportingEvidenceIds);
      if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
      formState.supportingEvidenceIds = Array.from(sel);
      cb.closest('.finalform__option').classList.toggle('is-selected', cb.checked);
    });
  });

  const submitBtn = paneEl.querySelector('[data-action="submit-report"]');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (submitBtn.disabled) return;
      const attribution = (paneEl.querySelector('#attribution-input')?.value || '').trim();
      const selected = Array.from(paneEl.querySelectorAll('.finalform__option input[type=checkbox]:checked'))
        .map(cb => cb.value);
      if (attribution.length < 2) return;
      if (selected.length < 1) return;
      const evalRes = evaluateSubmission(caseData, {
        attribution,
        supportingEvidenceIds: selected,
      });
      formState.attribution = attribution;
      formState.supportingEvidenceIds = selected;
      // submitFinalReport emits submission_updated → workstation subscribes
      // and re-renders REPORT once. Avoid a second inline render — a double
      // render would overwrite the .outcome element that just got the
      // is-appearing animation class.
      submitFinalReport({
        attribution,
        supportingEvidenceIds: selected,
        outcome: evalRes.outcome,
      });
    });
  }
}

// ui/report-pane.js
// Renders CASE REPORT / FINAL REPORT. Fully derived from evidence state +
// persisted finalSubmission. UI reflects three orthogonal states:
//
//   PHASE 1 — chain incomplete
//     required checklist + verdict + Review-evidence + INDEPENDENT FINDINGS
//   PHASE 2 — chain complete, no submission yet
//     everything from PHASE 1 + INVESTIGATION QUALITY dimensions (no composite)
//     + FINAL REPORT form (attribution + evidence multi-select + Submit)
//   PHASE 3 — after submission
//     everything from PHASE 2 + OUTCOME block (SOLVED / CLOSED + composite
//     quality score + Revise). Composite score is only shown AFTER submit.

import { evaluateReport, evaluateSubmission } from '../engine/report.js';
import { setActiveTool, getState, submitFinalReport } from '../engine/state.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verdictText(evalResult) {
  if (evalResult.nothingCollected) {
    return "Nothing to report yet. Start with the client's message in FRAME.";
  }
  if (evalResult.allMet) return 'Evidence chain complete.';
  return 'Your conclusion is plausible. Your evidence chain is incomplete.';
}

// ---- Required checklist ----

function requiredItemHtml(item) {
  if (item.met) {
    return `
      <li class="report-item is-met">
        <span class="report-item__mark">✓</span>
        <span class="report-item__label">${esc(item.label)}</span>
      </li>
    `;
  }
  return `
    <li class="report-item is-missing">
      <span class="report-item__mark">⚠</span>
      <span class="report-item__body">
        <span class="report-item__label">${esc(item.label)}:</span>
        <span class="report-item__missing">${esc(item.missing_label)}</span>
      </span>
    </li>
  `;
}

function requiredSectionHtml(section) {
  return `
    <section class="report-section">
      <div class="report-section__title">${esc(section.name)}</div>
      <ul class="report-section__items">
        ${section.items.map(requiredItemHtml).join('')}
      </ul>
    </section>
  `;
}

// ---- Independent findings (deliberately not a checklist) ----

function optionalItemHtml(item) {
  return `
    <li class="report-finding${item.met ? ' is-collected' : ''}">
      <span class="report-finding__label">${esc(item.label)}</span>
      ${item.met ? '<span class="report-finding__status">collected</span>' : ''}
    </li>
  `;
}

function optionalPanelHtml(optionalItems) {
  if (!optionalItems.length) return '';
  return `
    <section class="report-findings">
      <div class="report-findings__title">CORROBORATION · INDEPENDENT FINDINGS</div>
      <div class="report-findings__note">These findings do not affect the verdict.</div>
      <ul class="report-findings__items">
        ${optionalItems.map(optionalItemHtml).join('')}
      </ul>
    </section>
  `;
}

// ---- Investigation quality dimensions (PHASE 2 & 3) ----

function qualityRow(label, value) {
  return `
    <div class="quality-row">
      <div class="quality-row__label">${esc(label)}</div>
      <div class="quality-row__value">${esc(value)}</div>
    </div>
  `;
}

function qualityPanelHtml(quality, showComposite) {
  const q = quality;
  const evidenceCount = (getState().evidence || []).length;
  return `
    <section class="quality">
      <div class="quality__title">INVESTIGATION QUALITY</div>
      <div class="quality__rows">
        ${qualityRow('Evidence coverage', `${evidenceCount} collected`)}
        ${qualityRow('Required chain',    q.chainRequired)}
        ${qualityRow('Independent corroboration', `${q.independentFindings.met} / ${q.independentFindings.total}`)}
        ${qualityRow('Source diversity',  `${q.sourceDiversity.toolsUsed.length} / ${q.sourceDiversity.total}`)}
        ${qualityRow('Temporal depth',    `${q.temporalDepth.collectedSnapshots} / ${q.temporalDepth.availableSnapshots}`)}
        ${showComposite ? qualityRow('Composite', `${q.overall} / 100`) : ''}
      </div>
    </section>
  `;
}

// ---- Final Report form (PHASE 2 & 3) ----

function evidenceOptionsHtml(caseData, selectedIds) {
  const items = getState().evidence || [];
  if (!items.length) return '<div class="finalform__no-evidence">No evidence to attach.</div>';
  const sel = new Set(selectedIds || []);
  return items.map(e => {
    const snap = e.snapshot;
    let label = e.evidenceId + ' · ';
    if (snap.type === 'chat_profile') label += (snap.handle ? '@' + snap.handle : snap.display_name);
    else if (snap.type === 'archive_snapshot') label += (snap.kind_label || 'archive') + ' · ' + snap.captured_at;
    else if (snap.type === 'atlas_location_claim') label += snap.subject + ' — ' + snap.status;
    else label += (snap.username ? '@' + snap.username : (snap.display_name || snap.id));
    return `
      <label class="finalform__option${sel.has(e.sourceId) ? ' is-selected' : ''}">
        <input type="checkbox" name="supporting" value="${esc(e.sourceId)}" ${sel.has(e.sourceId) ? 'checked' : ''}>
        <span>${esc(label)}</span>
      </label>
    `;
  }).join('');
}

function finalFormHtml(caseData, prefill, submitEnabled) {
  const q = caseData.final_answer?.question || 'Who is behind the account?';
  return `
    <section class="finalform">
      <div class="finalform__title">FINAL REPORT</div>

      <div class="finalform__field">
        <label class="finalform__label" for="attribution-input">${esc(q)}</label>
        <input id="attribution-input" class="finalform__input" type="text"
               placeholder="Your attribution…"
               value="${esc(prefill.attribution || '')}">
      </div>

      <div class="finalform__field">
        <div class="finalform__label">Which evidence supports your attribution?</div>
        <div class="finalform__options">
          ${evidenceOptionsHtml(caseData, prefill.supportingEvidenceIds || [])}
        </div>
      </div>

      <div class="finalform__actions">
        <button class="btn-primary" data-action="submit-report" ${submitEnabled ? '' : 'disabled'}>
          ${prefill.submittedOnce ? 'Revise submission' : 'Submit report'}
        </button>
      </div>
    </section>
  `;
}

// ---- Outcome block (PHASE 3) ----

function outcomeBlockHtml(caseData, submission, quality) {
  const sol = submission.outcome === 'SOLVED';
  const evaluation = evaluateSubmission(caseData, {
    attribution: submission.attribution,
    supportingEvidenceIds: submission.supportingEvidenceIds,
  });
  const attrLine = evaluation.attributionOk
    ? `${esc(submission.attribution)} · match`
    : `${esc(submission.attribution || '—')} · no match`;
  const evLine = `${evaluation.selectedCount} selected · ${evaluation.requiredMatchesCount} of ${evaluation.minCount} required matches`;
  const headline = sol
    ? 'Your attribution is supported by the evidence you selected.'
    : 'Your attribution is filed with the evidence you selected.';

  return `
    <section class="outcome ${sol ? 'is-solved' : 'is-closed'}">
      <div class="outcome__label">OUTCOME</div>
      <div class="outcome__verdict">CASE ${sol ? 'SOLVED' : 'CLOSED'}</div>
      <div class="outcome__headline">${esc(headline)}</div>
      <div class="outcome__grid">
        <div class="outcome__row">
          <div class="outcome__key">Investigation quality</div>
          <div class="outcome__value">${quality.overall} / 100</div>
        </div>
        <div class="outcome__row">
          <div class="outcome__key">Attribution</div>
          <div class="outcome__value">${attrLine}</div>
        </div>
        <div class="outcome__row">
          <div class="outcome__key">Supporting evidence</div>
          <div class="outcome__value">${evLine}</div>
        </div>
      </div>
    </section>
  `;
}

// ---- Main render ----

let formState = { attribution: '', supportingEvidenceIds: [] };

export function renderReportPane(paneEl, caseData) {
  const result = evaluateReport(caseData);
  const state = getState();

  // Split required vs optional sections
  const requiredSections = [];
  const optionalItems = [];
  for (const s of result.sections) {
    const allOptional = s.items.every(i => i.optional);
    if (allOptional) optionalItems.push(...s.items);
    else requiredSections.push(s);
  }

  const chainComplete = result.allMet;
  const submitted = !!result.submission;
  const showQuality = chainComplete;                     // PHASE 2 or 3
  const showComposite = submitted;                       // PHASE 3 only
  const showForm = chainComplete;                        // PHASE 2 or 3
  const showOutcome = submitted;                         // PHASE 3

  // Prefill form: latest submission or in-memory formState
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
      <div class="report__title">CASE REPORT</div>

      ${requiredSections.map(requiredSectionHtml).join('')}

      <div class="report__divider"></div>

      <div class="report__verdict ${chainComplete ? 'is-complete' : ''}">
        ${esc(verdictText(result))}
      </div>

      <div class="report__actions">
        <button class="btn-ghost" data-action="review-evidence">Review evidence →</button>
      </div>

      ${optionalItems.length ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${optionalPanelHtml(optionalItems)}

      ${showQuality ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${showQuality ? qualityPanelHtml(result.quality, showComposite) : ''}

      ${showForm ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${showForm ? finalFormHtml(caseData, prefill, chainComplete) : ''}

      ${showOutcome ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${showOutcome ? outcomeBlockHtml(caseData, result.submission, result.quality) : ''}
    </div>
  `;

  paneEl.querySelector('[data-action="review-evidence"]').addEventListener('click', () => {
    setActiveTool('evidence');
  });

  // Wire form (only if rendered)
  const input = paneEl.querySelector('#attribution-input');
  if (input) {
    input.addEventListener('input', () => { formState.attribution = input.value; });
  }
  paneEl.querySelectorAll('.finalform__option input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const sel = new Set(formState.supportingEvidenceIds);
      if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
      formState.supportingEvidenceIds = Array.from(sel);
      // Toggle visual selected class inline (avoid full re-render)
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
      submitFinalReport({
        attribution,
        supportingEvidenceIds: selected,
        outcome: evalRes.outcome,
      });
      // Sync in-memory form to submitted values
      formState.attribution = attribution;
      formState.supportingEvidenceIds = selected;
      // Re-render (submission_updated event also triggers workstation re-render)
      renderReportPane(paneEl, caseData);
    });
  }
}

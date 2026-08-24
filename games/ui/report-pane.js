// ui/report-pane.js
// Renders the mini Final Report checkpoint. Fully derived from evidence state.
// Never persists anything of its own. Never says "search X" or "add Y" — only
// reports which required criteria are met and which are not, and separately
// lists independent findings (optional) that do not affect the verdict.
//
// Layout order (deliberate — playtest #5 showed that a single mixed list was
// read as one to-do, even with different markers):
//   1. Required sections
//   2. Divider
//   3. Verdict
//   4. Divider
//   5. Optional section titled "CORROBORATION · INDEPENDENT FINDINGS"
//      with an explicit note that these do not affect the verdict, rendered
//      without checklist-style markers.

import { evaluateReport } from '../engine/report.js';
import { setActiveTool } from '../engine/state.js';

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
  if (evalResult.allMet) {
    return 'Evidence chain complete.';
  }
  return 'Your conclusion is plausible. Your evidence chain is incomplete.';
}

// ---- Required items (checklist-style) ----

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

// ---- Optional items (independent findings — deliberately NOT a checklist) ----

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

export function renderReportPane(paneEl, caseData) {
  const result = evaluateReport(caseData);

  // Split sections into required and optional. A section counts as optional
  // if every item inside is optional (mirrors the case-authoring convention).
  const requiredSections = [];
  const optionalItems = [];
  for (const s of result.sections) {
    const allOptional = s.items.every(i => i.optional);
    if (allOptional) {
      optionalItems.push(...s.items);
    } else {
      requiredSections.push(s);
    }
  }

  paneEl.innerHTML = `
    <div class="report">
      <div class="report__title">CASE REPORT</div>

      ${requiredSections.map(requiredSectionHtml).join('')}

      <div class="report__divider"></div>

      <div class="report__verdict ${result.allMet ? 'is-complete' : ''}">
        ${esc(verdictText(result))}
      </div>

      <div class="report__actions">
        <button class="btn-ghost" data-action="review-evidence">Review evidence →</button>
      </div>

      ${optionalItems.length ? `<div class="report__divider report__divider--wide"></div>` : ''}
      ${optionalPanelHtml(optionalItems)}
    </div>
  `;

  paneEl.querySelector('[data-action="review-evidence"]').addEventListener('click', () => {
    setActiveTool('evidence');
  });
}

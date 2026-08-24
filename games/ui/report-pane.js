// ui/report-pane.js
// Renders the mini Final Report checkpoint. Fully derived from evidence state.
// Never persists anything of its own. Never says "search X" or "add Y" — only
// reports which criteria are met and which are not.

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

function itemHtml(item) {
  if (item.optional) {
    if (item.met) {
      return `
        <li class="report-item is-met is-optional">
          <span class="report-item__mark">✓</span>
          <span class="report-item__label">${esc(item.label)}</span>
        </li>
      `;
    }
    return `
      <li class="report-item is-optional is-open">
        <span class="report-item__mark">·</span>
        <span class="report-item__label">${esc(item.label)}</span>
      </li>
    `;
  }
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

function sectionHtml(section) {
  const isOptionalSection = section.items.every(i => i.optional);
  return `
    <section class="report-section${isOptionalSection ? ' is-optional-section' : ''}">
      <div class="report-section__title">
        ${esc(section.name)}${isOptionalSection ? ' <span class="report-section__note">· optional</span>' : ''}
      </div>
      <ul class="report-section__items">
        ${section.items.map(itemHtml).join('')}
      </ul>
    </section>
  `;
}

export function renderReportPane(paneEl, caseData) {
  const result = evaluateReport(caseData);

  paneEl.innerHTML = `
    <div class="report">
      <div class="report__title">CASE REPORT</div>

      ${result.sections.map(sectionHtml).join('')}

      <div class="report__divider"></div>

      <div class="report__verdict ${result.allMet ? 'is-complete' : ''}">
        ${esc(verdictText(result))}
      </div>

      <div class="report__actions">
        <button class="btn-ghost" data-action="review-evidence">Review evidence →</button>
      </div>
    </div>
  `;

  paneEl.querySelector('[data-action="review-evidence"]').addEventListener('click', () => {
    setActiveTool('evidence');
  });
}

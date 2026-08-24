// engine/dates.js
// Locale-aware date formatting for the small set of date shapes CASE 001 uses.
// Kept intentionally small — no full Intl.DateTimeFormat, no relative-time
// engine. What the game actually needs is one thing:
//
//   formatJoined("March 2024", "uk") → "березня 2024"
//
// Every player-facing string that contains a `joined` value renders after the
// preposition «з» in Ukrainian ("На платформі з …"), which takes the
// genitive case. So the UA month always comes out in genitive.
//
// Inputs the game actually feeds this function:
//   "March 2024"   "August 2018"   "January 2019"   "May 2020"
//   "Feb 2024"     "Aug 2018"      "2019"           "2018"
//
// Anything the parser doesn't recognise is returned unchanged.

const MONTH_UK_GENITIVE = {
  january:   'січня',
  february:  'лютого',
  march:     'березня',
  april:     'квітня',
  may:       'травня',
  june:      'червня',
  july:      'липня',
  august:    'серпня',
  september: 'вересня',
  october:   'жовтня',
  november:  'листопада',
  december:  'грудня',
  // 3-letter abbreviations as seen in current case content
  jan: 'січня', feb: 'лютого', mar: 'березня', apr: 'квітня',
  jun: 'червня', jul: 'липня', aug: 'серпня',
  sep: 'вересня', sept: 'вересня',
  oct: 'жовтня', nov: 'листопада', dec: 'грудня',
};

// Parses "March 2024" / "Aug 2018" / "2019" / "2018". Returns null if none.
function parseJoined(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const mm = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (mm) return { month: mm[1].toLowerCase(), year: mm[2] };
  const yy = s.match(/^(\d{4})$/);
  if (yy) return { month: null, year: yy[1] };
  return null;
}

// The joined value renders in the flow of a sentence introduced by «з».
// Ukrainian: month goes in genitive; a bare year stays as a year.
// English: pass through — nothing to translate.
// Unknown locale or unparseable input: pass through.
export function formatJoined(str, lang) {
  if (lang !== 'uk') return String(str || '');
  const parsed = parseJoined(str);
  if (!parsed) return String(str || '');
  if (!parsed.month) return parsed.year;
  const month = MONTH_UK_GENITIVE[parsed.month];
  if (!month) return String(str);
  return `${month} ${parsed.year}`;
}

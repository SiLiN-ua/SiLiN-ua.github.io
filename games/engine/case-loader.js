// engine/case-loader.js
// Loads a case.json descriptor. Session 1: only case-001.

export async function loadCase(caseId) {
  const url = `cases/${caseId}/case.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`case load failed: ${caseId} (${res.status})`);
  const data = await res.json();
  data.__basePath = `cases/${caseId}/`;
  return data;
}

// Resolve an asset path stored relative to the case folder.
export function resolveAsset(caseData, path) {
  if (!path) return '';
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return caseData.__basePath + path;
}

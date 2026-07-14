/* Content loader — fetches JSON files from GitHub Contents API for a public repo.
   Works on GitHub Pages without any build step.
   Config: set REPO / BRANCH to match your setup.
*/
(function () {
  'use strict';

  const REPO   = 'SiLiN-ua/silin-ua.github.io';   // адаптуй якщо репо назвався інакше
  const BRANCH = 'main';
  const API    = `https://api.github.com/repos/${REPO}/contents`;

  const CACHE = {};
  const LANG = () => (localStorage.getItem('ys_lang') || 'uk');

  async function listCollection(name) {
    if (CACHE[name]) return CACHE[name];
    try {
      const res = await fetch(`${API}/content/${name}?ref=${BRANCH}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) throw new Error('list failed: ' + res.status);
      const files = await res.json();
      const jsonFiles = files.filter(f => f.name.endsWith('.json'));
      const items = await Promise.all(jsonFiles.map(async f => {
        const r = await fetch(f.download_url + '?t=' + Date.now());
        const data = await r.json();
        data.__slug = f.name.replace(/\.json$/, '');
        return data;
      }));
      const visible = items.filter(x => x.published !== false);
      if (name === 'books') {
        visible.sort((a, b) => (a.order || 0) - (b.order || 0));
      } else {
        visible.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      CACHE[name] = visible;
      return visible;
    } catch (e) {
      console.warn('content load failed', e);
      return [];
    }
  }

  async function loadBySlug(name, slug) {
    const list = await listCollection(name);
    return list.find(x => x.__slug === slug);
  }

  function tr(item, field) {
    const lang = LANG();
    return item[field + '_' + lang] || item[field + '_uk'] || item[field] || '';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(LANG() === 'uk' ? 'uk-UA' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return iso; }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderCard(item, collection, readMoreText) {
    const title = escapeHtml(tr(item, 'title'));
    const desc  = escapeHtml(tr(item, 'summary'));
    const tag   = escapeHtml(item.tag || '');
    const date  = escapeHtml(fmtDate(item.date));
    const href  = `${collection === 'cases' ? 'cases' : 'blog'}.html?slug=${encodeURIComponent(item.__slug)}`;
    return `
      <article class="card reveal">
        ${tag ? `<div class="card__tag">${tag}</div>` : ''}
        ${date ? `<div class="card__date">${date}</div>` : ''}
        <h3>${title}</h3>
        <p>${desc}</p>
        <a href="${href}" class="card__link">${readMoreText}</a>
      </article>`;
  }

  function renderBookCard(item) {
    const title = escapeHtml(tr(item, 'title'));
    const desc  = escapeHtml(tr(item, 'description'));
    const year  = escapeHtml(item.year || '');
    const langs = escapeHtml(item.languages || '');
    const cover = item.cover ? `<img src="${escapeHtml(item.cover)}" alt="${title}" style="width:100%;height:100%;object-fit:cover">` : `<h3>${title}</h3>`;
    const links = [];
    if (item.pdf_url_uk) links.push(`<a href="${escapeHtml(item.pdf_url_uk)}" target="_blank" rel="noopener" class="btn" style="padding:.6rem 1rem;font-size:.7rem">📖 Читати українською</a>`);
    if (item.patreon_url) links.push(`<a href="${escapeHtml(item.patreon_url)}" target="_blank" rel="noopener" class="btn btn--ghost" style="padding:.6rem 1rem;font-size:.7rem">🇬🇧 English on Patreon ↗</a>`);
    if (!links.length && item.buy_url) links.push(`<a href="${escapeHtml(item.buy_url)}" target="_blank" rel="noopener" class="card__link">Читати ↗</a>`);
    return `
      <div class="book reveal">
        <div class="book__cover">${cover}</div>
        <div>
          <div class="book__meta">${year}${langs ? ' · ' + langs : ''}</div>
          <h4>${title}</h4>
          <p>${desc}</p>
          <div style="display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1rem">${links.join('')}</div>
        </div>
      </div>`;
  }

  function renderArticle(item) {
    const title = escapeHtml(tr(item, 'title'));
    const tag   = escapeHtml(item.tag || '');
    const date  = escapeHtml(fmtDate(item.date));
    const body  = tr(item, 'body');
    const bodyHtml = window.marked ? window.marked.parse(body || '') : escapeHtml(body).replace(/\n/g, '<br>');
    const linkedin = item.linkedin
      ? `<p style="text-align:center;margin-top:3rem"><a href="${escapeHtml(item.linkedin)}" target="_blank" rel="noopener" class="btn">Оригінал на LinkedIn ↗</a></p>`
      : '';
    return `
      <div class="article-meta">
        ${tag ? `<span class="eyebrow">${tag}${date ? ' · ' + date : ''}</span>` : (date ? `<span class="eyebrow">${date}</span>` : '')}
        <h1>${title}</h1>
      </div>
      <div>${bodyHtml}</div>
      ${linkedin}`;
  }

  function getSlugParam() {
    return new URLSearchParams(location.search).get('slug');
  }

  async function renderListOrArticle(collection, targetSelector, singleTargetSelector, readMoreText) {
    const slug = getSlugParam();
    if (slug && singleTargetSelector) {
      const item = await loadBySlug(collection, slug);
      const target = document.querySelector(singleTargetSelector);
      if (!target) return;
      target.innerHTML = item ? renderArticle(item) : `<p>Не знайдено. <a href="?">← Назад</a></p>`;
      if (item) document.title = tr(item, 'title') + ' · Єгор Селін';
      return;
    }
    const items = await listCollection(collection);
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (items.length === 0) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо. Заходь на <a href="admin/">/admin</a> та додавай.</p>`;
      return;
    }
    target.innerHTML = items.map(x => renderCard(x, collection, readMoreText)).join('');
  }

  async function renderBooks(targetSelector) {
    const items = await listCollection('books');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (items.length === 0) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо. Заходь на <a href="admin/">/admin</a> та додавай.</p>`;
      return;
    }
    const lang = LANG();
    const i18n = (window.__i18nDict && window.__i18nDict[lang]) || {};
    const label = (k, fb) => i18n[k] || fb;
    const CAT_ORDER = ['educational', 'memoir', 'fiction'];
    const groups = {};
    items.forEach(it => {
      const cat = it.category || 'other';
      (groups[cat] = groups[cat] || []).push(it);
    });
    const ordered = [...CAT_ORDER.filter(c => groups[c]), ...Object.keys(groups).filter(c => !CAT_ORDER.includes(c))];
    target.innerHTML = ordered.map(cat => {
      const title = label('books.cat.' + cat, cat);
      const desc  = label('books.cat.' + cat + '.desc', '');
      const cards = groups[cat].map(renderBookCard).join('');
      return `
        <section class="book-category reveal" style="margin-bottom:5rem">
          <div style="margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">
            <h2 style="font-size:clamp(1.6rem,2.6vw,2.2rem);margin-bottom:.35rem" data-i18n="books.cat.${cat}">${escapeHtml(title)}</h2>
            ${desc ? `<p style="color:var(--text-dim);font-size:.95rem" data-i18n="books.cat.${cat}.desc">${escapeHtml(desc)}</p>` : ''}
          </div>
          <div class="book-grid">${cards}</div>
        </section>`;
    }).join('');
  }

  async function renderPreview(collection, targetSelector, limit, readMoreText) {
    const items = (await listCollection(collection)).slice(0, limit);
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (items.length === 0) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0;grid-column:1/-1">Поки що порожньо.</p>`;
      return;
    }
    target.innerHTML = items.map(x => renderCard(x, collection, readMoreText)).join('');
  }

  function renderToolCard(item) {
    const name = escapeHtml(tr(item, 'name') || tr(item, 'title'));
    const cat  = escapeHtml(tr(item, 'category') || item.category || '');
    const desc = escapeHtml(tr(item, 'description') || tr(item, 'summary'));
    const url  = escapeHtml(item.url || '');
    const isOwn = item.own_project ? '<span style="color:var(--cyan);font-family:var(--font-mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.15em;margin-left:.5rem">· мій</span>' : '';
    const detailHref = `tools.html?slug=${encodeURIComponent(item.__slug)}`;
    const hasBody = !!(tr(item, 'body'));
    const primary = hasBody
      ? `<a href="${detailHref}" class="card__link">Читати огляд →</a>`
      : (url ? `<a href="${url}" target="_blank" rel="noopener" class="card__link">Відкрити ↗</a>` : '');
    return `
      <article class="card reveal">
        ${cat ? `<div class="card__tag">${cat}</div>` : ''}
        <h3>${name}${isOwn}</h3>
        <p>${desc}</p>
        ${primary}
      </article>`;
  }

  async function renderTools(targetSelector) {
    const items = await listCollection('tools');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (items.length === 0) {
      target.innerHTML = `<p class="center" style="grid-column:1/-1;color:var(--text-mute);padding:2rem 0">Поки що порожньо. Заходь на <a href="admin/">/admin</a> та додавай.</p>`;
      return;
    }
    target.innerHTML = items.map(renderToolCard).join('');
  }

  async function renderToolsListOrArticle(listSelector, articleSelector) {
    const slug = getSlugParam();
    if (slug) {
      const item = await loadBySlug('tools', slug);
      const target = document.querySelector(articleSelector);
      if (!target) return;
      if (!item) { target.innerHTML = `<p>Не знайдено.</p>`; return; }
      const title = escapeHtml(tr(item, 'name') || tr(item, 'title'));
      const cat   = escapeHtml(tr(item, 'category') || item.category || '');
      const body  = tr(item, 'body');
      const bodyHtml = window.marked ? window.marked.parse(body || '') : escapeHtml(body).replace(/\n/g, '<br>');
      const link  = item.url ? `<p style="text-align:center;margin-top:3rem"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="btn">Перейти до інструменту ↗</a></p>` : '';
      target.innerHTML = `
        <div class="article-meta">
          ${cat ? `<span class="eyebrow">${cat}</span>` : ''}
          <h1>${title}</h1>
        </div>
        <div>${bodyHtml}</div>
        ${link}`;
      document.title = title + ' · Єгор Селін';
      return;
    }
    await renderTools(listSelector);
  }

  window.YSContent = { renderListOrArticle, renderBooks, renderPreview, renderTools, renderToolsListOrArticle };
})();

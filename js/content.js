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
      const res = await fetch(`${API}/content/${name}?ref=${BRANCH}&t=${Date.now()}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store'
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
    const cover = item.cover
      ? `<div class="card__cover"><img src="${escapeHtml(item.cover)}" alt="" loading="lazy"></div>`
      : '';
    const source = item.source
      ? `<div style="font-family:var(--font-mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--text-mute);margin-top:1rem">Джерело · ${escapeHtml(item.source)}</div>`
      : '';
    return `
      <article class="card ${cover ? 'card--with-cover' : ''}">
        ${cover}
        <div class="card__body">
          ${tag ? `<div class="card__tag">${tag}</div>` : ''}
          ${date ? `<div class="card__date">${date}</div>` : ''}
          <h3>${title}</h3>
          <p>${desc}</p>
          ${source}
          <a href="${href}" class="card__link">${readMoreText}</a>
        </div>
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
      <div class="book">
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
    const body  = tr(item, 'body') || tr(item, 'summary');
    const bodyHtml = window.marked ? window.marked.parse(body || '') : escapeHtml(body).replace(/\n/g, '<br>');
    const cover  = item.cover
      ? `<div style="margin:2rem 0"><img src="${escapeHtml(item.cover)}" alt="" style="width:100%;max-height:420px;object-fit:cover;border:1px solid var(--border)"></div>`
      : '';
    const source = (item.source || item.source_url)
      ? `<div style="border:1px solid var(--border);border-left:2px solid var(--ice);padding:1rem 1.25rem;margin:2rem 0;background:rgba(15,21,36,.6);font-size:.9rem">
          <div style="font-family:var(--font-mono);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ice);margin-bottom:.4rem">Джерело</div>
          ${item.source ? `<div style="color:var(--cream)">${escapeHtml(item.source)}</div>` : ''}
          ${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" style="color:var(--ice-glow);word-break:break-all">${escapeHtml(item.source_url)}</a>` : ''}
        </div>`
      : '';
    const primary = item.source_url
      ? `<p style="text-align:center;margin-top:3rem"><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" class="btn">Перейти до джерела ↗</a></p>`
      : (item.linkedin
        ? `<p style="text-align:center;margin-top:3rem"><a href="${escapeHtml(item.linkedin)}" target="_blank" rel="noopener" class="btn">Оригінал на LinkedIn ↗</a></p>`
        : '');
    return `
      <div class="article-meta">
        ${tag ? `<span class="eyebrow">${tag}${date ? ' · ' + date : ''}</span>` : (date ? `<span class="eyebrow">${date}</span>` : '')}
        <h1>${title}</h1>
      </div>
      ${cover}
      ${source}
      <div>${bodyHtml}</div>
      ${primary}`;
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

  let __booksState = { current: 'all' };

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

    const counts = { all: items.length };
    items.forEach(it => {
      const c = it.category || 'other';
      counts[c] = (counts[c] || 0) + 1;
    });

    const activeCats = [...CAT_ORDER, ...Object.keys(counts).filter(c => !CAT_ORDER.includes(c) && c !== 'all')];

    const pills = [
      { key: 'all', title: label('books.filter.all', 'Усі') },
      ...activeCats.filter(c => counts[c]).map(c => ({ key: c, title: label('books.cat.' + c, c) }))
    ];

    const pillsHtml = pills.map(p => `
      <button class="filter-pill ${p.key === __booksState.current ? 'active' : ''}" data-cat="${p.key}">
        ${escapeHtml(p.title)}<span class="filter-count">${counts[p.key]}</span>
      </button>
    `).join('');

    const filtered = __booksState.current === 'all' ? items : items.filter(it => (it.category || 'other') === __booksState.current);
    let bodyHtml;
    if (__booksState.current === 'all') {
      bodyHtml = activeCats.filter(c => counts[c]).map(cat => `
        <section class="book-category" style="margin-bottom:5rem">
          <div class="category-header">
            <h2>${escapeHtml(label('books.cat.' + cat, cat))}</h2>
            ${label('books.cat.' + cat + '.desc', '') ? `<p>${escapeHtml(label('books.cat.' + cat + '.desc', ''))}</p>` : ''}
          </div>
          <div class="book-grid">${items.filter(it => (it.category || 'other') === cat).map(renderBookCard).join('')}</div>
        </section>
      `).join('');
    } else {
      const cat = __booksState.current;
      bodyHtml = `
        <div class="category-header">
          ${label('books.cat.' + cat + '.desc', '') ? `<p>${escapeHtml(label('books.cat.' + cat + '.desc', ''))}</p>` : ''}
        </div>
        <div class="book-grid">${filtered.length ? filtered.map(renderBookCard).join('') : `<p class="center" style="grid-column:1/-1;color:var(--text-mute);padding:2rem 0">${escapeHtml(label('books.empty.category', 'Поки що порожньо.'))}</p>`}</div>`;
    }

    target.innerHTML = `<div class="filters">${pillsHtml}</div>${bodyHtml}`;

    target.querySelectorAll('.filter-pill').forEach(b => {
      b.addEventListener('click', () => {
        __booksState.current = b.dataset.cat;
        renderBooks(targetSelector);
      });
    });
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
      <article class="card">
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

  function renderCertCard(item) {
    const title  = escapeHtml(item.title || '');
    const issuer = escapeHtml(item.issuer || '');
    const date   = escapeHtml(fmtDate(item.date));
    const desc   = escapeHtml(tr(item, 'description'));
    const img    = item.image
      ? `<div class="cert__img"><img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy"></div>`
      : '';
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const verify = item.verify_url
      ? `<a href="${escapeHtml(item.verify_url)}" target="_blank" rel="noopener" class="card__link">${escapeHtml(dict['certs.verify'] || 'Перевірити ↗')}</a>`
      : '';
    const meta = [];
    if (item.credential_id) meta.push(`<div class="cert__meta-row"><span>ID</span><code>${escapeHtml(item.credential_id)}</code></div>`);
    if (item.duration)      meta.push(`<div class="cert__meta-row"><span>Тривалість</span>${escapeHtml(item.duration)}</div>`);
    if (item.skills)        meta.push(`<div class="cert__meta-row"><span>Навички</span>${escapeHtml(item.skills)}</div>`);
    if (item.signed_by)     meta.push(`<div class="cert__meta-row"><span>Підпис</span>${escapeHtml(item.signed_by)}</div>`);
    const metaBlock = meta.length ? `<div class="cert__meta">${meta.join('')}</div>` : '';
    return `
      <article class="cert">
        ${img}
        <div class="cert__body">
          <div class="card__tag">${issuer}</div>
          <div class="card__date">${date}</div>
          <h3>${title}</h3>
          <p>${desc}</p>
          ${metaBlock}
          ${verify}
        </div>
      </article>`;
  }

  async function renderCertificates(targetSelector) {
    const items = await listCollection('certificates');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (items.length === 0) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо. Заходь на <a href="admin/">/admin</a> та додавай.</p>`;
      return;
    }
    target.innerHTML = items.map(renderCertCard).join('');
  }

  window.YSContent = { renderListOrArticle, renderBooks, renderPreview, renderTools, renderToolsListOrArticle, renderCertificates };
})();

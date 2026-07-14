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

  function renderAwardCard(item) {
    const title  = escapeHtml(item.title || '');
    const issuer = escapeHtml(item.issuer || '');
    const date   = escapeHtml(fmtDate(item.date));
    const reason = escapeHtml(tr(item, 'reason'));
    const rank   = escapeHtml(item.recipient_rank || '');
    const recipient = escapeHtml(item.recipient || '');
    const signedBy  = escapeHtml(item.signed_by || '');
    const occasion  = escapeHtml(item.occasion || '');
    const cid       = escapeHtml(item.credential_id || '');
    const img       = item.image
      ? `<div class="cert__img award__img"><img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy"></div>`
      : '';
    const meta = [];
    if (rank)      meta.push(`<div class="cert__meta-row"><span>Звання</span>${rank}</div>`);
    if (recipient) meta.push(`<div class="cert__meta-row"><span>Отримувач</span>${recipient}</div>`);
    if (occasion)  meta.push(`<div class="cert__meta-row"><span>З нагоди</span>${occasion}</div>`);
    if (signedBy)  meta.push(`<div class="cert__meta-row"><span>Підпис</span>${signedBy}</div>`);
    if (cid)       meta.push(`<div class="cert__meta-row"><span>Наказ</span><code>${cid}</code></div>`);
    return `
      <article class="cert award">
        ${img}
        <div class="cert__body">
          <div class="card__tag">${issuer}</div>
          <div class="card__date">${date}</div>
          <h3>${title}</h3>
          <p><em>«${reason}»</em></p>
          ${meta.length ? `<div class="cert__meta">${meta.join('')}</div>` : ''}
        </div>
      </article>`;
  }

  async function renderAwards(targetSelector) {
    const items = await listCollection('awards');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо.</p>`;
      return;
    }
    target.innerHTML = items.map(renderAwardCard).join('');
  }

  function renderMediaCard(item) {
    const title  = escapeHtml(item.title || '');
    const source = escapeHtml(item.source || '');
    const date   = escapeHtml(fmtDate(item.date));
    const summary = escapeHtml(tr(item, 'summary'));
    const url    = escapeHtml(item.url || '');
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const readLbl = escapeHtml(dict['media.readSource'] || 'Читати матеріал ↗');
    let domain = '';
    try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
    return `
      <article class="media-card">
        <div class="media-card__meta">
          <span class="media-card__source">${source}</span>
          <span class="media-card__date">${date}</span>
        </div>
        <h3><a href="${url}" target="_blank" rel="noopener">${title}</a></h3>
        <p>${summary}</p>
        <div class="media-card__foot">
          <span class="media-card__domain">${escapeHtml(domain)}</span>
          <a href="${url}" target="_blank" rel="noopener" class="card__link">${readLbl}</a>
        </div>
      </article>`;
  }

  async function renderMediaCoverage(targetSelector) {
    const items = await listCollection('media-coverage');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (!items.length) { target.innerHTML = ''; return; }
    target.innerHTML = items.map(renderMediaCard).join('');
  }

  function renderRecCard(item) {
    const name = escapeHtml(item.author_name || '');
    const role = escapeHtml(item.author_role || '');
    const linkedin = item.author_linkedin ? escapeHtml(item.author_linkedin) : '';
    const date = escapeHtml(fmtDate(item.date));
    const text = escapeHtml(tr(item, 'text') || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const relKey = 'recs.rel.' + (item.relationship || 'teammate');
    const relLbl = escapeHtml(dict[relKey] || item.relationship || '');
    const initials = name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    const avatar = item.author_avatar
      ? `<img src="${escapeHtml(item.author_avatar)}" alt="${name}">`
      : `<span>${initials}</span>`;
    const nameEl = linkedin
      ? `<a href="${linkedin}" target="_blank" rel="noopener">${name}</a>`
      : name;
    return `
      <article class="rec">
        <div class="rec__quote">"</div>
        <div class="rec__body"><p>${text}</p></div>
        <div class="rec__author">
          <div class="rec__avatar">${avatar}</div>
          <div class="rec__meta">
            <div class="rec__name">${nameEl}</div>
            <div class="rec__role">${role}</div>
            <div class="rec__badge">${relLbl} · ${date}</div>
          </div>
        </div>
      </article>`;
  }

  async function renderRecommendations(targetSelector) {
    const items = await listCollection('recommendations');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо.</p>`;
      return;
    }
    target.innerHTML = items.map(renderRecCard).join('');
  }

  async function renderToolsStack(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (!target) return;
    try {
      const res = await fetch('content/tools-stack.json?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      renderStackHTML(target, data);
    } catch (e) {
      console.error('renderToolsStack error:', e);
      target.innerHTML = '<p class="center" style="color:var(--text-mute)">Не вдалося завантажити стек. <br><code style="color:var(--red);font-size:.8em">' + escapeHtml(String(e && e.message || e)) + '</code></p>';
    }
  }

  function renderStackHTML(target, data) {
    const groups = {};
    data.categories.forEach(c => {
      (groups[c.group] = groups[c.group] || []).push(c);
    });
    const groupOrder = Object.keys(groups);
    const ordered = data.categories.reduce((acc, c) => {
      if (!acc.includes(c.group)) acc.push(c.group);
      return acc;
    }, []);

    const html = `
      <div class="stack__meta">
        <div class="stack__counts">
          <span><strong>${data.total_links}</strong> посилань</span>
          <span><strong>${data.total_categories}</strong> категорій</span>
          <span><strong>${ordered.length}</strong> напрямків</span>
        </div>
        <div class="stack__search">
          <input type="search" id="stack-search" placeholder="Швидкий пошук по назві або категорії…" autocomplete="off">
        </div>
      </div>

      ${ordered.map(g => `
        <section class="stack__group" data-group="${escapeHtml(g)}">
          <h2 class="stack__group-title">${escapeHtml(g)}</h2>
          <div class="stack__cards">
            ${groups[g].map(cat => `
              <div class="stack__cat" data-cat-title="${escapeHtml(cat.title.toLowerCase())}">
                <div class="stack__cat-head">
                  <h3>${escapeHtml(cat.title)}</h3>
                  <span class="stack__count">${cat.links.length}</span>
                </div>
                <ul class="stack__links">
                  ${cat.links.map(l => {
                    let host = '';
                    try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
                    const t = (l.title || '').toLowerCase();
                    return `<li data-search="${escapeHtml(t + ' ' + host)}">
                      <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(l.title || host)}</a>
                      <span class="stack__host">${escapeHtml(host)}</span>
                    </li>`;
                  }).join('')}
                </ul>
              </div>
            `).join('')}
          </div>
        </section>
      `).join('')}
    `;
    target.innerHTML = html;

    const input = target.querySelector('#stack-search');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      target.querySelectorAll('.stack__cat').forEach(cat => {
        const catTitle = cat.dataset.catTitle;
        let anyMatch = catTitle.includes(q);
        cat.querySelectorAll('li').forEach(li => {
          const match = !q || anyMatch || li.dataset.search.includes(q);
          li.style.display = match ? '' : 'none';
          if (match) anyMatch = true;
        });
        cat.style.display = (!q || anyMatch) ? '' : 'none';
      });
      target.querySelectorAll('.stack__group').forEach(g => {
        const anyVisible = Array.from(g.querySelectorAll('.stack__cat')).some(c => c.style.display !== 'none');
        g.style.display = anyVisible ? '' : 'none';
      });
    });
  }

  window.YSContent = { renderListOrArticle, renderBooks, renderPreview, renderTools, renderToolsListOrArticle, renderCertificates, renderAwards, renderMediaCoverage, renderRecommendations, renderToolsStack };
})();

/* Content loader — fetches JSON files from GitHub Contents API for a public repo.
   Works on GitHub Pages without any build step.
   Config: set REPO / BRANCH to match your setup.
*/
(function () {
  'use strict';

  const CACHE = {};
  const LANG = () => (localStorage.getItem('ys_lang') || 'uk');

  async function listCollection(name) {
    if (CACHE[name]) return CACHE[name];
    try {
      const res = await fetch(`content/${name}/_index.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('index missing: ' + res.status);
      const items = await res.json();
      const visible = items.filter(x => x.published !== false);
      if (name === 'books' || name === 'certificates' || name === 'awards' || name === 'recommendations' || name === 'projects' || name === 'speaking') {
        visible.sort((a, b) => (a.order || 0) - (b.order || 0));
      } else {
        visible.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      CACHE[name] = visible;
      return visible;
    } catch (e) {
      console.warn('content load failed for ' + name, e);
      return [];
    }
  }

  async function loadBySlug(name, slug) {
    const list = await listCollection(name);
    return list.find(x => x.__slug === slug);
  }

  function tr(item, field) {
    const lang = LANG();
    return item[field + '_' + lang] || item[field] || item[field + '_uk'] || '';
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
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const title = escapeHtml(tr(item, 'title'));
    const desc  = escapeHtml(tr(item, 'summary'));
    const tag   = escapeHtml(tr(item, 'tag') || item.tag || '');
    const date  = escapeHtml(fmtDate(item.date));
    const href  = `${collection === 'cases' ? 'cases' : 'blog'}.html?slug=${encodeURIComponent(item.__slug)}`;
    const cover = item.cover
      ? `<div class="card__cover"><img src="${escapeHtml(item.cover)}" alt="" loading="lazy"></div>`
      : '';
    const sourceLbl = escapeHtml(dict['card.source'] || 'Джерело');
    const source = item.source
      ? `<div style="font-family:var(--font-mono);font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--text-mute);margin-top:1rem">${sourceLbl} · ${escapeHtml(item.source)}</div>`
      : '';
    const linkLbl = escapeHtml(dict[collection === 'cases' ? 'cases.readMore' : 'cases.readMore'] || readMoreText || 'Читати →');
    return `
      <article class="card ${cover ? 'card--with-cover' : ''}">
        ${cover}
        <div class="card__body">
          ${tag ? `<div class="card__tag">${tag}</div>` : ''}
          ${date ? `<div class="card__date">${date}</div>` : ''}
          <h3>${title}</h3>
          <p>${desc}</p>
          ${source}
          <a href="${href}" class="card__link">${linkLbl}</a>
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

  function readingTime(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }

  function renderArticle(item) {
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const title = escapeHtml(tr(item, 'title'));
    const tag   = escapeHtml(tr(item, 'tag') || item.tag || '');
    const date  = escapeHtml(fmtDate(item.date));
    const body  = tr(item, 'body') || tr(item, 'summary');
    const bodyHtml = window.marked ? window.marked.parse(body || '') : escapeHtml(body).replace(/\n/g, '<br>');
    const mins = readingTime(body);
    const readLbl = escapeHtml(dict['article.readTime'] || 'хв читання');
    const copyLbl = escapeHtml(dict['article.copyLink'] || 'Скопіювати посилання');
    const copiedLbl = escapeHtml(dict['article.linkCopied'] || 'Скопійовано ✓');
    const cover  = item.cover
      ? `<figure class="prose__hero"><img src="${escapeHtml(item.cover)}" alt=""></figure>`
      : '';
    const sourceLbl = escapeHtml(dict['card.source'] || 'Джерело');
    const source = (item.source || item.source_url)
      ? `<div style="border:1px solid var(--border);border-left:2px solid var(--ice);padding:1rem 1.25rem;margin:2rem 0;background:rgba(15,21,36,.6);font-size:.9rem">
          <div style="font-family:var(--font-mono);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ice);margin-bottom:.4rem">${sourceLbl}</div>
          ${item.source ? `<div style="color:var(--cream)">${escapeHtml(item.source)}</div>` : ''}
          ${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" style="color:var(--ice-glow);word-break:break-all">${escapeHtml(item.source_url)}</a>` : ''}
        </div>`
      : '';
    const primary = item.source_url
      ? `<p style="text-align:center;margin-top:3rem"><a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" class="btn">${escapeHtml(dict['media.readSource']||'Перейти до джерела ↗')}</a></p>`
      : '';
    return `
      <div class="article-meta">
        ${tag ? `<span class="eyebrow">${tag}${date ? ' · ' + date : ''}</span>` : (date ? `<span class="eyebrow">${date}</span>` : '')}
        <h1>${title}</h1>
        <div class="article-utils">
          <span class="article-utils__time">⧗ ${mins} ${readLbl}</span>
          <button class="article-utils__copy" data-copy="${escapeHtml(location.href)}" data-label="${copyLbl}" data-done="${copiedLbl}">📋 ${copyLbl}</button>
        </div>
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
      const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
      target.innerHTML = item ? renderArticle(item) : `<p>${escapeHtml(dict['card.notFound']||'Не знайдено.')} <a href="?">←</a></p>`;
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
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const title  = escapeHtml(tr(item, 'title') || item.title || '');
    const issuer = escapeHtml(tr(item, 'issuer') || item.issuer || '');
    const date   = escapeHtml(fmtDate(item.date));
    const desc   = escapeHtml(tr(item, 'description'));
    const img    = item.image
      ? `<div class="cert__img"><img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy"></div>`
      : '';
    const verify = item.verify_url
      ? `<a href="${escapeHtml(item.verify_url)}" target="_blank" rel="noopener" class="card__link">${escapeHtml(dict['certs.verify'] || 'Перевірити ↗')}</a>`
      : '';
    const meta = [];
    if (item.credential_id) meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.id']||'ID')}</span><code>${escapeHtml(item.credential_id)}</code></div>`);
    if (item.duration)      meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.duration']||'Тривалість')}</span>${escapeHtml(tr(item,'duration')||item.duration)}</div>`);
    if (item.skills)        meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.skills']||'Навички')}</span>${escapeHtml(item.skills)}</div>`);
    if (item.signed_by)     meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.signed']||'Підпис')}</span>${escapeHtml(item.signed_by)}</div>`);
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
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const title  = escapeHtml(tr(item, 'title') || item.title || '');
    const issuer = escapeHtml(tr(item, 'issuer') || item.issuer || '');
    const date   = escapeHtml(fmtDate(item.date));
    const reason = escapeHtml(tr(item, 'reason'));
    const rank   = escapeHtml(tr(item, 'recipient_rank') || item.recipient_rank || '');
    const recipient = escapeHtml(item.recipient || '');
    const signedBy  = escapeHtml(item.signed_by || '');
    const occasion  = escapeHtml(tr(item, 'occasion') || item.occasion || '');
    const cid       = escapeHtml(item.credential_id || '');
    const img       = item.image
      ? `<div class="cert__img award__img"><img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy"></div>`
      : '';
    const meta = [];
    if (rank)      meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.rank']||'Звання')}</span>${rank}</div>`);
    if (recipient) meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.recipient']||'Отримувач')}</span>${recipient}</div>`);
    if (occasion)  meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.occasion']||'З нагоди')}</span>${occasion}</div>`);
    if (signedBy)  meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.signed']||'Підпис')}</span>${signedBy}</div>`);
    if (cid)       meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.order']||'Наказ')}</span><code>${cid}</code></div>`);
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

  function renderSpeakingCard(item) {
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const title    = escapeHtml(tr(item, 'title') || item.title || '');
    const date     = escapeHtml(fmtDate(item.date));
    const format   = escapeHtml(tr(item, 'format') || item.format || '');
    const audience = escapeHtml(tr(item, 'audience') || item.audience || '');
    const location = escapeHtml(tr(item, 'location') || item.location || '');
    const topic    = escapeHtml(tr(item, 'topic') || item.topic || '');
    const desc     = escapeHtml(tr(item, 'description') || item.description || '');
    const link     = item.link ? escapeHtml(item.link) : '';
    const linkLbl  = escapeHtml(tr(item, 'link_label') || item.link_label || '');
    const img      = item.image
      ? `<div class="cert__img award__img"><img src="${escapeHtml(item.image)}" alt="${title}" loading="lazy"></div>`
      : '';
    const meta = [];
    if (format)   meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.format']||'Формат')}</span>${format}</div>`);
    if (audience) meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.audience']||'Аудиторія')}</span>${audience}</div>`);
    if (location) meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.location']||'Локація')}</span>${location}</div>`);
    if (topic)    meta.push(`<div class="cert__meta-row"><span>${escapeHtml(dict['meta.topic']||'Тема')}</span>${topic}</div>`);
    const linkHtml = link
      ? `<p style="margin-top:1rem"><a href="${link}" target="_blank" rel="noopener" style="color:var(--ice);border-bottom:1px solid var(--border-hi)">${linkLbl || link} ↗</a></p>`
      : '';
    return `
      <article class="cert award">
        ${img}
        <div class="cert__body">
          <div class="card__date">${date}</div>
          <h3>${title}</h3>
          <p>${desc.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</p>
          ${meta.length ? `<div class="cert__meta">${meta.join('')}</div>` : ''}
          ${linkHtml}
        </div>
      </article>`;
  }

  async function renderSpeaking(targetSelector) {
    const items = await listCollection('speaking');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:2rem 0">Поки що порожньо.</p>`;
      return;
    }
    target.innerHTML = items.map(renderSpeakingCard).join('');
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
    const ordered = data.categories.reduce((acc, c) => {
      if (!acc.includes(c.group)) acc.push(c.group);
      return acc;
    }, []);

    const lang = LANG();
    const rowHtml = (l) => {
      let host = '';
      try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
      const name = (lang === 'uk' ? (l.title_uk || l.real_title || l.title) : (l.real_title || l.title)) || host;
      const desc = (lang === 'uk' ? (l.description_uk || l.description) : (l.description_en || l.description)) || l.title || '';
      const searchStr = (name + ' ' + desc + ' ' + host).toLowerCase();
      const hasUk = !!l.description_uk;
      return `
        <tr class="stack__row" data-search="${escapeHtml(searchStr)}" data-has-uk="${hasUk ? '1' : '0'}">
          <td class="stack__name">${escapeHtml(name)}</td>
          <td class="stack__desc">${escapeHtml(desc)}</td>
          <td class="stack__link">
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener nofollow">
              <span class="stack__link-host">${escapeHtml(host)}</span>
              <span class="stack__link-arrow">↗</span>
            </a>
          </td>
        </tr>`;
    };

    const catHtml = (cat) => `
      <div class="stack__cat" data-cat-title="${escapeHtml(cat.title.toLowerCase())}">
        <div class="stack__cat-head">
          <h3>${escapeHtml(cat.title)}</h3>
          <span class="stack__count">${cat.links.length}</span>
        </div>
        <div class="stack__table-wrap">
          <table class="stack__table">
            <thead>
              <tr>
                <th class="stack__th-name">Назва</th>
                <th class="stack__th-desc">Опис</th>
                <th class="stack__th-link">Посилання</th>
              </tr>
            </thead>
            <tbody>${cat.links.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </div>`;

    const html = `
      <div class="stack__meta">
        <div class="stack__counts">
          <span><strong>${data.total_links}</strong> посилань</span>
          <span><strong>${data.total_categories}</strong> категорій</span>
          <span><strong>${ordered.length}</strong> напрямків</span>
        </div>
        <div class="stack__search">
          <input type="search" id="stack-search" placeholder="Швидкий пошук: назва, опис, домен, категорія…" autocomplete="off">
        </div>
      </div>

      ${ordered.map(g => `
        <section class="stack__group" data-group="${escapeHtml(g)}">
          <h2 class="stack__group-title">${escapeHtml(g)}</h2>
          <div class="stack__cats">
            ${groups[g].map(catHtml).join('')}
          </div>
        </section>
      `).join('')}
    `;
    target.innerHTML = html;

    const input = target.querySelector('#stack-search');
    const uaOnly = document.getElementById('ua-only');
    const applyFilter = () => {
      const q = (input.value || '').trim().toLowerCase();
      const ua = !!(uaOnly && uaOnly.checked);
      target.querySelectorAll('.stack__cat').forEach(cat => {
        const catTitle = cat.dataset.catTitle;
        const catMatch = catTitle.includes(q);
        let anyVisible = false;
        cat.querySelectorAll('tr.stack__row').forEach(row => {
          const searchMatch = !q || catMatch || row.dataset.search.includes(q);
          const uaMatch = !ua || row.dataset.hasUk === '1';
          const match = searchMatch && uaMatch;
          row.style.display = match ? '' : 'none';
          if (match) anyVisible = true;
        });
        cat.style.display = anyVisible ? '' : 'none';
      });
      target.querySelectorAll('.stack__group').forEach(g => {
        const anyVisible = Array.from(g.querySelectorAll('.stack__cat')).some(c => c.style.display !== 'none');
        g.style.display = anyVisible ? '' : 'none';
      });
    };
    input.addEventListener('input', applyFilter);
    if (uaOnly) uaOnly.addEventListener('change', applyFilter);
  }

  function renderProjectRow(item, idx, total) {
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const L = (k, dflt) => escapeHtml(dict['projects.'+k] || dflt);
    const slug = escapeHtml(item.__slug || '');
    const name = escapeHtml(item.name || '');
    const subtitle = escapeHtml(tr(item, 'subtitle') || '');
    const tag = escapeHtml(item.tag || '');
    const problem = escapeHtml(tr(item, 'problem') || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const highlights = tr(item, 'highlights') || item.highlights_uk || [];
    const forWhom = tr(item, 'for_whom') || item.for_whom_uk || [];
    const cover = item.cover ? `<img src="${escapeHtml(item.cover)}" alt="${name}" loading="lazy">` : '';
    const num = String(idx + 1).padStart(2, '0');
    const totalStr = String(total).padStart(2, '0');
    const chips = highlights.slice(0, 4).map(h => `<span class="proj-chip">${escapeHtml(h)}</span>`).join('');
    const whomShort = forWhom.slice(0, 3).map(w => `<li>${escapeHtml(w)}</li>`).join('');
    const btnRepo = item.repo_url ? `<a href="${escapeHtml(item.repo_url)}" target="_blank" rel="noopener" class="btn btn--sm">${L('repo', 'GitHub ↗')}</a>` : '';
    const btnMore = `<a href="project.html?slug=${slug}" class="btn btn--sm btn--filled">${L('more', 'Подробніше →')}</a>`;

    return `
      <article class="proj-row">
        <a href="project.html?slug=${slug}" class="proj-row__cover">
          <span class="proj-row__num">${num} / ${totalStr}</span>
          ${cover}
        </a>
        <div class="proj-row__body">
          <div class="proj-row__tag">${tag}</div>
          <h2 class="proj-row__name"><a href="project.html?slug=${slug}">${name}</a></h2>
          <p class="proj-row__sub">${subtitle}</p>
          ${problem ? `<p class="proj-row__problem">${problem}</p>` : ''}
          ${whomShort ? `<div class="proj-row__whom-wrap"><span class="proj-row__whom-label">${L('for_whom', 'Для кого')}</span><ul class="proj-row__whom">${whomShort}</ul></div>` : ''}
          ${chips ? `<div class="proj-row__chips">${chips}</div>` : ''}
          <div class="proj-row__actions">${btnMore}${btnRepo}</div>
        </div>
      </article>`;
  }

  async function renderProjects(targetSelector) {
    const items = await listCollection('projects');
    const target = document.querySelector(targetSelector);
    if (!target) return;
    if (!items.length) { target.innerHTML = `<p class="center" style="color:var(--text-mute)">Поки що порожньо.</p>`; return; }
    target.innerHTML = items.map((it, i) => renderProjectRow(it, i, items.length)).join('');
  }

  async function renderProjectDetail(targetSelector, slug) {
    const target = document.querySelector(targetSelector);
    if (!target) return;
    const items = await listCollection('projects');
    const item = items.find(x => x.__slug === slug);
    if (!item) {
      target.innerHTML = `<p class="center" style="color:var(--text-mute);padding:5rem 0">Проєкт не знайдено. <a href="projects.html" style="color:var(--ice)">← до списку</a></p>`;
      return;
    }
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const L = (k, dflt) => escapeHtml(dict['projects.'+k] || dflt);
    document.title = `${item.name} · Єгор Селін`;
    const name = escapeHtml(item.name || '');
    const subtitle = escapeHtml(tr(item, 'subtitle') || '');
    const tag = escapeHtml(item.tag || '');
    const year = escapeHtml(item.year || '');
    const lang = escapeHtml(item.lang || '');
    const license = escapeHtml(item.license || '');
    const desc = escapeHtml(tr(item, 'description') || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const problem = escapeHtml(tr(item, 'problem') || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const status = escapeHtml(tr(item, 'status') || '');
    const highlights = tr(item, 'highlights') || item.highlights_uk || [];
    const forWhom = tr(item, 'for_whom') || item.for_whom_uk || [];
    const howItWorks = tr(item, 'how_it_works') || item.how_it_works_uk || [];
    const features = tr(item, 'features') || item.features_uk || [];
    const cover = item.cover ? `<div class="proj-hero"><img src="${escapeHtml(item.cover)}" alt="${name}" loading="lazy"></div>` : '';
    const shots = (item.screenshots || []).slice(1).map(s => `<div class="proj-shot"><img src="${escapeHtml(s)}" alt="" loading="lazy"></div>`).join('');
    const chips = highlights.length
      ? `<div class="proj-chips">${highlights.map(h => `<span class="proj-chip">${escapeHtml(h)}</span>`).join('')}</div>` : '';
    const note = escapeHtml(tr(item, 'note') || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const problemBlock = problem
      ? `<div class="proj-problem"><div class="proj-problem__label">${L('problem', 'Проблема')}</div><p>${problem}</p></div>` : '';
    const noteBlock = note
      ? `<div class="proj-note"><div class="proj-note__label">${L('note', 'Позиціонування')}</div><p>${note}</p></div>` : '';
    const howBlock = howItWorks.length
      ? `<div class="proj-block"><h3>${L('how', 'Як працює')}</h3><ol class="proj-steps">${howItWorks.map(s => `<li>${escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}</ol></div>` : '';
    const whomBlock = forWhom.length
      ? `<div class="proj-block"><h3>${L('for_whom', 'Для кого')}</h3><ul class="proj-whom">${forWhom.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : '';
    const featBlock = features.length
      ? `<div class="proj-block"><h3>${L('features', 'Ключові можливості')}</h3><ul class="proj-feat">${features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>` : '';
    const metaRows = [
      year ? `<div class="proj-meta__row"><span>${L('year', 'Рік')}</span>${year}</div>` : '',
      lang ? `<div class="proj-meta__row"><span>${L('stack', 'Стек')}</span>${lang}</div>` : '',
      license ? `<div class="proj-meta__row"><span>${L('license', 'Ліцензія')}</span>${license}</div>` : '',
      status ? `<div class="proj-meta__row"><span>${L('status', 'Статус')}</span>${status}</div>` : '',
    ].filter(Boolean).join('');
    const btnRepo = item.repo_url ? `<a href="${escapeHtml(item.repo_url)}" target="_blank" rel="noopener" class="btn">${L('repo', 'GitHub ↗')}</a>` : '';
    const backLink = `<a href="projects.html" class="proj-back">← ${L('back', 'До списку розробок')}</a>`;

    target.innerHTML = `
      ${backLink}
      <article class="proj-section">
        ${cover}
        <div class="proj-head">
          <div class="card__tag">${tag}</div>
          <h1 class="proj-name">${name}</h1>
          <p class="proj-sub">${subtitle}</p>
          ${chips}
        </div>
        ${problemBlock}
        ${noteBlock}
        <div class="proj-grid">
          <div class="proj-grid__main">
            ${howBlock}
            ${whomBlock}
            ${featBlock}
            <p class="proj-desc">${desc}</p>
          </div>
          <aside class="proj-grid__side">
            ${metaRows ? `<div class="proj-meta">${metaRows}</div>` : ''}
            <div class="proj-actions">${btnRepo}</div>
          </aside>
        </div>
        ${shots ? `<div class="proj-shots">${shots}</div>` : ''}
      </article>
      ${backLink}`;
  }

  async function renderEducation(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (!target) return;
    const dict = (window.__i18nDict && window.__i18nDict[LANG()]) || {};
    const L = (k, dflt) => escapeHtml(dict['edu.'+k] || dflt);
    const lang = LANG();
    try {
      const res = await fetch('content/osint-education.json?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();

      const total = data.groups.reduce((s, g) => s + g.items.length, 0);
      const costLabel   = { free: L('cost.free', 'Безкоштовно'), paid: L('cost.paid', 'Платно') };
      const levelLabel  = { beginner: L('lvl.beginner', 'Початковий'), junior: L('lvl.junior', 'Junior'), advanced: L('lvl.advanced', 'Advanced') };
      const formatLabel = { course: L('fmt.course', 'Курс'), book: L('fmt.book', 'Книга'), workshop: L('fmt.workshop', 'Воркшоп'), ctf: L('fmt.ctf', 'CTF'), reference: L('fmt.reference', 'Довідник') };

      const rowHtml = (it) => {
        const forWhom = (lang === 'uk' ? it.for_whom_uk : it.for_whom_en) || it.for_whom_uk || '';
        const meta    = (lang === 'uk' ? it.meta_uk    : it.meta_en)    || it.meta_uk    || '';
        const search  = (it.name + ' ' + it.provider + ' ' + forWhom + ' ' + meta).toLowerCase();
        let host = ''; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch {}
        return `
          <tr class="edu-row" data-search="${escapeHtml(search)}" data-cost="${escapeHtml(it.cost||'')}" data-level="${escapeHtml(it.level||'')}" data-format="${escapeHtml(it.format||'')}" data-language="${escapeHtml(it.language||'')}">
            <td class="edu-col-name">
              <div class="edu-name">${escapeHtml(it.name)}</div>
              <div class="edu-provider">${escapeHtml(it.provider)}</div>
            </td>
            <td class="edu-col-whom">${escapeHtml(forWhom)}${meta ? `<div class="edu-meta">${escapeHtml(meta)}</div>` : ''}</td>
            <td class="edu-col-tags">
              <span class="edu-tag edu-tag--${escapeHtml(it.cost)}">${escapeHtml(costLabel[it.cost] || it.cost)}</span>
              <span class="edu-tag">${escapeHtml(levelLabel[it.level] || it.level)}</span>
              <span class="edu-tag">${escapeHtml(formatLabel[it.format] || it.format)}</span>
              <span class="edu-tag edu-tag--lang">${escapeHtml((it.language||'').toUpperCase())}</span>
            </td>
            <td class="edu-col-link">
              <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener nofollow" title="${escapeHtml(host)}">
                <span>${escapeHtml(host)}</span>
                <span class="edu-arrow">↗</span>
              </a>
            </td>
          </tr>`;
      };

      const groupHtml = (g) => {
        const title = lang === 'uk' ? (g.title_uk || g.title_en) : (g.title_en || g.title_uk);
        return `
          <section class="edu-group" data-group="${escapeHtml(g.id)}">
            <div class="edu-group__head">
              <h2>${escapeHtml(title)}</h2>
              <span class="edu-count">${g.items.length}</span>
            </div>
            <div class="edu-table-wrap">
              <table class="edu-table">
                <thead>
                  <tr>
                    <th class="edu-th-name">${L('col.name', 'Назва / провайдер')}</th>
                    <th class="edu-th-whom">${L('col.whom', 'Для кого')}</th>
                    <th class="edu-th-tags">${L('col.tags', 'Теги')}</th>
                    <th class="edu-th-link">${L('col.link', 'Посилання')}</th>
                  </tr>
                </thead>
                <tbody>${g.items.map(rowHtml).join('')}</tbody>
              </table>
            </div>
          </section>`;
      };

      const html = `
        <div class="edu-meta-bar">
          <div class="edu-counts">
            <span><strong>${total}</strong> ${L('resources', 'ресурсів')}</span>
            <span><strong>${data.groups.length}</strong> ${L('groups', 'категорій')}</span>
          </div>
          <div class="edu-filters">
            <select id="edu-cost">
              <option value="">${L('filter.cost.all', 'Ціна: усі')}</option>
              <option value="free">${L('filter.cost.free', 'Тільки безкоштовні')}</option>
              <option value="paid">${L('filter.cost.paid', 'Тільки платні')}</option>
            </select>
            <select id="edu-level">
              <option value="">${L('filter.level.all', 'Рівень: усі')}</option>
              <option value="beginner">${L('lvl.beginner', 'Початковий')}</option>
              <option value="junior">${L('lvl.junior', 'Junior')}</option>
              <option value="advanced">${L('lvl.advanced', 'Advanced')}</option>
            </select>
            <select id="edu-format">
              <option value="">${L('filter.format.all', 'Формат: усі')}</option>
              <option value="course">${L('fmt.course', 'Курс')}</option>
              <option value="book">${L('fmt.book', 'Книга')}</option>
              <option value="workshop">${L('fmt.workshop', 'Воркшоп')}</option>
              <option value="ctf">${L('fmt.ctf', 'CTF')}</option>
              <option value="reference">${L('fmt.reference', 'Довідник')}</option>
            </select>
            <input type="search" id="edu-search" placeholder="${L('search', 'Пошук: назва, провайдер…')}" autocomplete="off">
          </div>
        </div>
        ${data.groups.map(groupHtml).join('')}`;
      target.innerHTML = html;

      const sel = (id) => target.querySelector('#' + id);
      const inputs = [sel('edu-cost'), sel('edu-level'), sel('edu-format'), sel('edu-search')];
      const apply = () => {
        const q      = (sel('edu-search').value || '').trim().toLowerCase();
        const cost   = sel('edu-cost').value;
        const level  = sel('edu-level').value;
        const format = sel('edu-format').value;
        target.querySelectorAll('.edu-group').forEach(g => {
          let any = false;
          g.querySelectorAll('tr.edu-row').forEach(row => {
            const match = (!q || row.dataset.search.includes(q))
              && (!cost || row.dataset.cost === cost)
              && (!level || row.dataset.level === level)
              && (!format || row.dataset.format === format);
            row.style.display = match ? '' : 'none';
            if (match) any = true;
          });
          g.style.display = any ? '' : 'none';
        });
      };
      inputs.forEach(i => i && i.addEventListener('input', apply));
      inputs.forEach(i => i && i.addEventListener('change', apply));
    } catch (e) {
      console.error('renderEducation error:', e);
      target.innerHTML = '<p class="center" style="color:var(--text-mute)">Не вдалося завантажити ресурси.</p>';
    }
  }

  window.YSContent = { renderListOrArticle, renderBooks, renderPreview, renderTools, renderToolsListOrArticle, renderCertificates, renderAwards, renderMediaCoverage, renderRecommendations, renderToolsStack, renderProjects, renderProjectDetail, renderSpeaking, renderEducation };
})();

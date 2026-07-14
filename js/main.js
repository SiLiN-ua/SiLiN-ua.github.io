/* Yehor Selin portfolio — core JS
   - i18n switcher (persisted in localStorage)
   - fixed nav scrolled state
   - mobile menu
   - reveal-on-scroll (Intersection Observer)
*/
(function () {
  'use strict';

  const STORAGE = 'ys_lang';
  const DEFAULT = 'uk';
  let dict = {};

  async function loadDict() {
    try {
      const res = await fetch(rootPath() + 'js/i18n.json', { cache: 'no-cache' });
      dict = await res.json();
      window.__i18nDict = dict;
    } catch (e) {
      console.warn('i18n load failed', e);
    }
  }

  function rootPath() {
    // find how many folders deep we are so relative /js works
    const path = location.pathname.replace(/\/[^\/]*$/, '/');
    const depth = (path.match(/\//g) || []).length - 1;
    if (depth <= 1) return '';
    return '../'.repeat(depth - 1);
  }

  function currentLang() {
    return localStorage.getItem(STORAGE) || document.documentElement.lang || DEFAULT;
  }

  function applyLang(lang) {
    if (!dict[lang]) return;
    const map = dict[lang];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (map[key] != null) el.textContent = map[key];
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      // format: data-i18n-attr="attr:key,attr2:key2"
      el.getAttribute('data-i18n-attr').split(',').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (map[key] != null) el.setAttribute(attr, map[key]);
      });
    });
    document.querySelectorAll('.nav__lang button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
    localStorage.setItem(STORAGE, lang);
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function initLangSwitcher() {
    document.querySelectorAll('.nav__lang button').forEach(b => {
      b.addEventListener('click', () => applyLang(b.dataset.lang));
    });
  }

  function initNavScroll() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initBurger() {
    const burger = document.querySelector('.nav__burger');
    const links = document.querySelector('.nav__links');
    if (!burger || !links) return;
    burger.addEventListener('click', () => {
      burger.classList.toggle('open');
      links.classList.toggle('open');
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      burger.classList.remove('open');
      links.classList.remove('open');
    }));
  }

  function initReveal() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: .1, rootMargin: '0px 0px -80px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  }

  function markActiveNav() {
    const path = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav__links a').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      const target = href.split('/').pop();
      if (target === path || (path === 'index.html' && target === '../index.html')) {
        a.classList.add('active');
      }
    });
  }

  async function init() {
    await loadDict();
    applyLang(currentLang());
    initLangSwitcher();
    initNavScroll();
    initBurger();
    initReveal();
    markActiveNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

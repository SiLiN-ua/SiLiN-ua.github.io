(function(){
  var editions = document.querySelectorAll('[data-guide-lang]');
  var bar = document.getElementById('guide-progress-bar');
  function language(){ return localStorage.getItem('ys_lang') === 'en' ? 'en' : 'uk'; }
  function applyLanguage(){
    var lang = language();
    editions.forEach(function(node){ node.hidden = node.getAttribute('data-guide-lang') !== lang; });
    document.documentElement.lang = lang;
    document.title = lang === 'en' ? 'OSINT from zero: a practical guide · Yehor Selin' : 'OSINT з нуля: практичний гайд · Єгор Селін';
  }
  function updateProgress(){
    if (!bar) return;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, window.scrollY / max * 100) : 0) + '%';
  }
  applyLanguage();
  updateProgress();
  document.addEventListener('langchange', applyLanguage);
  window.addEventListener('scroll', updateProgress, {passive:true});
  window.addEventListener('resize', updateProgress);
})();

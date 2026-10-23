(() => {
  const topic = document.getElementById('contact-topic');
  if (!topic) return;
  const params = new URLSearchParams(location.search);
  const topics = ['research', 'mentoring', 'speaking', 'development'];
  if (topics.includes(params.get('topic'))) topic.value = params.get('topic');
  const projects = {kiriko:'Kiriko', 'ua-war':'UA-War', 'dobri-drony':'Добрі Дрони', kagamiid:'KagamiID', 'moon-attacks':'MooN Attacks', thundertrace:'ThunderTrace'};
  const project = projects[params.get('project')] || '';
  const format = ['individual','review','team'].includes(params.get('format')) ? params.get('format') : '';
  function update() {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'uk';
    const d = window.__i18nDict?.[lang] || {};
    const fallback = lang === 'en' ? 'Describe your task, the result you need and your preferred timing.' : 'Опишіть завдання, бажаний результат і терміни.';
    document.getElementById('contact-hint').textContent = d['contact.hint.' + topic.value] || fallback;
    const context = topic.value === 'development' ? project : topic.value === 'mentoring' && format ? d['contact.format.'+format] || format : '';
    const line = document.getElementById('contact-context');
    line.hidden = !context;
    line.textContent = context;
    document.getElementById('contact-context-value').value = context;
    document.querySelector('#contact-form [name="subject"]').value = '[yehorselin.com] ' + (d['contact.topic.'+topic.value] || topic.value) + (context ? ' · ' + context : '');
  }
  topic.addEventListener('change', update);
  let initialAnchor = false;
  document.addEventListener('langchange', () => {
    update();
    if (!initialAnchor && location.hash === '#contact-form') {
      initialAnchor = true;
      document.fonts.ready.then(() => requestAnimationFrame(() => document.getElementById('contact-form').scrollIntoView({block:'start'})));
    }
  });
  update();
})();

/* Jargon tooltips — hover-explanation for corporate/OSINT terms.
   Applied automatically after any renderer runs (via MutationObserver).
   Dictionary keyed by lowercased matcher; matches whole words case-insensitively. */
(function(){
  var DICT = {
    uk: {
      'sap':               'ERP-система (Enterprise Resource Planning) від німецької SAP AG. Веде фінанси, закупівлі, склад великих компаній.',
      'saas':              'Software-as-a-Service — програма, що продається як підписка через веб, не інсталюється на клієнта.',
      'shell llc':         'Фейкова юрособа без реальної діяльності. Створюється щоб приховати справжнього власника грошей.',
      'shell company':     'Фейкова юрособа без реальної діяльності. Створюється щоб приховати справжнього власника грошей.',
      'shell vendor':      'Фейковий постачальник — юрособа без реальної діяльності, створена для kickback-схеми.',
      'nominee director':  'Директор-номінал — людина, чиє імʼя стоїть у реєстрі, але яка не приймає рішень. Прикриває справжнього бенефіціара.',
      'nominee':           'Номінал — людина/сутність, що виконує роль прикриття для справжнього бенефіціара.',
      'evidentiary chain': 'Ланцюг доказів — послідовність фіксацій хто, коли, звідки отримав документ. Порушений ланцюг = докaз недопустимий у суді.',
      'chain of custody':  'Ланцюг зберігання доказів — сформований протокол хто, коли, звідки отримав/передав евідeнс. Ключовий для admissibility.',
      'admissibility':     'Юридична прийнятність — чи можна використати доказ у суді або перед регулятором.',
      'kickback':           'Незаконна винагорода — postачальник платить менеджеру за отримання контракту (частка від суми контракту).',
      'due diligence':     'Комплексна перевірка — стандартна procedure оцінки контрагента (документи, репутація, санкції).',
      'compliance':        'Compliance — відповідність корпоративним і регулятивним правилам (закони, галузеві стандарти).',
      'compliance officer':'Compliance officer — співробітник, який відповідає за дотримання правил і регулятивних вимог.',
      'chinese wall':      'Chinese Wall — інформаційний барʼєр між підрозділами (наприклад, аналітика і трейдингом) щоб уникнути insider-trading.',
      'insider trading':   'Insider trading — торгівля цінними паперами на основі непублічної суттєвої інформації. Кримінал за Rule 10b-5.',
      'material non-public information':'MNPI — суттєва непублічна інформація, здатна вплинути на ціну акції. Її використання = кримінал.',
      'mnpi':              'MNPI — Material Non-Public Information, суттєва непублічна інформація. Її торгівля = insider trading, крим.',
      '10-k':              '10-K — річна SEC-звітність публічної компанії. Містить фінанси, ризики, disclosures про власників.',
      'edgar':             'EDGAR — публічна база SEC-подань. Тут лежать 10-K, 10-Q, 8-K усіх лістингових компаній США.',
      'sec':               'SEC — Securities and Exchange Commission, регулятор ринку цінних паперів США.',
      'finra':             'FINRA — Financial Industry Regulatory Authority. Регулятор брокер-дилерів у США.',
      'panama papers':     'Витік 11.5М документів у 2016 з панамської фірми Mossack Fonseca про офшорні структури.',
      'icij':              'International Consortium of Investigative Journalists — власники Panama Papers, Paradise Papers та ін. offshoreleaks.icij.org.',
      'opencorporates':    'Найбільша публічна база корпоративних реєстрів світу. opencorporates.com',
      'єдр':               'Єдиний Державний Реєстр — публічний реєстр України: юрособи, ФОП, засновники, адреси.',
      'wayback machine':   'web.archive.org — архів веб-сторінок з датованими знімками. Показує як сайт виглядав у минулому.',
      'bic':               'BIC (SWIFT-код) — 8-11 символів, ідентифікує банк у міжнародних переказах. Формат: 4 літери банк + 2 країна + 2 місто + 3 філія (опц.).',
      'me28':              'SAP-транзакція для release strategy (пакетне затвердження PO). Логи хто затверджував і коли.',
      'me29n':             'SAP-транзакція для release strategy PO (індивідуальна). Показує release codes і user-IDs.',
      'sm20':              'SAP-транзакція audit log — фіксує вхід, зміни, підозрілі дії.',
      'su01':              'SAP-транзакція user master — хто зареєстрований користувач, ролі, дата створення.',
      'cdhdr':             'SAP-таблиця change document headers — хто і коли міняв критичні майстер-дані.',
      'cdpos':             'SAP-таблиця change document positions — деталі зміни (старе/нове значення).',
      'seaboard':          'Seaboard Report (SEC 2001) — принципи cooperation credit при добровільному розкритті. Знижує штраф.',
      'rule 10b-5':        'SEC-правило проти fraud у торгах цінними паперами. Універсальна норма для insider trading.',
      'reg fd':            'Regulation Fair Disclosure — забороняє селективне розкриття суттєвої інформації тільки обраним інвесторам.',
      'item 404':          'Item 404 of Regulation S-K — вимагає розкриття related-party transactions у SEC-подання.',
      'd&o':               'Directors & Officers questionnaire — річна анкета для директорів і топ-менеджерів про conflicts of interest.',
      'osint':             'Open-Source Intelligence — розвідка з публічних джерел (соцмережі, реєстри, ЗМІ, супутники).',
      'socmint':           'Social Media Intelligence — підвид OSINT: збір з соцмереж (Facebook, TG, LinkedIn, X).',
      'humint':            'Human Intelligence — розвідка через людей (свідки, інтервʼю, інсайдери).',
      'pep':               'PEP — Politically Exposed Person, публічна особа під підвищеним AML-контролем.',
      'aml':               'Anti-Money Laundering — норми проти легалізації доходів отриманих злочинним шляхом.',
      'kyc':               'Know Your Customer — процедура ідентифікації клієнта банком/фінустановою.',
    },
    en: {
      'sap':               'ERP system (Enterprise Resource Planning) from Germany-based SAP AG. Runs finance, procurement, warehouse for large enterprises.',
      'saas':              'Software-as-a-Service — software sold as subscription via web, not installed on client.',
      'shell llc':         'Fake legal entity with no real activity. Created to hide the real owner of money.',
      'shell company':     'Fake legal entity with no real activity. Created to hide the real beneficial owner.',
      'shell vendor':      'Fake supplier — legal entity with no real activity, created for kickback scheme.',
      'nominee director':  'Nominee — person whose name appears in the registry but who makes no decisions. Covers the real beneficiary.',
      'nominee':           'Nominee — person or entity acting as cover for the true beneficiary.',
      'evidentiary chain': 'Chain of evidence — sequence of records of who, when, where obtained a document. Broken chain = evidence inadmissible in court.',
      'chain of custody':  'Chain of custody — formal protocol of who, when, where obtained/transferred evidence. Key to admissibility.',
      'admissibility':     'Legal admissibility — whether evidence can be used in court or before a regulator.',
      'kickback':           'Illicit reward — vendor pays the manager for the contract (a percentage of the contract).',
      'due diligence':     'Standard vendor/counterparty assessment procedure (documents, reputation, sanctions).',
      'compliance':        'Compliance — adherence to corporate and regulatory rules (laws, industry standards).',
      'compliance officer':'Compliance officer — employee responsible for adherence to rules and regulatory requirements.',
      'chinese wall':      'Chinese Wall — informational barrier between departments (e.g. analytics and trading) to prevent insider trading.',
      'insider trading':   'Trading securities based on material non-public information. Criminal under Rule 10b-5.',
      'material non-public information':'MNPI — material non-public information, capable of moving stock price. Trading on it = criminal.',
      'mnpi':              'Material Non-Public Information. Trading on it = insider trading, criminal.',
      '10-k':              '10-K — annual SEC filing for public companies. Contains financials, risks, ownership disclosures.',
      'edgar':             'SEC EDGAR — public database of SEC filings. Hosts 10-K, 10-Q, 8-K of all US-listed companies.',
      'sec':               'SEC — Securities and Exchange Commission, US securities market regulator.',
      'finra':             'FINRA — Financial Industry Regulatory Authority, broker-dealer regulator in the US.',
      'panama papers':     '2016 leak of 11.5M documents from Panama-based firm Mossack Fonseca on offshore structures.',
      'icij':              'International Consortium of Investigative Journalists — owners of Panama Papers, Paradise Papers. offshoreleaks.icij.org.',
      'opencorporates':    'Largest public corporate registry database. opencorporates.com',
      'wayback machine':   'web.archive.org — web-page archive with dated snapshots. Shows how a site looked in the past.',
      'bic':               'BIC (SWIFT code) — 8-11 chars, identifies a bank in international transfers. Format: 4 letters bank + 2 country + 2 city + 3 branch (opt).',
      'me28':              'SAP transaction for release strategy (batch PO approval). Logs who approved and when.',
      'me29n':             'SAP transaction for release strategy PO (individual). Shows release codes and user IDs.',
      'sm20':              'SAP transaction audit log — records logins, changes, suspicious actions.',
      'su01':              'SAP transaction user master — who is a registered user, roles, creation date.',
      'cdhdr':             'SAP table change document headers — who and when changed critical master data.',
      'cdpos':             'SAP table change document positions — details of change (old/new value).',
      'seaboard':          'Seaboard Report (SEC 2001) — cooperation-credit principles for voluntary disclosure. Reduces penalty.',
      'rule 10b-5':        'SEC rule against fraud in securities trading. Universal norm for insider trading.',
      'reg fd':            'Regulation Fair Disclosure — prohibits selective disclosure of material info to select investors only.',
      'item 404':          'Item 404 of Regulation S-K — requires disclosure of related-party transactions in SEC filings.',
      'd&o':               'Directors & Officers questionnaire — annual survey of directors/execs about conflicts of interest.',
      'osint':             'Open-Source Intelligence — intelligence from public sources (social media, registries, media, satellites).',
      'socmint':           'Social Media Intelligence — subset of OSINT: harvesting from social networks (Facebook, TG, LinkedIn, X).',
      'humint':            'Human Intelligence — intelligence via people (witnesses, interviews, insiders).',
      'pep':               'PEP — Politically Exposed Person, public figure under heightened AML scrutiny.',
      'aml':               'Anti-Money Laundering — norms against laundering criminal proceeds.',
      'kyc':               'Know Your Customer — client identification procedure by bank/financial institution.',
    }
  };

  function currentLang() { return (localStorage.getItem('yehor.lang') || 'uk'); }

  // Build a single regex from all dict keys (sorted by length desc so longer matches win)
  function buildRegex(dict) {
    var terms = Object.keys(dict).sort(function(a,b){ return b.length - a.length; });
    var escaped = terms.map(function(t){ return t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); });
    return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
  }

  // Wrap free-text spans (paragraphs, list items) with <span data-jargon> around matched terms.
  function annotate(root) {
    var dict = DICT[currentLang()];
    if (!dict) return;
    var rx = buildRegex(dict);
    var selectors = ['.game-brief__text','.tool-btn__desc','.pivot__clue','.fake__match-note','.mb-card__text','.bench__reason','.custody-tag__v','.game-phase__head p'];
    var scope = root || document;
    scope.querySelectorAll(selectors.join(',')).forEach(function(el){
      if (el.dataset.jargonAnnotated === '1') return;
      var html = el.innerHTML;
      // Skip if there's HTML tags inside (avoid corrupting existing markup)
      if (/<[^>]+>/.test(html)) return;
      var newHtml = html.replace(rx, function(match){
        var key = match.toLowerCase();
        var def = dict[key];
        if (!def) return match;
        return '<span class="jargon" data-jargon="'+def.replace(/"/g,'&quot;')+'" tabindex="0">'+match+'</span>';
      });
      if (newHtml !== html) el.innerHTML = newHtml;
      el.dataset.jargonAnnotated = '1';
    });
  }

  // Observe DOM changes and re-annotate as the game switches phases.
  var mo = new MutationObserver(function(){ annotate(document); });
  document.addEventListener('DOMContentLoaded', function(){
    annotate(document);
    mo.observe(document.body, { childList: true, subtree: true });
  });
  document.addEventListener('langchange', function(){
    // Clear previous annotations then re-run
    document.querySelectorAll('[data-jargon-annotated="1"]').forEach(function(el){
      delete el.dataset.jargonAnnotated;
    });
    setTimeout(function(){ annotate(document); }, 100);
  });
})();

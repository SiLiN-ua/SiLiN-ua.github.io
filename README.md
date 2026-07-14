# Єгор Селін — Portfolio + CMS

Статичне портфоліо + вбудована адмінка (Sveltia CMS, форк Decap CMS з PKCE OAuth). Ти заходиш на `/admin`, логінишся через GitHub, додаєш/редагуєш кейси, статті та книги через форму — вони автоматично коммітяться у репо, GitHub Pages деплоїть за 30-60 секунд.

**Живий сайт:** `https://silin-ua.github.io/` *(після деплою)*
**Адмінка:** `https://silin-ua.github.io/admin/`

## Стек

- Чистий HTML + CSS + JavaScript (жодних збірників)
- Sveltia CMS через CDN (Decap-сумісний, PKCE OAuth — не треба сервер)
- Content-JSON зберігається в `content/{posts,cases,books}/*.json`
- Client-side markdown rendering через marked.js
- Canvas зорі + інтерактивний вузловий граф на головній

## Структура

```
site/
├── admin/
│   ├── index.html          Sveltia CMS
│   └── config.yml          конфіг колекцій
├── content/
│   ├── posts/              статті (по одному JSON на статтю)
│   ├── cases/              кейси
│   └── books/              книги
├── img/
│   ├── yehor.jpg           головне фото
│   └── uploads/            завантаження з CMS
├── css/main.css
├── js/
│   ├── main.js             i18n, nav, reveal-on-scroll
│   ├── graph.js            зорі + hero-граф
│   ├── content.js          fetch контенту з GitHub Contents API
│   └── i18n.json
├── index.html · about.html · cases.html · blog.html · books.html · contact.html
├── robots.txt · sitemap.xml · .nojekyll
└── README.md
```

## Деплой — крок за кроком

### 1. Створити репозиторій GitHub

- Створи публічний репо `silin-ua.github.io` в акаунті **SiLiN-ua** (назва повинна збігатися з `<login>.github.io`).
- Клонуй порожній репо локально або запусти git у папці `site/`:

```bash
cd "Z:/портфолио сайт/site"
git init
git branch -M main
git add .
git commit -m "Initial portfolio + Sveltia CMS"
git remote add origin https://github.com/SiLiN-ua/silin-ua.github.io.git
git push -u origin main
```

- Settings → Pages → Source → **Deploy from a branch → main / (root)**.
- Через 1-2 хв сайт живий на `https://silin-ua.github.io/`.

### 2. Створити GitHub OAuth App (для входу в адмінку)

Це потрібно один раз.

1. Йди на https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Заповни:
   - **Application name:** `Yehor Selin Portfolio CMS`
   - **Homepage URL:** `https://silin-ua.github.io/`
   - **Authorization callback URL:** `https://silin-ua.github.io/admin/`
   - **Enable Device Flow:** не потрібно
3. **Register application**.
4. На сторінці нового App — скопіюй **Client ID** (це не секрет — його безпечно тримати в коді).
5. Відкрий `admin/config.yml` → знайди рядок `app_id: REPLACE_WITH_GITHUB_OAUTH_APP_CLIENT_ID` → встав туди свій Client ID.
6. Комміт та push:
   ```bash
   git add admin/config.yml
   git commit -m "Wire GitHub OAuth"
   git push
   ```

### 3. Перший вхід у адмінку

- Йди на `https://silin-ua.github.io/admin/`.
- Натисни **Login with GitHub** → відкриється GitHub → авторизуй App → повернешся у CMS.
- Побачиш три колекції: **Кейси**, **Новини та статті**, **Книги**. Порожні.
- Натисни **New** → заповни поля → **Publish** → воно закомітиться в репо, GitHub Pages за хвилину оновиться, і карточка з'явиться на сайті.

## Як працює контент

Кожен запис — окремий JSON-файл у `content/posts/`, `content/cases/` або `content/books/`. Наприклад:

```json
{
  "title_uk": "Заголовок українською",
  "title_en": "English title",
  "date": "2026-07-14T00:00:00.000Z",
  "tag": "OSINT",
  "summary_uk": "Короткий опис українською.",
  "summary_en": "Short summary in English.",
  "body_uk": "**Повний текст** у Markdown.\n\nАбзац другий.",
  "body_en": "Full text in Markdown.",
  "linkedin": "https://linkedin.com/pulse/...",
  "published": true
}
```

Сайт при завантаженні викликає GitHub Contents API, отримує список JSON-файлів у папці, підвантажує їх, рендерить картки. Клік на карточку → `?slug=xxx` → та ж сторінка показує повну статтю.

Ліміт GitHub API: 60 запитів на годину з одного IP без токена. Для портфоліо це нормально — типовий відвідувач робить 3-5 запитів за візит. Якщо трафік виросте — додамо кешування через service worker.

## Форма зв'язку (Web3Forms)

`contact.html` використовує Web3Forms (безкоштовно до 250 листів/місяць, без бекенду):

1. https://web3forms.com → введи `selinegor22@gmail.com` → отримай **access key**.
2. У `contact.html` заміни `REPLACE_WITH_WEB3FORMS_KEY` на ключ.
3. Комміт → push.

## Власний домен (опційно, ~$10/рік)

1. Купи `yehorselin.com` (Namecheap / Cloudflare Registrar / Порт.).
2. У DNS-провайдера додай A-записи на: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (GitHub Pages IPs), плюс CNAME `www` → `silin-ua.github.io`.
3. У GitHub → Settings → Pages → Custom domain → `yehorselin.com` → Save (галочка Enforce HTTPS).
4. Створи файл `CNAME` у корені репо з одним рядком: `yehorselin.com`.
5. Оновити **Authorization callback URL** у OAuth App на `https://yehorselin.com/admin/` + `Homepage URL` теж.
6. У `admin/config.yml` оновити `base_url: https://yehorselin.com`.

## SEO

- ✅ `sitemap.xml` + `robots.txt` (треба ще додати до карти нові статті — Sveltia автоматично не оновлює sitemap; можна пізніше налаштувати GitHub Action)
- ✅ Meta description + Open Graph + Twitter Card на кожній сторінці
- ✅ JSON-LD **Person** schema на головній
- ✅ hreflang UA/EN

**Після деплою:**
- Google Search Console → додай властивість `https://silin-ua.github.io/` → submit `sitemap.xml`.
- Bing Webmaster Tools — те саме.
- Додай посилання на сайт у профіль LinkedIn / GitHub bio / Patreon.

## Локальний перегляд (без CMS)

```bash
cd site
python -m http.server 8765
```
Відкрий `http://127.0.0.1:8765/`. Адмінка локально не працює — OAuth callback вимагає GitHub Pages URL. Це нормально.

## Контакти

© 2026 Єгор Селін · [LinkedIn](https://www.linkedin.com/in/yehor-selin) · [GitHub](https://github.com/SiLiN-ua) · [Patreon](https://www.patreon.com/cw/YehorSelin) · selinegor22@gmail.com

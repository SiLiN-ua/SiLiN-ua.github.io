"""OSINT news monitor — daily/on-demand.
Pulls RSS/Atom from trusted OSINT sources, filters by publication date,
writes report to osint_candidates.md so Yehor (and Claude) can review candidates.

Usage:
    python scripts/osint_monitor.py          # last 3 days
    python scripts/osint_monitor.py 7        # last 7 days

Output: scripts/osint_candidates.md — human-readable list with title / date / url / snippet.
"""
import os, sys, re, ssl, urllib.request, urllib.error
from xml.etree import ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
OUT  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'osint_candidates.md')

# ---- Sources ---- (all confirmed working RSS/Atom as of 2026-07-17)
SOURCES = [
    ('Bellingcat',           'https://www.bellingcat.com/feed/'),
    ('Bellingcat Resources', 'https://www.bellingcat.com/category/resources/feed/'),
    ('Trace Labs Blog',      'https://www.tracelabs.org/blog/rss.xml'),
    ('OSINTech Timeline',    'https://osintech.substack.com/feed'),
    ('IntelTechniques Blog', 'https://inteltechniques.com/blog/feed/'),
    ('Nixintel',             'https://nixintel.info/feed/'),
    ('OSINT Handbook',       'https://osinthandbook.com/feed'),
]

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
HEADERS = {'User-Agent': 'Mozilla/5.0 OSINT-Monitor/1.0'}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
        return r.read()

def strip_html(t):
    if not t: return ''
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'&nbsp;', ' ', t)
    t = re.sub(r'&amp;', '&', t)
    t = re.sub(r'&#8217;|&rsquo;', "'", t)
    t = re.sub(r'&#8220;|&ldquo;|&#8221;|&rdquo;', '"', t)
    t = re.sub(r'&[a-z]+;', '', t)
    return re.sub(r'\s+', ' ', t).strip()

def parse_date(s):
    if not s: return None
    try:
        return parsedate_to_datetime(s)
    except Exception:
        try:
            return datetime.fromisoformat(s.replace('Z','+00:00'))
        except Exception:
            return None

def _tag(el):
    """Return local tag name (strip namespace)."""
    t = el.tag
    return t.split('}',1)[1] if '}' in t else t

def _findtext(el, name):
    for child in el:
        if _tag(child) == name:
            return (child.text or '').strip()
    return ''

def _find_link(el):
    """RSS: <link>URL</link>, Atom: <link href="URL"/>."""
    for child in el:
        if _tag(child) == 'link':
            if child.get('href'):
                return child.get('href','').strip()
            if child.text:
                return child.text.strip()
    return ''

def parse_feed(name, xml_bytes):
    """Return list of dicts: {title, url, date, summary, source}."""
    items = []
    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        print(f'  [!] parse fail: {e}', file=sys.stderr)
        return items

    for el in root.iter():
        tag = _tag(el)
        if tag not in ('item', 'entry'): continue
        title = _findtext(el, 'title')
        link  = _find_link(el)
        summ  = _findtext(el, 'description') or _findtext(el, 'summary') or _findtext(el, 'content')
        pub   = _findtext(el, 'pubDate') or _findtext(el, 'published') or _findtext(el, 'updated') or _findtext(el, 'date')
        d = parse_date(pub)
        items.append({'title': title, 'url': link, 'date': d,
                      'summary': strip_html(summ)[:400], 'source': name})
    return items

def main():
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS)
    print(f'Monitoring last {DAYS} days (since {cutoff.date().isoformat()})')
    all_items = []
    for name, url in SOURCES:
        print(f'  · {name}', end=' ')
        try:
            data = fetch(url)
            items = parse_feed(name, data)
            fresh = [i for i in items if i['date'] and i['date'] >= cutoff]
            all_items.extend(fresh)
            print(f'-> {len(fresh)} fresh / {len(items)} total')
        except urllib.error.HTTPError as e:
            print(f'-> HTTP {e.code}', file=sys.stderr)
        except Exception as e:
            print(f'-> FAIL: {e}', file=sys.stderr)

    # sort newest first
    all_items.sort(key=lambda x: x['date'], reverse=True)

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    md = [f'# OSINT candidates report',
          f'',
          f'Generated: **{now}**  · Window: last **{DAYS} days**  · Found: **{len(all_items)} items**',
          f'',
          f'Sources checked: {", ".join(s[0] for s in SOURCES)}',
          f'',
          f'---',
          f'']

    if not all_items:
        md.append('_No fresh items in the last window. Try increasing days: `python scripts/osint_monitor.py 7`_')
    else:
        for it in all_items:
            date_s = it['date'].strftime('%Y-%m-%d')
            md.append(f'## {date_s} · {it["source"]}')
            md.append(f'**{it["title"]}**')
            md.append('')
            md.append(f'{it["summary"]}')
            md.append('')
            md.append(f'{it["url"]}')
            md.append('')
            md.append('---')
            md.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print(f'\nReport: {OUT}')
    print(f'Total: {len(all_items)} candidates')

if __name__ == '__main__':
    main()

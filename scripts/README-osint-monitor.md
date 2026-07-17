# OSINT Monitor

Один скрипт — читає RSS-канали ключових OSINT-джерел, фільтрує за датою публікації, зберігає звіт у `osint_candidates.md`.

## Використання

```
python scripts/osint_monitor.py           # за останні 3 дні (default)
python scripts/osint_monitor.py 7         # за останні 7 днів
python scripts/osint_monitor.py 1         # тільки сьогоднішні
```

Звіт з'являється тут:
```
scripts/osint_candidates.md
```

## Джерела, що моніторяться

- **Bellingcat** — основні розслідування
- **Bellingcat Resources** — методичні ресурси
- **Trace Labs Blog** — інструменти, CTF, VM-релізи
- **OSINTech Timeline** — щотижневий community-дайджест
- **IntelTechniques Blog** (Jason Edison / Michael Bazzell) — тренінги
- **Nixintel** — practitioner blog
- **OSINT Handbook** — гайди

Broken sources (403/404/500) прибрані. Якщо додаєш нове — просто редагуй список `SOURCES` у `osint_monitor.py`.

## Робочий цикл

1. Запускаєш скрипт (руками або по розкладу)
2. Відкриваєш `scripts/osint_candidates.md` — бачиш свіжі OSINT-новини з датами
3. Або кажеш мені: **«глянь звіт і додай варті кандидати»** — я читаю файл і пропоную додати ті, що чисто OSINT-тематика

## Автоматичний запуск (опційно — Windows Task Scheduler)

Якщо хочеш, щоб скрипт запускався сам щодня о 09:00:

1. Відкрий **Task Scheduler** (`taskschd.msc`)
2. **Create Basic Task** → назва: «OSINT Monitor»
3. Trigger: **Daily** → 09:00
4. Action: **Start a program**
   - Program: `python`
   - Arguments: `Z:\портфолио сайт\site\scripts\osint_monitor.py 3`
   - Start in: `Z:\портфолио сайт\site`
5. Finish

Тоді щоранку у 09:00 звіт оновлюватиметься автоматично.

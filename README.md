# Conference Deadlines

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Github Pages Build Status](https://github.com/mindw96/Conference-Deadlines/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/mindw96/Conference-Deadlines/actions/workflows/pages/pages-build-deployment)

An open-source website for tracking academic conference deadlines.

Live Site -> [alldeadlines.info](https://alldeadlines.info)

---

![Conference Deadlines Screenshot](assets/image.png)

## Features

* **Real-time Countdown:** View upcoming deadlines with a live countdown timer.
* **Dynamic Filtering & Search:** Search and filter conferences by name, location, category, subfield, and status.
* **Add to Calendar:** Add conference schedules or submission deadlines to Google Calendar, Outlook, or an `.ics` file.
* **Suggest a Conference:** Submit a new conference or suggest edits through the public form.
* **Admin Review Flow:** Supabase Auth users listed in `public.admin_users` can review, approve, edit, or delete records.
* **Light/Dark Mode:** Switch between light and dark themes.
* **Local JSON Fallback:** If Supabase is unavailable during local development, the app falls back to `conferences.json`.

## Planned

* Email reminder subscriptions.
* Supabase Edge Functions for transactional approval workflows and notification delivery.

## Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Bootstrap 5
* **Backend & Database:** Supabase PostgreSQL, Row Level Security, Supabase Auth
* **Deployment:** GitHub Pages

## Project Layout

```text
index.html                  # Public app shell
admin.html                  # Admin dashboard shell
assets/js/utils.js          # Escaping, URL safety, AOE date helpers
assets/js/api.js            # Supabase client and API access
assets/js/data.js           # Data loading and normalization
assets/js/calendar.js       # Calendar links and ICS generation
assets/js/render.js         # Public card rendering and countdowns
assets/js/forms.js          # Suggestion and edit-suggestion forms
assets/js/app.js            # Public app orchestration
assets/js/admin.js          # Admin dashboard behavior
supabase_schema.sql         # Tables, indexes, RLS, admin model
supabase_migration.sql      # Seed data
scripts/smoke-test.mjs      # No-dependency smoke checks
```

## Deadline Time Convention

All submission deadlines are displayed as AOE (UTC-12).

Store deadline timestamps as UTC instants. For example, a deadline announced as `2025-09-19 23:59 AOE` should be stored as `2025-09-20T11:59:00Z`.

## Local Development

This project has no build step.

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Run smoke checks:

```bash
npm run smoke
```

The smoke test checks JavaScript syntax, HTML script order, JSON seed shape, the Supabase schema file, and that the old `test.html` scratch file stays retired.

## Supabase Setup

1. Create a Supabase project.
2. Run `supabase_schema.sql` in the Supabase SQL Editor.
3. Create an Auth user for the administrator.
4. Add that user to `public.admin_users`:

```sql
insert into public.admin_users (user_id, email)
select id, email
from auth.users
where email = 'you@example.com';
```

5. Run `supabase_migration.sql` to seed the sample conferences.
6. Update `assets/js/api.js` if you are using a different Supabase URL or anon key.

## How to Contribute

Contributions are welcome.

* **Suggest a Change:** Use the public suggestion form, contact the maintainer on the [About page](https://alldeadlines.info/about.html), or open a GitHub issue.
* **Contribute Code:** Fork the repository, run `npm run smoke`, and submit a pull request.

## Security Notes

The browser uses a Supabase anon key, which is expected for public Supabase clients. Data safety depends on Row Level Security. Keep `supabase_schema.sql` and the deployed Supabase policies in sync.

User-provided values are escaped before being rendered into HTML. When adding new UI, use the helpers in `assets/js/utils.js`.

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License**. See the [LICENSE](LICENSE) file for details.

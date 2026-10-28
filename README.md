# Hearth & Crumb — Café & Bakery website

A full-stack site for a neighbourhood café and bakery, with a menu, ordering ahead for pickup, order tracking, custom cake and catering inquiries, a newsletter signup, and a staff dashboard.

**Stack:** Node.js (≥ 22.13) + Express, with SQLite through Node's built-in `node:sqlite`, so there's no native build. The frontend is plain HTML, CSS and ES modules, with no build step.

## Run it

```bash
npm install
ADMIN_PASSWORD=choose-something-strong npm start   # http://localhost:3000
```

| Env var          | Default        | Purpose                                                  |
| ---------------- | -------------- | -------------------------------------------------------- |
| `PORT`           | `3000`         | HTTP port                                                |
| `ADMIN_PASSWORD` | random per run | Staff dashboard password (printed on start if unset)     |
| `TRUST_PROXY`    | `loopback`     | Set to `1` behind a hosting proxy such as cPanel         |
| `BASE_PATH`      | (empty)        | Serve under a sub-path, e.g. `/cafe` for example.com/cafe/ |
| `TZ`             | system         | Café time zone; pickup slots and hours are checked in it |
| `DB_PATH`        | `data/cafe.db` | SQLite file; created and seeded with the menu on first run |

Any of these can also go in a `.env` file next to `server.js` (see `.env.example`). Real environment variables take precedence over the file.

Other scripts: `npm run dev` (auto-restart), `npm test` (API tests against an in-memory DB), `npm run seed` (wipe and reseed the DB).

## Pages

| Path       | What it does                                                                     |
| ---------- | -------------------------------------------------------------------------------- |
| `/`        | Home page: hero with live open/closed status, featured items, story, hours       |
| `/menu`    | Full menu with cart, pickup-time picker and checkout (pay at pickup)              |
| `/order`   | Order status tracker (order code + email); refreshes itself every 30 seconds     |
| `/contact` | Inquiries for custom cakes, catering, wholesale and general questions            |
| `/admin`   | Staff dashboard: today's sales, live order queue, menu editor, message inbox     |

## Notes

- **Business details** (name, address, phone, hours, pickup lead time) are in the `CAFE` object at the top of `server.js`. The seed menu is in `db.js`.
- **Prices are always computed on the server.** The client sends only item IDs and quantities.
- **Pickup times** are checked against opening hours, a minimum lead time and a 7-day window, all in the server's local time zone. Run the server in the café's time zone (`TZ=America/New_York npm start`).
- **Order lookup** needs both the code and the email, so codes can't be enumerated. Public POST endpoints are rate-limited per IP.
- **Admin sessions** are HttpOnly, SameSite=Strict cookies that last 12 hours. Only a hash of each token is stored, in the database, so sessions survive restarts and are shared across processes.
- **Payments and email** aren't wired up. Orders are pay-at-pickup and messages land in the dashboard inbox. The natural next steps are Stripe Checkout in `POST /api/orders` and a transactional email provider for confirmations.
- **Images:** menu cards use line illustrations as placeholders. Swap them for real photos in `public/js/art.js`.
- **Production elsewhere:** run it behind a TLS-terminating reverse proxy and set `TRUST_PROXY=1` so rate limiting sees real client IPs and cookies get `Secure`.

## Deploy to cPanel

This needs cPanel's **Setup Node.js App** (Phusion Passenger) with **Node 22.13 or newer**. `app.cjs` is the Passenger startup file. Passenger may run several app processes; they share the database and staff sessions safely, since SQLite runs in WAL mode with a busy timeout and sessions are stored in the database.

1. **Upload the project** to a folder in your home directory, e.g. `~/hearth-and-crumb`. It must be **outside `public_html`**, or the database could be downloaded. Use cPanel's *Git Version Control*, or upload a zip through File Manager. Leave out `node_modules/` and `data/`.
2. **Create the app** in *Software → Setup Node.js App → Create Application*:
   - **Node.js version:** 24.x (anything 22.13 or newer works)
   - **Application mode:** Production
   - **Application root:** `hearth-and-crumb`
   - **Application URL:** your domain, a subdomain, or a sub-path like `example.com/cafe`
   - **Application startup file:** `app.cjs`
   - **Environment variables:** leave this section empty. The app reads its settings from `.env` instead.

   Then create `~/hearth-and-crumb/.env`, using File Manager or `cp .env.example .env`. Set `ADMIN_PASSWORD` (letters, numbers and hyphens are safest), `TZ` (the café's time zone, e.g. `America/New_York`), `TRUST_PROXY=1`, and, only if the Application URL has a path, `BASE_PATH` (e.g. `/cafe`). Passenger passes the full path through, so the app needs to know its prefix. `.env` sits in the app root, outside `public_html` and outside `public/`, so it's never served. Run `chmod 600 .env` to keep it private.
3. Click **Run NPM Install**, then **Start App**. The database is created at `~/hearth-and-crumb/data/cafe.db` and seeded on first start.
4. **Enable HTTPS** with *SSL/TLS Status → Run AutoSSL*.

**Updating:** upload the new files, then click **Restart**, or run `mkdir -p ~/hearth-and-crumb/tmp && touch ~/hearth-and-crumb/tmp/restart.txt` (this also works when the cPanel screen is stuck). After editing `.env`, restart the same way. Run *NPM Install* again if `package.json` changed.

**Notes:**
- **"Check availability of application has failed … content type changed":** this cPanel warning appears after *Run NPM Install*, *Start* or *Restart*. It means the app answered with a 404 at the Application URL, and the modules did install. The usual cause is a sub-path URL without a matching `BASE_PATH`. Set it, restart, and visit the URL. Under a sub-path, `/cafe` redirects to `/cafe/`, so the check may still warn about the changed status code; if the site loads, it's working.
- **Errors:** the app's stderr goes to `~/hearth-and-crumb/stderr.log`, or the location your host's Passenger is configured for.
- **Rate limiting:** after going live, place test orders from two different networks to confirm rate limiting sees separate IPs. If every visitor shares one address, check which forwarding headers your host sends and adjust `TRUST_PROXY`.
- **Idle shutdown:** shared hosts often stop idle apps, so the first request afterwards takes a few seconds.
- **Backups:** cPanel backups include `data/`. The database runs in WAL mode, so copy `cafe.db` together with any `cafe.db-wal` file beside it, or stop the app first.

## Layout

```
server.js          Express app: API routes, validation, auth, static files; exports start()
app.cjs            Passenger (cPanel) startup file
db.js              Schema, seed data, `--reset`
public/            Static site (index, menu, order, contact, admin + css/js)
test/api.test.js   node:test suite covering the API
```

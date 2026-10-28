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
| `DB_PATH`        | `data/cafe.db` | SQLite file; created and seeded with the menu on first run |

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
- **Admin sessions** are in-memory, HttpOnly, SameSite=Strict cookies that last 12 hours. Restarting the server signs everyone out.
- **Payments and email** aren't wired up. Orders are pay-at-pickup and messages land in the dashboard inbox. The natural next steps are Stripe Checkout in `POST /api/orders` and a transactional email provider for confirmations.
- **Images:** menu cards use line illustrations as placeholders. Swap them for real photos in `public/js/art.js`.
- **Production:** run it behind a TLS-terminating reverse proxy (cookies get `Secure` automatically over HTTPS) and back up the `data/` directory.

## Layout

```
server.js          Express app: API routes, validation, auth, static files
db.js              Schema, seed data, `--reset`
public/            Static site (index, menu, order, contact, admin + css/js)
test/api.test.js   node:test suite covering the API
```

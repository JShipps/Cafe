import express from 'express';
import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

export const CAFE = {
  name: 'Hearth & Crumb',
  tagline: 'Café & Bakery',
  address: '214 Maple Street, Riverton',
  phone: '(555) 014-2290',
  email: 'hello@hearthandcrumb.example',
  // Opening hours keyed by JS weekday (0 = Sunday), as [openHour, closeHour] in local time.
  hours: { 0: [8, 16], 1: [7, 18], 2: [7, 18], 3: [7, 18], 4: [7, 18], 5: [7, 18], 6: [8, 16] },
  pickupLeadMinutes: 20,
  pickupWindowDays: 7,
};

export const ORDER_STATUSES = ['received', 'preparing', 'ready', 'picked_up', 'cancelled'];
const MESSAGE_TOPICS = ['general', 'custom-cake', 'catering', 'feedback', 'wholesale'];
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, field, { max = 200, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return s;
}

function email(value) {
  const s = text(value, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'Please enter a valid email address');
  return s;
}

/** Parses "YYYY-MM-DDTHH:MM" as cafe-local time and checks it falls inside opening hours. */
export function validatePickup(value, now = new Date()) {
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new HttpError(400, 'Pickup time is required');
  const [, y, mo, d, h, mi] = m.map(Number);
  const at = new Date(y, mo - 1, d, h, mi);
  if (at.getMonth() !== mo - 1 || at.getDate() !== d) throw new HttpError(400, 'Pickup time is invalid');

  const earliest = new Date(now.getTime() + CAFE.pickupLeadMinutes * 60_000);
  const latest = new Date(now.getTime() + CAFE.pickupWindowDays * 86_400_000);
  if (at < earliest) throw new HttpError(400, `Pickup must be at least ${CAFE.pickupLeadMinutes} minutes from now`);
  if (at > latest) throw new HttpError(400, `Pickup must be within the next ${CAFE.pickupWindowDays} days`);

  const [open, close] = CAFE.hours[at.getDay()];
  const minutes = h * 60 + mi;
  if (minutes < open * 60 || minutes > close * 60 - 15) {
    throw new HttpError(400, 'Pickup time must be during opening hours');
  }
  return value;
}

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.reset < now) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, 'Too many requests — please try again shortly'));
    next();
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

const sha256 = (s) => createHash('sha256').update(s).digest();

export function createApp({ db, adminPassword, rateLimit = { windowMs: 10 * 60_000, max: 30 } }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  const app = express();
  const sessions = new Map(); // token -> expiry timestamp
  const limit = rateLimiter(rateLimit);

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '20kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  // ---------- Public API ----------

  app.get('/api/info', (req, res) => {
    res.json(CAFE);
  });

  app.get('/api/menu', (req, res) => {
    const categories = db.prepare('SELECT id, name, slug, blurb FROM categories ORDER BY sort, id').all();
    const items = db
      .prepare(
        `SELECT id, category_id, name, description, price_cents, tags, featured
         FROM menu_items WHERE available = 1 ORDER BY id`
      )
      .all();
    res.json(
      categories.map((c) => ({
        ...c,
        items: items.filter((i) => i.category_id === c.id).map(formatItem),
      }))
    );
  });

  app.get('/api/menu/featured', (req, res) => {
    const items = db
      .prepare(
        `SELECT m.*, c.slug AS category_slug FROM menu_items m JOIN categories c ON c.id = m.category_id
         WHERE m.available = 1 AND m.featured = 1 ORDER BY c.sort, m.id LIMIT 6`
      )
      .all();
    res.json(items.map((row) => ({ ...formatItem(row), categorySlug: row.category_slug })));
  });

  app.post('/api/orders', limit, (req, res) => {
    const body = req.body ?? {};
    const customer_name = text(body.name, 'Name', { max: 80 });
    const customer_email = email(body.email);
    const phone = text(body.phone, 'Phone', { max: 30, required: false });
    const notes = text(body.notes, 'Notes', { max: 500, required: false });
    const pickup_at = validatePickup(body.pickupAt);

    if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'Your cart is empty');
    if (body.items.length > 50) throw new HttpError(400, 'Too many different items in one order');

    // Prices always come from the database, never from the client.
    const lookup = db.prepare('SELECT id, name, price_cents FROM menu_items WHERE id = ? AND available = 1');
    const lines = new Map();
    for (const { id, qty } of body.items) {
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 50) {
        throw new HttpError(400, 'Invalid item or quantity');
      }
      const item = lookup.get(id);
      if (!item) throw new HttpError(400, 'An item in your cart is no longer available');
      const existing = lines.get(id);
      if (existing) existing.qty += qty;
      else lines.set(id, { ...item, qty });
    }
    const total = [...lines.values()].reduce((sum, l) => sum + l.price_cents * l.qty, 0);

    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    db.exec('BEGIN');
    try {
      const { lastInsertRowid: orderId } = db
        .prepare(
          `INSERT INTO orders (code, customer_name, email, phone, pickup_at, notes, total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(code, customer_name, customer_email, phone, pickup_at, notes, total);
      const addLine = db.prepare(
        'INSERT INTO order_items (order_id, item_id, name, price_cents, qty) VALUES (?, ?, ?, ?, ?)'
      );
      for (const l of lines.values()) addLine.run(orderId, l.id, l.name, l.price_cents, l.qty);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(201).json(getOrder(db, code));
  });

  // Looking up an order needs both the code and the email used, so codes can't be enumerated.
  app.post('/api/orders/lookup', limit, (req, res) => {
    const code = text(req.body?.code, 'Order code', { max: 12 }).toUpperCase();
    const order = getOrder(db, code);
    if (!order || order.email !== email(req.body?.email)) throw new HttpError(404, 'No order found with that code and email');
    res.json(order);
  });

  app.post('/api/messages', limit, (req, res) => {
    const body = req.body ?? {};
    const topic = MESSAGE_TOPICS.includes(body.topic) ? body.topic : 'general';
    db.prepare('INSERT INTO messages (name, email, topic, event_date, message) VALUES (?, ?, ?, ?, ?)').run(
      text(body.name, 'Name', { max: 80 }),
      email(body.email),
      topic,
      text(body.eventDate, 'Event date', { max: 10, required: false }),
      text(body.message, 'Message', { max: 2000 })
    );
    res.status(201).json({ ok: true });
  });

  app.post('/api/subscribe', limit, (req, res) => {
    db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email(req.body?.email));
    res.status(201).json({ ok: true });
  });

  // ---------- Admin API ----------

  app.post('/api/admin/login', rateLimiter({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!timingSafeEqual(sha256(given), sha256(adminPassword))) throw new HttpError(401, 'Incorrect password');
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.set(
      'Set-Cookie',
      `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_TTL_MS / 1000}` +
        (req.secure ? '; Secure' : '')
    );
    res.json({ ok: true });
  });

  const requireAdmin = (req, res, next) => {
    const token = parseCookies(req.headers.cookie).admin_session;
    const expiry = token && sessions.get(token);
    if (!expiry || expiry < Date.now()) {
      if (token) sessions.delete(token);
      throw new HttpError(401, 'Please sign in');
    }
    req.sessionToken = token;
    next();
  };

  app.post('/api/admin/logout', requireAdmin, (req, res) => {
    sessions.delete(req.sessionToken);
    res.set('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/admin/summary', requireAdmin, (req, res) => {
    const today = db
      .prepare(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue_cents
         FROM orders WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'cancelled'`
      )
      .get();
    const { open } = db
      .prepare(`SELECT COUNT(*) AS open FROM orders WHERE status IN ('received', 'preparing', 'ready')`)
      .get();
    const { unread } = db.prepare('SELECT COUNT(*) AS unread FROM messages WHERE is_read = 0').get();
    const { subscribers } = db.prepare('SELECT COUNT(*) AS subscribers FROM subscribers').get();
    res.json({ ...today, open, unread, subscribers });
  });

  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    const scope = req.query.scope === 'all' ? '' : `WHERE status IN ('received', 'preparing', 'ready')`;
    const codes = db.prepare(`SELECT code FROM orders ${scope} ORDER BY pickup_at, id LIMIT 200`).all();
    res.json(codes.map(({ code }) => getOrder(db, code)));
  });

  app.patch('/api/admin/orders/:code', requireAdmin, (req, res) => {
    const { status } = req.body ?? {};
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
    const { changes } = db.prepare('UPDATE orders SET status = ? WHERE code = ?').run(status, req.params.code);
    if (!changes) throw new HttpError(404, 'Order not found');
    res.json(getOrder(db, req.params.code));
  });

  app.get('/api/admin/menu', requireAdmin, (req, res) => {
    res.json({
      categories: db.prepare('SELECT id, name FROM categories ORDER BY sort, id').all(),
      items: db.prepare('SELECT * FROM menu_items ORDER BY category_id, id').all().map(formatItem),
    });
  });

  const readItem = (body, partial) => {
    const out = {};
    const has = (k) => !partial || k in body;
    if (has('name')) out.name = text(body.name, 'Name', { max: 80 });
    if (has('description')) out.description = text(body.description, 'Description', { max: 300, required: false });
    if (has('tags')) out.tags = text(body.tags, 'Tags', { max: 100, required: false });
    if (has('price')) {
      const cents = body.price === '' || body.price == null ? NaN : Math.round(Number(body.price) * 100);
      if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) throw new HttpError(400, 'Price is invalid');
      out.price_cents = cents;
    }
    if (has('categoryId')) {
      const exists = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(body.categoryId);
      if (!exists) throw new HttpError(400, 'Category is invalid');
      out.category_id = body.categoryId;
    }
    if ('available' in body) out.available = body.available ? 1 : 0;
    if ('featured' in body) out.featured = body.featured ? 1 : 0;
    return out;
  };

  app.post('/api/admin/menu-items', requireAdmin, (req, res) => {
    const item = readItem(req.body ?? {}, false);
    const cols = Object.keys(item);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO menu_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...Object.values(item));
    res.status(201).json(formatItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(lastInsertRowid)));
  });

  app.patch('/api/admin/menu-items/:id', requireAdmin, (req, res) => {
    const fields = readItem(req.body ?? {}, true);
    const cols = Object.keys(fields);
    if (!cols.length) throw new HttpError(400, 'Nothing to update');
    const { changes } = db
      .prepare(`UPDATE menu_items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(fields), req.params.id);
    if (!changes) throw new HttpError(404, 'Item not found');
    res.json(formatItem(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id)));
  });

  app.delete('/api/admin/menu-items/:id', requireAdmin, (req, res) => {
    const { changes } = db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    if (!changes) throw new HttpError(404, 'Item not found');
    res.status(204).end();
  });

  app.get('/api/admin/messages', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM messages ORDER BY is_read, created_at DESC LIMIT 200').all());
  });

  app.patch('/api/admin/messages/:id', requireAdmin, (req, res) => {
    const { changes } = db
      .prepare('UPDATE messages SET is_read = ? WHERE id = ?')
      .run(req.body?.read ? 1 : 0, req.params.id);
    if (!changes) throw new HttpError(404, 'Message not found');
    res.json({ ok: true });
  });

  // ---------- Static site & errors ----------

  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request too large');
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
  });

  return app;
}

function formatItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    featured: !!row.featured,
    ...(row.available !== undefined && { available: !!row.available }),
  };
}

function getOrder(db, code) {
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
  if (!order) return null;
  const items = db
    .prepare('SELECT item_id AS id, name, price_cents AS priceCents, qty FROM order_items WHERE order_id = ?')
    .all(order.id);
  return {
    code: order.code,
    name: order.customer_name,
    email: order.email,
    phone: order.phone,
    pickupAt: order.pickup_at,
    notes: order.notes,
    totalCents: order.total_cents,
    status: order.status,
    createdAt: order.created_at,
    items,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = randomBytes(9).toString('base64url');
    console.warn(`ADMIN_PASSWORD not set — using a one-time password for this run: ${adminPassword}`);
  }
  const port = Number(process.env.PORT) || 3000;
  createApp({ db: openDb(), adminPassword }).listen(port, () => {
    console.log(`${CAFE.name} running at http://localhost:${port}`);
  });
}

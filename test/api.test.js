import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validatePickup, CAFE } from '../server.js';
import { openDb } from '../db.js';

let server, base;
const PASSWORD = 'test-password';

before(async () => {
  const app = createApp({ db: openDb(':memory:'), adminPassword: PASSWORD, rateLimit: { windowMs: 1000, max: 1000 } });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data, headers: res.headers };
}

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The next valid pickup slot, at least an hour from now. */
function nextSlot() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  for (;;) {
    const [open, close] = CAFE.hours[d.getDay()];
    const m = d.getHours() * 60 + d.getMinutes();
    if (m >= open * 60 && m <= close * 60 - 15) return fmt(d);
    d.setMinutes(d.getMinutes() + 15);
  }
}

async function login() {
  const { status, headers } = await req('/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(status, 200);
  return headers.get('set-cookie').split(';')[0];
}

test('menu lists seeded categories with items', async () => {
  const { status, data } = await req('/api/menu');
  assert.equal(status, 200);
  assert.ok(data.length >= 5);
  assert.ok(data.every((c) => Array.isArray(c.items)));
  const croissant = data.flatMap((c) => c.items).find((i) => i.name === 'Butter Croissant');
  assert.equal(croissant.priceCents, 425);
});

test('featured endpoint returns only featured items with a category slug', async () => {
  const { data } = await req('/api/menu/featured');
  assert.ok(data.length > 0);
  assert.ok(data.every((i) => i.featured && i.categorySlug));
});

test('placing an order uses server prices and can be looked up', async () => {
  const { data: menu } = await req('/api/menu');
  const [a, b] = menu.flatMap((c) => c.items);
  const { status, data: order } = await req('/api/orders', {
    method: 'POST',
    body: {
      name: 'Ada Baker', email: 'ADA@example.com', pickupAt: nextSlot(),
      items: [{ id: a.id, qty: 2, priceCents: 1 }, { id: b.id, qty: 1 }, { id: a.id, qty: 1 }],
    },
  });
  assert.equal(status, 201);
  assert.match(order.code, /^[A-Z0-9]{6}$/);
  assert.equal(order.totalCents, a.priceCents * 3 + b.priceCents);
  assert.equal(order.items.length, 2);
  assert.equal(order.status, 'received');

  const found = await req('/api/orders/lookup', { method: 'POST', body: { code: order.code.toLowerCase(), email: 'ada@example.com' } });
  assert.equal(found.status, 200);
  assert.equal(found.data.code, order.code);

  const wrongEmail = await req('/api/orders/lookup', { method: 'POST', body: { code: order.code, email: 'eve@example.com' } });
  assert.equal(wrongEmail.status, 404);
});

test('order validation rejects bad input', async () => {
  const base = { name: 'X', email: 'x@example.com', pickupAt: nextSlot(), items: [{ id: 1, qty: 1 }] };
  const cases = [
    [{ ...base, items: [] }, /empty/],
    [{ ...base, email: 'nope' }, /valid email/],
    [{ ...base, name: '' }, /Name is required/],
    [{ ...base, items: [{ id: 99999, qty: 1 }] }, /no longer available/],
    [{ ...base, items: [{ id: 1, qty: 0 }] }, /Invalid/],
    [{ ...base, pickupAt: '2020-01-01T09:00' }, /at least/],
  ];
  for (const [body, message] of cases) {
    const { status, data } = await req('/api/orders', { method: 'POST', body });
    assert.equal(status, 400, JSON.stringify(body));
    assert.match(data.error, message);
  }
});

test('validatePickup enforces opening hours', () => {
  const now = new Date(2026, 9, 26, 9, 0); // Monday 9am, open 7–18
  assert.equal(validatePickup('2026-10-26T12:00', now), '2026-10-26T12:00');
  assert.throws(() => validatePickup('2026-10-26T09:10', now), /at least/);
  assert.throws(() => validatePickup('2026-10-26T17:50', now), /opening hours/);
  assert.throws(() => validatePickup('2026-10-27T06:30', now), /opening hours/);
  assert.throws(() => validatePickup('2026-11-10T12:00', now), /within the next/);
  assert.throws(() => validatePickup('2026-02-30T12:00', now), /invalid/);
});

test('contact messages and newsletter signups are accepted', async () => {
  const msg = await req('/api/messages', {
    method: 'POST',
    body: { name: 'Sam', email: 'sam@example.com', topic: 'custom-cake', eventDate: '2026-12-01', message: 'Lemon cake for 20?' },
  });
  assert.equal(msg.status, 201);
  assert.equal((await req('/api/subscribe', { method: 'POST', body: { email: 'sam@example.com' } })).status, 201);
  assert.equal((await req('/api/subscribe', { method: 'POST', body: { email: 'sam@example.com' } })).status, 201);
});

test('admin endpoints require a session', async () => {
  assert.equal((await req('/api/admin/orders')).status, 401);
  assert.equal((await req('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await req('/api/admin/orders', { cookie: 'admin_session=bogus' })).status, 401);
});

test('admin can manage orders, menu and messages', async () => {
  const cookie = await login();

  const { data: orders } = await req('/api/admin/orders', { cookie });
  assert.ok(orders.length >= 1);
  const code = orders[0].code;
  const updated = await req(`/api/admin/orders/${code}`, { method: 'PATCH', cookie, body: { status: 'ready' } });
  assert.equal(updated.data.status, 'ready');
  assert.equal((await req(`/api/admin/orders/${code}`, { method: 'PATCH', cookie, body: { status: 'eaten' } })).status, 400);

  const created = await req('/api/admin/menu-items', {
    method: 'POST', cookie,
    body: { name: 'Pumpkin Loaf', description: 'Spiced', price: '6.50', categoryId: 3, tags: 'seasonal', featured: true },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.priceCents, 650);
  assert.deepEqual(created.data.tags, ['seasonal']);
  assert.equal((await req('/api/admin/menu-items', { method: 'POST', cookie, body: { name: 'Free?', price: '', categoryId: 3 } })).status, 400);

  // Hiding an item removes it from the public menu.
  await req(`/api/admin/menu-items/${created.data.id}`, { method: 'PATCH', cookie, body: { available: false } });
  const { data: menu } = await req('/api/menu');
  assert.ok(!menu.flatMap((c) => c.items).some((i) => i.id === created.data.id));

  assert.equal((await req(`/api/admin/menu-items/${created.data.id}`, { method: 'DELETE', cookie })).status, 204);
  assert.equal((await req(`/api/admin/menu-items/${created.data.id}`, { method: 'DELETE', cookie })).status, 404);

  const { data: messages } = await req('/api/admin/messages', { cookie });
  assert.equal(messages[0].topic, 'custom-cake');
  await req(`/api/admin/messages/${messages[0].id}`, { method: 'PATCH', cookie, body: { read: true } });

  const { data: summary } = await req('/api/admin/summary', { cookie });
  assert.equal(summary.unread, 0);
  assert.equal(summary.subscribers, 1);

  await req('/api/admin/logout', { method: 'POST', cookie });
  assert.equal((await req('/api/admin/summary', { cookie })).status, 401);
});

test('static pages are served without .html extension', async () => {
  for (const path of ['/', '/menu', '/contact', '/order', '/admin']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /html/);
  }
  assert.equal((await req('/api/nope')).status, 404);
});

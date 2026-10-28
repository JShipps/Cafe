import { api, esc, money, formatPickup, LOGO_SVG, toast } from './common.js';

const $ = (id) => document.getElementById(id);
const STATUS_LABELS = { received: 'Received', preparing: 'Preparing', ready: 'Ready', picked_up: 'Picked up', cancelled: 'Cancelled' };
const NEXT_STATUS = { received: 'preparing', preparing: 'ready', ready: 'picked_up' };

let menu = { categories: [], items: [] };
let refreshTimer;

for (const id of ['login-logo', 'dash-logo']) {
  $(id).innerHTML = `${LOGO_SVG}<div><strong>Hearth &amp; Crumb</strong><span>Staff dashboard</span></div>`;
}

// Any 401 from the API sends us back to the login screen.
async function adminApi(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err.status === 401) showLogin();
    throw err;
  }
}

function showLogin() {
  clearInterval(refreshTimer);
  $('dash-view').hidden = true;
  $('login-view').hidden = false;
  $('password').focus();
}

async function showDashboard() {
  await loadSummary(); // fails with 401 (and shows the login) if there's no session
  $('login-view').hidden = true;
  $('dash-view').hidden = false;
  await Promise.all([loadOrders(), loadMenu(), loadMessages()]);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { loadSummary(); loadOrders(); }, 20_000);
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
    $('password').value = '';
    showDashboard();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ---------- Tabs ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', t === tab));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
});

// ---------- Summary ----------

async function loadSummary() {
  const s = await adminApi('/api/admin/summary');
  $('stats').innerHTML = [
    ['Orders today', s.orders],
    ['Sales today', money(s.revenue_cents)],
    ['Open orders', s.open],
    ['Unread messages', s.unread],
    ['Newsletter', s.subscribers],
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

// ---------- Orders ----------

async function loadOrders() {
  const orders = await adminApi(`/api/admin/orders${$('show-all').checked ? '?scope=all' : ''}`);
  if (!orders.length) {
    $('orders').innerHTML = '<p class="muted">No open orders right now. ☕</p>';
    return;
  }
  $('orders').innerHTML = orders.map((o) => {
    const next = NEXT_STATUS[o.status];
    return `<article class="order-card" data-status="${o.status}">
      <header><span class="code">${esc(o.code)}</span><span class="status-pill">${STATUS_LABELS[o.status]}</span></header>
      <div><strong>${esc(o.name)}</strong> · ${esc(formatPickup(o.pickupAt))}</div>
      <div class="muted" style="font-size:.85rem">${esc(o.email)}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
      <ul>${o.items.map((i) => `<li>${i.qty} × ${esc(i.name)}</li>`).join('')}</ul>
      ${o.notes ? `<div class="alert" style="background:var(--flour);margin:8px 0;padding:8px 12px">📝 ${esc(o.notes)}</div>` : ''}
      <div><strong>${money(o.totalCents)}</strong></div>
      <div class="actions">
        ${next ? `<button class="btn small" data-order="${esc(o.code)}" data-status="${next}">Mark ${STATUS_LABELS[next].toLowerCase()}</button>` : ''}
        ${['received', 'preparing'].includes(o.status) ? `<button class="btn small secondary" data-order="${esc(o.code)}" data-status="cancelled">Cancel</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

$('show-all').addEventListener('change', loadOrders);

$('orders').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-order]');
  if (!btn) return;
  if (btn.dataset.status === 'cancelled' && !confirm(`Cancel order ${btn.dataset.order}?`)) return;
  btn.disabled = true;
  try {
    await adminApi(`/api/admin/orders/${encodeURIComponent(btn.dataset.order)}`, { method: 'PATCH', body: { status: btn.dataset.status } });
    await Promise.all([loadOrders(), loadSummary()]);
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

// ---------- Menu ----------

async function loadMenu() {
  menu = await adminApi('/api/admin/menu');
  const catName = Object.fromEntries(menu.categories.map((c) => [c.id, c.name]));
  $('menu-rows').innerHTML = menu.items.map((i) => `
    <tr>
      <td><strong>${esc(i.name)}</strong><div class="muted" style="font-size:.85rem">${esc(i.description)}</div></td>
      <td>${esc(catName[i.categoryId])}</td>
      <td>${money(i.priceCents)}</td>
      <td><input type="checkbox" data-toggle="available" data-id="${i.id}" ${i.available ? 'checked' : ''} aria-label="Available"></td>
      <td><input type="checkbox" data-toggle="featured" data-id="${i.id}" ${i.featured ? 'checked' : ''} aria-label="Featured"></td>
      <td style="white-space:nowrap">
        <button class="link-btn" data-edit="${i.id}">Edit</button> ·
        <button class="link-btn" data-delete="${i.id}">Delete</button>
      </td>
    </tr>`).join('');
  $('i-cat').innerHTML = menu.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

$('menu-rows').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-toggle]');
  if (!box) return;
  try {
    await adminApi(`/api/admin/menu-items/${box.dataset.id}`, { method: 'PATCH', body: { [box.dataset.toggle]: box.checked } });
    toast('Saved');
  } catch (err) {
    box.checked = !box.checked;
    toast(err.message);
  }
});

$('menu-rows').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-delete]');
  if (edit) openItemDialog(menu.items.find((i) => i.id === Number(edit.dataset.edit)));
  if (del) {
    const item = menu.items.find((i) => i.id === Number(del.dataset.delete));
    if (!confirm(`Delete "${item.name}" from the menu? Tip: untick "Available" to hide it temporarily instead.`)) return;
    try {
      await adminApi(`/api/admin/menu-items/${item.id}`, { method: 'DELETE' });
      await loadMenu();
      toast('Item deleted');
    } catch (err) {
      toast(err.message);
    }
  }
});

let editingId = null;
const dialog = $('item-dialog');
const itemForm = $('item-form');

function openItemDialog(item) {
  editingId = item?.id ?? null;
  $('item-dialog-title').textContent = item ? 'Edit item' : 'New menu item';
  $('item-error').textContent = '';
  itemForm.name.value = item?.name ?? '';
  itemForm.description.value = item?.description ?? '';
  itemForm.price.value = item ? (item.priceCents / 100).toFixed(2) : '';
  itemForm.categoryId.value = item?.categoryId ?? menu.categories[0]?.id;
  itemForm.tags.value = item?.tags.join(', ') ?? '';
  itemForm.available.checked = item?.available ?? true;
  itemForm.featured.checked = item?.featured ?? false;
  dialog.showModal();
}

$('add-item').addEventListener('click', () => openItemDialog(null));
$('item-cancel').addEventListener('click', () => dialog.close());

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: itemForm.name.value,
    description: itemForm.description.value,
    price: itemForm.price.value,
    categoryId: Number(itemForm.categoryId.value),
    tags: itemForm.tags.value,
    available: itemForm.available.checked,
    featured: itemForm.featured.checked,
  };
  try {
    if (editingId) await adminApi(`/api/admin/menu-items/${editingId}`, { method: 'PATCH', body });
    else await adminApi('/api/admin/menu-items', { method: 'POST', body });
    dialog.close();
    await loadMenu();
    toast(editingId ? 'Item updated' : 'Item added');
  } catch (err) {
    $('item-error').textContent = err.message;
  }
});

// ---------- Messages ----------

const TOPIC_LABELS = { 'custom-cake': 'Custom cake', catering: 'Catering', general: 'General', wholesale: 'Wholesale', feedback: 'Feedback' };

async function loadMessages() {
  const messages = await adminApi('/api/admin/messages');
  $('messages').innerHTML = messages.length ? messages.map((m) => `
    <article class="message ${m.is_read ? '' : 'unread'}">
      <header>
        <div><span class="tag">${esc(TOPIC_LABELS[m.topic] ?? m.topic)}</span> <strong>${esc(m.name)}</strong> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>
        <span class="muted" style="font-size:.85rem">${esc(new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString())}</span>
      </header>
      ${m.event_date ? `<div class="muted" style="font-size:.9rem">Event date: ${esc(m.event_date)}</div>` : ''}
      <p>${esc(m.message)}</p>
      <button class="link-btn" data-msg="${m.id}" data-read="${m.is_read ? 0 : 1}">Mark as ${m.is_read ? 'unread' : 'read'}</button>
    </article>`).join('') : '<p class="muted" style="padding:20px;margin:0">No messages yet.</p>';
}

$('messages').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-msg]');
  if (!btn) return;
  try {
    await adminApi(`/api/admin/messages/${btn.dataset.msg}`, { method: 'PATCH', body: { read: btn.dataset.read === '1' } });
    await Promise.all([loadMessages(), loadSummary()]);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Init: check for an existing session ----------

showDashboard().catch((err) => { if (err.status !== 401) showLogin(); });

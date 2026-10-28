import { api, esc, money, cart, getInfo, formatPickup, toast } from '/js/common.js';

const menuEl = document.getElementById('menu');
const chipsEl = document.getElementById('chips');
const linesEl = document.getElementById('cart-lines');
const totalEl = document.getElementById('cart-total');
const form = document.getElementById('checkout');
const errorEl = document.getElementById('checkout-error');
const submitBtn = document.getElementById('place-order');

const itemsById = new Map();

function itemControl(id) {
  const qty = cart.read()[id] || 0;
  if (!qty) return `<button class="btn small secondary" data-add="${id}" aria-label="Add ${esc(itemsById.get(id).name)}">Add</button>`;
  return `<div class="qty-control" role="group" aria-label="Quantity">
    <button data-dec="${id}" aria-label="Remove one">−</button><span>${qty}</span><button data-inc="${id}" aria-label="Add one">+</button>
  </div>`;
}

function renderMenu(categories) {
  const withItems = categories.filter((c) => c.items.length);
  chipsEl.innerHTML = withItems.map((c) => `<a href="#cat-${esc(c.slug)}">${esc(c.name)}</a>`).join('');
  menuEl.innerHTML = withItems.map((c) => `
    <section class="menu-cat" id="cat-${esc(c.slug)}">
      <h2>${esc(c.name)}</h2>
      <p>${esc(c.blurb)}</p>
      ${c.items.map((item) => `
        <div class="menu-item">
          <div>
            <h3>${esc(item.name)}<span class="dots"></span><span class="price">${money(item.priceCents)}</span></h3>
            <p>${esc(item.description)}</p>
            ${item.tags.map((t) => `<span class="tag ${esc(t.replace(/\s+/g, '-'))}">${esc(t)}</span>`).join('')}
          </div>
          <div class="control" data-control="${item.id}">${itemControl(item.id)}</div>
        </div>`).join('')}
    </section>`).join('');

  // Highlight the chip for the section currently in view.
  const chips = [...chipsEl.querySelectorAll('a')];
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      chips.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  menuEl.querySelectorAll('.menu-cat').forEach((s) => observer.observe(s));
}

function renderCart() {
  const c = cart.read();
  // Drop anything that's no longer on the menu.
  for (const id of Object.keys(c)) if (!itemsById.has(Number(id))) delete c[id];
  const lines = Object.entries(c).map(([id, qty]) => ({ ...itemsById.get(Number(id)), qty }));

  if (!lines.length) {
    linesEl.innerHTML = '<li class="cart-empty" style="display:block">Your bag is empty — add something tasty.</li>';
  } else {
    linesEl.innerHTML = lines.map((l) => `
      <li>
        <span>${l.qty} × ${esc(l.name)}</span>
        <span class="line-total">${money(l.priceCents * l.qty)}</span>
        <span><button class="link-btn" data-remove="${l.id}">Remove</button></span>
      </li>`).join('');
  }
  totalEl.textContent = money(lines.reduce((s, l) => s + l.priceCents * l.qty, 0));
  submitBtn.disabled = !lines.length;
  document.querySelectorAll('[data-control]').forEach((el) => {
    el.innerHTML = itemControl(Number(el.dataset.control));
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add],[data-inc],[data-dec],[data-remove]');
  if (!btn) return;
  const { add, inc, dec, remove } = btn.dataset;
  const c = cart.read();
  if (add) { cart.set(add, 1); toast(`Added ${itemsById.get(Number(add)).name}`); }
  if (inc) cart.set(inc, (c[inc] || 0) + 1);
  if (dec) cart.set(dec, (c[dec] || 0) - 1);
  if (remove) cart.set(remove, 0);
  renderCart();
  // Keep keyboard focus on the item's control after re-rendering.
  const id = add || inc || dec;
  if (id) document.querySelector(`[data-control="${id}"] button:last-of-type`)?.focus();
});

window.addEventListener('storage', renderCart);

// ---------- Pickup slots ----------

const pad = (n) => String(n).padStart(2, '0');
const localValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function pickupSlots(info, days = 4) {
  const earliest = new Date(Date.now() + info.pickupLeadMinutes * 60_000);
  const groups = [];
  for (let i = 0; i < days; i++) {
    const day = new Date();
    day.setDate(day.getDate() + i);
    const [open, close] = info.hours[day.getDay()];
    const slots = [];
    for (let m = open * 60; m <= close * 60 - 15; m += 15) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
      if (t >= earliest) slots.push(t);
    }
    if (!slots.length) continue;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    groups.push({ label, slots });
  }
  return groups;
}

function renderSlots(info) {
  const select = form.pickupAt;
  const prev = select.value;
  select.innerHTML = pickupSlots(info).map((g) => `
    <optgroup label="${esc(g.label)}">
      ${g.slots.map((t) => `<option value="${localValue(t)}">${g.label} · ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</option>`).join('')}
    </optgroup>`).join('');
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
}

// ---------- Checkout ----------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const items = Object.entries(cart.read()).map(([id, qty]) => ({ id: Number(id), qty }));
  const data = Object.fromEntries(new FormData(form));
  submitBtn.disabled = true;
  submitBtn.textContent = 'Placing order…';
  try {
    const order = await api('/api/orders', { method: 'POST', body: { ...data, items } });
    cart.clear();
    showConfirmation(order);
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
  } finally {
    submitBtn.textContent = 'Place order';
  }
});

function showConfirmation(order) {
  document.getElementById('cart-view').hidden = true;
  const view = document.getElementById('confirm-view');
  const trackUrl = `/order?code=${encodeURIComponent(order.code)}&email=${encodeURIComponent(order.email)}`;
  view.innerHTML = `
    <div class="eyebrow">Order received</div>
    <h2>Thanks, ${esc(order.name.split(' ')[0])}!</h2>
    <p>Your order code is</p>
    <div class="code">${esc(order.code)}</div>
    <p>We'll have it ready for <strong>${esc(formatPickup(order.pickupAt))}</strong>.<br>Total due at pickup: <strong>${money(order.totalCents)}</strong></p>
    <a class="btn accent block" href="${trackUrl}">Track your order</a>
    <button class="link-btn" style="margin-top:14px" id="new-order">Start a new order</button>`;
  view.hidden = false;
  view.querySelector('#new-order').addEventListener('click', () => {
    view.hidden = true;
    document.getElementById('cart-view').hidden = false;
    renderCart();
  });
  view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Init ----------

try {
  const [categories, info] = await Promise.all([api('/api/menu'), getInfo()]);
  for (const c of categories) for (const item of c.items) itemsById.set(item.id, item);
  renderMenu(categories);
  renderCart();
  renderSlots(info);
  setInterval(() => renderSlots(info), 60_000);
  if (location.hash.startsWith('#cat-')) document.querySelector(location.hash)?.scrollIntoView();
} catch {
  menuEl.innerHTML = '<div class="alert error">We couldn’t load the menu. Please refresh the page.</div>';
}

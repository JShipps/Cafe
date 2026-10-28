// Shared helpers, plus header/footer rendering for every public page.

export const LOGO_SVG = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 30c0-9 7-16 16-16s16 7 16 16"/><path d="M5 30h38v4a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6z"/>
  <path d="M16 22c2 2 2 5 0 7M24 19c2 3 2 7 0 10M32 22c-2 2-2 5 0 7"/><path d="M20 8c0-2 2-2 2-4M28 8c0-2 2-2 2-4"/></svg>`;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// URLs are relative so the site also works under a sub-path (e.g. example.com/cafe/).
// Every page lives at the app root, so they resolve the same from any page.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path.replace(/^\//, ''), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export function formatHour(h) {
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}${suffix}`;
}

export function formatPickup(value) {
  const [d, t] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h, min).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function isOpenNow(hours, now = new Date()) {
  const [open, close] = hours[now.getDay()];
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= open && h < close;
}

export function hoursRows(hours) {
  // Start the week on Monday.
  const today = new Date().getDay();
  return [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const [o, c] = hours[d];
      return `<tr class="${d === today ? 'today' : ''}"><td>${DAYS[d]}</td><td>${formatHour(o)} – ${formatHour(c)}</td></tr>`;
    })
    .join('');
}

export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- Cart (persisted per browser) ----------

const CART_KEY = 'hc-cart';
export const cart = {
  read() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
  },
  write(c) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
    updateCartBadge();
  },
  set(id, qty) {
    const c = this.read();
    if (qty > 0) c[id] = Math.min(qty, 50); else delete c[id];
    this.write(c);
  },
  clear() { this.write({}); },
  count() { return Object.values(this.read()).reduce((a, b) => a + b, 0); },
};

function updateCartBadge() {
  document.querySelectorAll('.cart-count').forEach((el) => {
    const n = cart.count();
    el.textContent = n;
    el.dataset.count = n;
  });
}

// ---------- Layout ----------

let infoPromise;
export const getInfo = () => (infoPromise ??= api('/api/info'));

function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  const normalize = (p) => p.replace(/\.html$/, '').replace(/\/(index)?$/, '');
  const here = normalize(location.pathname);
  const link = (href, label) =>
    `<a href="${href}"${normalize(new URL(href, location.href).pathname) === here ? ' aria-current="page"' : ''}>${label}</a>`;
  el.className = 'site-header';
  el.innerHTML = `
    <div class="wrap">
      <a class="logo" href="./">${LOGO_SVG}<div><strong>Hearth &amp; Crumb</strong><span>Café &amp; Bakery</span></div></a>
      <button class="nav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="nav">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <nav class="nav" id="nav">
        ${link('./', 'Home')}
        ${link('menu', 'Menu')}
        ${link('contact', 'Cakes &amp; Catering')}
        ${link('order', 'Track Order')}
        <a class="btn small accent" href="menu#order">Order Ahead <span class="cart-count" data-count="0">0</span></a>
      </nav>
    </div>`;
  const toggle = el.querySelector('.nav-toggle');
  const nav = el.querySelector('.nav');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  nav.addEventListener('click', (e) => e.target.closest('a') && nav.classList.remove('open'));
}

async function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.className = 'site-footer';
  const info = await getInfo().catch(() => null);
  el.innerHTML = `
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <h3>Hearth &amp; Crumb</h3>
          <p>A neighbourhood café and scratch bakery. Bread, pastry and good coffee since 2014.</p>
        </div>
        <div>
          <h3>Visit</h3>
          ${info ? `<p>${esc(info.address)}<br><a href="tel:${esc(info.phone.replace(/[^\d+]/g, ''))}">${esc(info.phone)}</a><br>
          <a href="mailto:${esc(info.email)}">${esc(info.email)}</a></p>` : ''}
        </div>
        <div>
          <h3>Explore</h3>
          <ul><li><a href="menu">Menu</a></li><li><a href="menu#order">Order for pickup</a></li>
          <li><a href="contact">Custom cakes</a></li><li><a href="order">Track an order</a></li></ul>
        </div>
        <div>
          <h3>The Weekly Loaf</h3>
          <p>Seasonal bakes and new menu items, once a week. No spam.</p>
          <form class="subscribe" novalidate>
            <label class="sr-only" for="sub-email">Email address</label>
            <input id="sub-email" type="email" name="email" placeholder="you@example.com" required>
            <button class="btn accent small" type="submit">Join</button>
          </form>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} Hearth &amp; Crumb Café &amp; Bakery</span>
        <a href="admin">Staff login</a>
      </div>
    </div>`;
  el.querySelector('.subscribe').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api('/api/subscribe', { method: 'POST', body: { email: form.email.value } });
      form.reset();
      toast('Thanks! You’re on the list.');
    } catch (err) {
      toast(err.message);
    }
  });
}

renderHeader();
renderFooter();
updateCartBadge();
window.addEventListener('storage', updateCartBadge);

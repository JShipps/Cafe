import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    slug  TEXT NOT NULL UNIQUE,
    blurb TEXT NOT NULL DEFAULT '',
    sort  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    tags        TEXT NOT NULL DEFAULT '',
    available   INTEGER NOT NULL DEFAULT 1,
    featured    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    pickup_at     TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    total_cents   INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'received',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    qty         INTEGER NOT NULL CHECK (qty > 0)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    topic      TEXT NOT NULL,
    event_date TEXT NOT NULL DEFAULT '',
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    email      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const SEED = [
  {
    name: 'Coffee & Espresso', slug: 'coffee', blurb: 'Single-origin beans roasted weekly by our neighbours at Ridgeline Roasters.',
    items: [
      ['House Drip', 'Rotating single origin, bottomless when you stay in.', 300, 'vegan', 0],
      ['Cortado', 'Equal parts espresso and steamed milk.', 425, '', 0],
      ['Oat Milk Latte', 'Double shot with silky oat milk.', 550, 'vegan', 1],
      ['Honey Lavender Latte', 'Local wildflower honey and house lavender syrup.', 625, 'seasonal', 1],
      ['Cold Brew', 'Steeped 18 hours. Smooth, chocolatey, strong.', 475, 'vegan', 0],
    ],
  },
  {
    name: 'Tea & Other Drinks', slug: 'tea', blurb: 'Loose-leaf teas, chai brewed in-house, and something for the kids.',
    items: [
      ['Masala Chai', 'Simmered with whole spices and black tea.', 500, '', 0],
      ['Matcha Latte', 'Ceremonial-grade matcha, whisked to order.', 575, '', 0],
      ['Hot Chocolate', '70% dark chocolate, whipped cream optional.', 450, 'vegetarian', 0],
      ['Fresh-Pressed OJ', 'Squeezed every morning.', 500, 'vegan, gluten-free', 0],
    ],
  },
  {
    name: 'Morning Bakes', slug: 'bakery', blurb: 'Laminated, proofed and baked on site from 4 a.m. every day.',
    items: [
      ['Butter Croissant', 'Three-day laminated dough, 27 flaky layers.', 425, 'vegetarian', 1],
      ['Almond Croissant', 'Twice-baked with frangipane and toasted almonds.', 525, 'vegetarian', 0],
      ['Cardamom Bun', 'Swedish-style knot with brown butter and pearl sugar.', 475, 'vegetarian', 1],
      ['Blueberry Muffin', 'Crumb topping, wild Maine blueberries.', 375, 'vegetarian', 0],
      ['Morning Glory Muffin', 'Carrot, apple, coconut and walnut.', 375, 'vegan, gluten-free', 0],
      ['Seasonal Scone', 'Ask about today\'s flavour.', 400, 'vegetarian, seasonal', 0],
    ],
  },
  {
    name: 'Bread', slug: 'bread', blurb: 'Naturally leavened loaves — best ordered ahead, they sell out by noon.',
    items: [
      ['Country Sourdough', 'Our 12-year-old starter, 36-hour ferment.', 900, 'vegan', 1],
      ['Seeded Rye', 'Dense, dark and packed with sunflower and flax.', 1000, 'vegan', 0],
      ['Baguette', 'Crackly crust, open crumb.', 450, 'vegan', 0],
      ['Brioche Loaf', 'Rich, eggy and perfect for French toast.', 950, 'vegetarian', 0],
    ],
  },
  {
    name: 'Lunch', slug: 'lunch', blurb: 'Served 11 a.m. – 3 p.m. on house-baked bread.',
    items: [
      ['Turkey & Brie', 'Apple, arugula and fig jam on baguette.', 1350, '', 0],
      ['Roasted Veggie Focaccia', 'Peppers, zucchini, whipped feta and pesto.', 1250, 'vegetarian', 1],
      ['Soup of the Day', 'With a hunk of sourdough.', 850, 'seasonal', 0],
      ['Harvest Grain Bowl', 'Farro, squash, kale, pepitas, tahini dressing.', 1300, 'vegan', 0],
    ],
  },
  {
    name: 'Cakes & Sweets', slug: 'sweets', blurb: 'By the slice, or order whole cakes 48 hours ahead.',
    items: [
      ['Chocolate Olive Oil Cake', 'Slice, with crème fraîche.', 650, 'vegetarian', 0],
      ['Lemon Tart', 'Brûléed top, shortbread crust.', 600, 'vegetarian', 0],
      ['Brown Butter Cookie', 'Sea salt, dark chocolate chunks.', 350, 'vegetarian', 1],
      ['Flourless Brownie', 'Fudgy and naturally gluten-free.', 400, 'gluten-free', 0],
    ],
  },
];

export function openDb(path = process.env.DB_PATH || 'data/cafe.db') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get();
  if (n === 0) seed(db);
  return db;
}

function seed(db) {
  const addCat = db.prepare('INSERT INTO categories (name, slug, blurb, sort) VALUES (?, ?, ?, ?)');
  const addItem = db.prepare(
    'INSERT INTO menu_items (category_id, name, description, price_cents, tags, featured) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  SEED.forEach((cat, i) => {
    const { lastInsertRowid } = addCat.run(cat.name, cat.slug, cat.blurb, i);
    for (const [name, desc, price, tags, featured] of cat.items) {
      addItem.run(lastInsertRowid, name, desc, price, tags, featured);
    }
  });
  db.exec('COMMIT');
}

// `node db.js --reset` wipes and reseeds the database.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--reset')) {
  const path = process.env.DB_PATH || 'data/cafe.db';
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  openDb(path).close();
  console.log(`Reset and seeded ${path}`);
}

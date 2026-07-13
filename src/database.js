const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

let db;

// Thin wrapper that mimics better-sqlite3 sync API over sql.js
class SqlJsDB {
  constructor(sqlJsDb, filePath) {
    this._db = sqlJsDb;
    this._path = filePath;
  }

  pragma(str) {
    try { this._db.run(`PRAGMA ${str}`); } catch (_) {}
    return this;
  }

  exec(sql) {
    this._db.exec(sql);
    this._save();
    return this;
  }

  prepare(sql) {
    const self = this;
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)/i.test(sql);
    return {
      run(...args) {
        const params = self._norm(args);
        self._db.run(sql, params.length ? params : undefined);
        const lastInsertRowid = self._lastId();
        const changes = self._db.getRowsModified();
        if (isWrite) self._save();
        return { lastInsertRowid, changes };
      },
      get(...args) {
        const params = self._norm(args);
        const stmt = self._db.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally {
          stmt.free();
        }
      },
      all(...args) {
        const params = self._norm(args);
        const stmt = self._db.prepare(sql);
        const rows = [];
        try {
          if (params.length) stmt.bind(params);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      }
    };
  }

  _norm(args) {
    if (!args.length) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args;
  }

  _lastId() {
    try {
      const r = this._db.exec('SELECT last_insert_rowid()');
      return r[0]?.values[0]?.[0] ?? null;
    } catch (_) { return null; }
  }

  _save() {
    try {
      const data = this._db.export();
      fs.writeFileSync(this._path, Buffer.from(data));
    } catch (e) {
      console.error('[db save error]', e.message);
    }
  }
}

async function initDatabase(dataDir) {
  const SQL = await initSqlJs();
  const dbPath = path.join(dataDir, 'barberia.db');

  let sqlJsDb;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    sqlJsDb = new SQL.Database(buf);
  } else {
    sqlJsDb = new SQL.Database();
  }

  db = new SqlJsDB(sqlJsDb, dbPath);

  // WAL not applicable to sql.js; foreign keys work fine
  db._db.run('PRAGMA foreign_keys = ON');

  db._db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS barbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#c8a96e',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      photo_url TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      date TEXT NOT NULL,
      time_start TEXT NOT NULL,
      time_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time_start TEXT NOT NULL,
      time_end TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS blocked_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      email TEXT,
      client_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const defaultSettings = [
    ['shop_name', 'Gold Hair'],
    ['shop_tagline', 'El toque dorado de tu estilo'],
    ['shop_address', 'Av. Francesc Macià, Parets del Vallès, 08150'],
    ['shop_phone', ''],
    ['shop_email', ''],
    ['instagram_url', 'https://www.instagram.com/gold_hair_yassine/'],
    ['google_maps_url', 'https://www.google.com/maps?q=Gold+Hair,41.5723482,2.2354667&hl=es&z=17&output=embed'],
    ['open_time', '09:00'],
    ['close_time', '20:00'],
    ['open_days', '1,2,3,4,5,6'],
    ['legal_text', `POLÍTICA DE PRIVACIDAD\n\nResponsable del tratamiento: {shop_name}, {shop_address}\n\nDatos recogidos: nombre, correo electrónico y teléfono.\n\nFinalidad: gestión de citas y envío de confirmación por correo.\n\nLegitimación: consentimiento del interesado (Art. 6.1.a RGPD) y ejecución del contrato de prestación de servicios (Art. 6.1.b RGPD).\n\nConservación: durante el tiempo necesario para la gestión de la reserva y los plazos legales aplicables.\n\nDerechos: puede ejercer sus derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición escribiendo a {shop_email}. Tiene derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (www.aepd.es).\n\nLos datos no serán cedidos a terceros salvo obligación legal.`]
  ];

  for (const [key, value] of defaultSettings) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  }

  const sc = db.prepare('SELECT COUNT(*) as c FROM services').get();
  if (!sc || sc.c === 0) {
    const ins = db.prepare('INSERT INTO services (name, description, price, duration_minutes, sort_order, photo_url) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('Corte de pelo',    'Corte clásico adaptado a tu estilo',                   15, 30, 1, 'https://images.unsplash.com/photo-1634302104565-cc698ee83144?auto=format&fit=crop&w=500&q=80');
    ins.run('Corte + Barba',    'Corte completo más perfilado y arreglo de barba',       25, 45, 2, 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=500&q=80');
    ins.run('Arreglo de barba', 'Perfilado y arreglo de barba con navaja',               12, 30, 3, 'https://images.unsplash.com/photo-1630827020718-3433092696e7?auto=format&fit=crop&w=500&q=80');
    ins.run('Afeitado clásico', 'Afeitado completo con navaja y toalla caliente',        18, 30, 4, 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=500&q=80');
  }

  // Migrate photo_url for existing default services that have no photo
  const defaultPhotos = [
    ['Corte de pelo',    'https://images.unsplash.com/photo-1634302104565-cc698ee83144?auto=format&fit=crop&w=500&q=80'],
    ['Corte + Barba',    'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=500&q=80'],
    ['Arreglo de barba', 'https://images.unsplash.com/photo-1630827020718-3433092696e7?auto=format&fit=crop&w=500&q=80'],
    ['Afeitado clásico', 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=500&q=80'],
  ];
  for (const [name, url] of defaultPhotos) {
    db.prepare('UPDATE services SET photo_url = ? WHERE name = ?').run(url, name);
  }

  // Limpiar verificaciones antiguas no usadas (más de 15 minutos)
  db._db.run("DELETE FROM email_verifications WHERE verified = 0 AND created_at < datetime('now','-15 minutes')");
  db._save();
  return db;
}

function getDb() { return db; }

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function generateAvailableSlots(openTime, closeTime, durationMinutes, bookings, blockedSlots, minStartMinutes = -1) {
  const openMin = timeToMinutes(openTime);
  const closeMin = timeToMinutes(closeTime);
  const occupied = [
    ...bookings.map(b => ({ start: timeToMinutes(b.time_start), end: timeToMinutes(b.time_end) })),
    ...blockedSlots.map(s => ({ start: timeToMinutes(s.time_start), end: timeToMinutes(s.time_end) }))
  ];
  const available = [];
  for (let start = openMin; start + durationMinutes <= closeMin; start += 15) {
    if (minStartMinutes >= 0 && start < minStartMinutes) continue;
    const end = start + durationMinutes;
    if (!occupied.some(r => start < r.end && end > r.start)) available.push(minutesToTime(start));
  }
  return available;
}

function findEarliest(barberId, durationMinutes) {
  const settings = getSettings();
  const openDays = settings.open_days.split(',').map(Number);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i <= 90; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dayOfWeek = d.getDay();
    if (!openDays.includes(dayOfWeek)) continue;
    const dateStr = d.toISOString().split('T')[0];
    const dayBlocked = db.prepare('SELECT id FROM blocked_days WHERE barber_id = ? AND date = ?').get(barberId, dateStr);
    if (dayBlocked) continue;
    const bookings = db.prepare(
      'SELECT time_start, time_end FROM bookings WHERE barber_id = ? AND date = ? AND status != "cancelled"'
    ).all(barberId, dateStr);
    const blocked = db.prepare('SELECT time_start, time_end FROM blocked_slots WHERE barber_id = ? AND date = ?').all(barberId, dateStr);
    const minStart = dateStr === todayStr ? nowMinutes : -1;
    const slots = generateAvailableSlots(settings.open_time, settings.close_time, durationMinutes, bookings, blocked, minStart);
    if (slots.length) return { date: dateStr, time: slots[0] };
  }
  return null;
}

module.exports = { initDatabase, getDb, getSettings, generateAvailableSlots, findEarliest, timeToMinutes, minutesToTime };

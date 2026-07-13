const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getDb, getSettings, generateAvailableSlots, findEarliest, timeToMinutes, minutesToTime } = require('../database');
const { sendBookingConfirmation } = require('../email');

function createApiRouter(dataDir, uploadsDir) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `service_${Date.now()}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Solo se permiten imágenes'));
    }
  });

  function requireAdmin(req, res, next) {
    if (req.session && req.session.adminLoggedIn) return next();
    res.status(401).json({ error: 'No autorizado' });
  }

  function getOpenDaysList(settings) {
    return settings.open_days ? settings.open_days.split(',').map(Number) : [1,2,3,4,5,6];
  }

  // ==================== PUBLIC ====================

  router.get('/settings', (req, res) => {
    const s = getSettings();
    res.json({ shop_name: s.shop_name, shop_tagline: s.shop_tagline, shop_address: s.shop_address, shop_phone: s.shop_phone, open_time: s.open_time, close_time: s.close_time, open_days: s.open_days, instagram_url: s.instagram_url || '', google_maps_url: s.google_maps_url || '' });
  });

  router.get('/services', (req, res) => {
    const db = getDb();
    const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort_order, id').all();
    res.json(services);
  });

  router.get('/barbers', (req, res) => {
    const db = getDb();
    const barbers = db.prepare('SELECT id, name, color FROM barbers WHERE active = 1 ORDER BY id').all();
    res.json(barbers);
  });

  router.get('/barbers/:id/earliest', (req, res) => {
    const { id } = req.params;
    const { duration } = req.query;
    if (!duration) return res.status(400).json({ error: 'Falta duración' });
    const result = findEarliest(Number(id), Number(duration));
    res.json(result || { available: false });
  });

  router.get('/availability', (req, res) => {
    const { barber_id, date, duration } = req.query;
    if (!barber_id || !date || !duration) return res.status(400).json({ error: 'Faltan parámetros' });

    const db = getDb();
    const settings = getSettings();

    const barber = db.prepare('SELECT id FROM barbers WHERE id = ? AND active = 1').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'Barbero no encontrado' });

    const dayBlocked = db.prepare('SELECT id FROM blocked_days WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayBlocked) return res.json({ available: [], reason: 'blocked_day' });

    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();
    const openDays = getOpenDaysList(settings);
    if (!openDays.includes(dayOfWeek)) return res.json({ available: [], reason: 'closed' });

    const bookings = db.prepare(
      'SELECT time_start, time_end FROM bookings WHERE barber_id = ? AND date = ? AND status != "cancelled"'
    ).all(barber_id, date);
    const blocked = db.prepare(
      'SELECT time_start, time_end FROM blocked_slots WHERE barber_id = ? AND date = ?'
    ).all(barber_id, date);

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const minStart = date === today ? now.getHours() * 60 + now.getMinutes() : -1;
    const available = generateAvailableSlots(settings.open_time, settings.close_time, Number(duration), bookings, blocked, minStart);
    res.json({ available });
  });

  router.post('/bookings', async (req, res) => {
    const { barber_id, service_id, client_name, client_email, client_phone, date, time_start, terms_accepted } = req.body;

    if (!barber_id || !service_id || !client_name || !client_email || !client_phone || !date || !time_start) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    if (!terms_accepted) return res.status(400).json({ error: 'Debes aceptar los términos y condiciones' });

    const db = getDb();
    const settings = getSettings();

    // Check blacklist by phone or email
    const blocked = db.prepare(
      'SELECT id FROM blacklist WHERE phone = ? OR (email != "" AND email = ?)'
    ).get(client_phone.trim(), client_email.trim());
    if (blocked) return res.status(403).json({ error: 'No es posible realizar reservas desde este contacto. Por favor, llama al local directamente.' });

    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(service_id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    const barber = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'Barbero no encontrado' });

    const dayBlocked = db.prepare('SELECT id FROM blocked_days WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayBlocked) return res.status(409).json({ error: 'Esta fecha no está disponible' });

    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();
    if (!getOpenDaysList(settings).includes(dayOfWeek)) {
      return res.status(409).json({ error: 'El local está cerrado ese día' });
    }

    const time_end_mins = timeToMinutes(time_start) + service.duration_minutes;
    const time_end = minutesToTime(time_end_mins);

    const bookings = db.prepare(
      'SELECT time_start, time_end FROM bookings WHERE barber_id = ? AND date = ? AND status != "cancelled"'
    ).all(barber_id, date);
    const blockedSlots = db.prepare(
      'SELECT time_start, time_end FROM blocked_slots WHERE barber_id = ? AND date = ?'
    ).all(barber_id, date);

    const todayStr = new Date().toISOString().split('T')[0];
    const nowObj = new Date();
    const minStartBook = date === todayStr ? nowObj.getHours() * 60 + nowObj.getMinutes() : -1;
    const available = generateAvailableSlots(settings.open_time, settings.close_time, service.duration_minutes, bookings, blockedSlots, minStartBook);
    if (!available.includes(time_start)) {
      return res.status(409).json({ error: 'La hora seleccionada ya no está disponible' });
    }

    const result = db.prepare(`
      INSERT INTO bookings (barber_id, service_id, client_name, client_email, client_phone, date, time_start, time_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(barber_id, service_id, client_name.trim(), client_email.trim(), client_phone.trim(), date, time_start, time_end);

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);

    // Responder al cliente inmediatamente, enviar email en segundo plano
    res.json({ success: true, booking_id: booking.id, time_end });

    sendBookingConfirmation(booking, service, barber, settings)
      .catch(e => console.error('[email error]', e.message));
  });

  router.get('/legal', (req, res) => {
    const s = getSettings();
    let text = s.legal_text || '';
    text = text.replace(/{shop_name}/g, s.shop_name || 'Barbería');
    text = text.replace(/{shop_address}/g, s.shop_address || '');
    text = text.replace(/{shop_email}/g, s.shop_email || '');
    res.json({ text });
  });

  // ==================== ADMIN ====================

  router.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const db = getDb();
    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
    req.session.adminLoggedIn = true;
    req.session.adminUsername = username;
    res.json({ success: true });
  });

  router.post('/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });

  router.get('/admin/check', (req, res) => {
    res.json({ loggedIn: !!(req.session && req.session.adminLoggedIn) });
  });

  // Admin: settings
  router.get('/admin/settings', requireAdmin, (req, res) => {
    res.json(getSettings());
  });

  router.put('/admin/settings', requireAdmin, (req, res) => {
    const db = getDb();
    const allowed = ['shop_name','shop_tagline','shop_address','shop_phone','shop_email','open_time','close_time','open_days','legal_text','instagram_url','google_maps_url'];
    const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const key of allowed) {
      if (req.body[key] !== undefined) update.run(key, req.body[key]);
    }
    if (req.body.new_password && req.body.new_password.length >= 6) {
      const hash = bcrypt.hashSync(req.body.new_password, 10);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, req.session.adminUsername);
    }
    res.json({ success: true });
  });

  // Admin: services
  router.get('/admin/services', requireAdmin, (req, res) => {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM services ORDER BY sort_order, id').all());
  });

  router.post('/admin/services', requireAdmin, (req, res) => {
    const { name, description, price, duration_minutes, sort_order } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Nombre y precio requeridos' });
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO services (name, description, price, duration_minutes, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(name, description || '', Number(price), Number(duration_minutes) || 30, Number(sort_order) || 0);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.put('/admin/services/:id', requireAdmin, (req, res) => {
    const { name, description, price, duration_minutes, active, sort_order } = req.body;
    const db = getDb();
    db.prepare(
      'UPDATE services SET name=?, description=?, price=?, duration_minutes=?, active=?, sort_order=? WHERE id=?'
    ).run(name, description || '', Number(price), Number(duration_minutes), active ? 1 : 0, Number(sort_order) || 0, req.params.id);
    res.json({ success: true });
  });

  router.delete('/admin/services/:id', requireAdmin, (req, res) => {
    getDb().prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  router.post('/admin/services/:id/photo', requireAdmin, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const db = getDb();
    const service = db.prepare('SELECT photo_url FROM services WHERE id = ?').get(req.params.id);
    if (service && service.photo_url) {
      const oldPath = path.join(uploadsDir, path.basename(service.photo_url));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const url = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE services SET photo_url = ? WHERE id = ?').run(url, req.params.id);
    res.json({ success: true, url });
  });

  // Admin: barbers
  router.get('/admin/barbers', requireAdmin, (req, res) => {
    res.json(getDb().prepare('SELECT * FROM barbers ORDER BY id').all());
  });

  router.post('/admin/barbers', requireAdmin, (req, res) => {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const db = getDb();
    const result = db.prepare('INSERT INTO barbers (name, color) VALUES (?, ?)').run(name, color || '#c8a96e');
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.put('/admin/barbers/:id', requireAdmin, (req, res) => {
    const { name, color, active } = req.body;
    getDb().prepare('UPDATE barbers SET name=?, color=?, active=? WHERE id=?')
      .run(name, color || '#c8a96e', active ? 1 : 0, req.params.id);
    res.json({ success: true });
  });

  // Admin: bookings
  router.get('/admin/bookings', requireAdmin, (req, res) => {
    const db = getDb();
    const { barber_id, date_from, date_to, status } = req.query;
    let q = `SELECT b.*, s.name as service_name, s.price, s.duration_minutes, br.name as barber_name, br.color as barber_color
             FROM bookings b
             JOIN services s ON s.id = b.service_id
             JOIN barbers br ON br.id = b.barber_id
             WHERE 1=1`;
    const params = [];
    if (barber_id) { q += ' AND b.barber_id = ?'; params.push(barber_id); }
    if (date_from) { q += ' AND b.date >= ?'; params.push(date_from); }
    if (date_to) { q += ' AND b.date <= ?'; params.push(date_to); }
    if (status) { q += ' AND b.status = ?'; params.push(status); }
    q += ' ORDER BY b.date, b.time_start';
    res.json(db.prepare(q).all(...params));
  });

  router.post('/admin/bookings', requireAdmin, async (req, res) => {
    const { barber_id, service_id, client_name, client_email, client_phone, date, time_start, notes } = req.body;
    if (!barber_id || !service_id || !client_name || !date || !time_start) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    const db = getDb();
    const settings = getSettings();
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(service_id);
    const barber = db.prepare('SELECT * FROM barbers WHERE id = ?').get(barber_id);
    if (!service || !barber) return res.status(404).json({ error: 'Servicio o barbero no encontrado' });

    const time_end = minutesToTime(timeToMinutes(time_start) + service.duration_minutes);

    const bookings = db.prepare(
      'SELECT time_start, time_end FROM bookings WHERE barber_id = ? AND date = ? AND status != "cancelled"'
    ).all(barber_id, date);
    const blocked = db.prepare('SELECT time_start, time_end FROM blocked_slots WHERE barber_id = ? AND date = ?').all(barber_id, date);
    const available = generateAvailableSlots(settings.open_time, settings.close_time, service.duration_minutes, bookings, blocked);
    if (!available.includes(time_start)) {
      return res.status(409).json({ error: 'Hora no disponible' });
    }

    const result = db.prepare(
      'INSERT INTO bookings (barber_id, service_id, client_name, client_email, client_phone, date, time_start, time_end, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(barber_id, service_id, client_name, client_email || '', client_phone || '', date, time_start, time_end, notes || '');

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    if (client_email) {
      try { await sendBookingConfirmation(booking, service, barber, settings); } catch(e) { console.error(e.message); }
    }
    res.json({ success: true, booking_id: booking.id, time_end });
  });

  router.put('/admin/bookings/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['confirmed','cancelled','completed'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    getDb().prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
  });

  // Admin: blocked days
  router.get('/admin/blocked-days', requireAdmin, (req, res) => {
    const { barber_id } = req.query;
    let q = 'SELECT * FROM blocked_days';
    const params = [];
    if (barber_id) { q += ' WHERE barber_id = ?'; params.push(barber_id); }
    q += ' ORDER BY date';
    res.json(getDb().prepare(q).all(...params));
  });

  router.post('/admin/blocked-days', requireAdmin, (req, res) => {
    const { barber_id, date, reason } = req.body;
    if (!barber_id || !date) return res.status(400).json({ error: 'Faltan campos' });
    const db = getDb();
    const existing = db.prepare('SELECT id FROM blocked_days WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (existing) return res.json({ success: true, id: existing.id });
    const result = db.prepare('INSERT INTO blocked_days (barber_id, date, reason) VALUES (?, ?, ?)').run(barber_id, date, reason || '');
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.delete('/admin/blocked-days/:id', requireAdmin, (req, res) => {
    getDb().prepare('DELETE FROM blocked_days WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Admin: blocked slots
  router.get('/admin/blocked-slots', requireAdmin, (req, res) => {
    const { barber_id, date } = req.query;
    let q = 'SELECT * FROM blocked_slots WHERE 1=1';
    const params = [];
    if (barber_id) { q += ' AND barber_id = ?'; params.push(barber_id); }
    if (date) { q += ' AND date = ?'; params.push(date); }
    q += ' ORDER BY date, time_start';
    res.json(getDb().prepare(q).all(...params));
  });

  router.post('/admin/blocked-slots', requireAdmin, (req, res) => {
    const { barber_id, date, time_start, time_end, reason } = req.body;
    if (!barber_id || !date || !time_start || !time_end) return res.status(400).json({ error: 'Faltan campos' });
    const result = getDb().prepare(
      'INSERT INTO blocked_slots (barber_id, date, time_start, time_end, reason) VALUES (?, ?, ?, ?, ?)'
    ).run(barber_id, date, time_start, time_end, reason || '');
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.delete('/admin/blocked-slots/:id', requireAdmin, (req, res) => {
    getDb().prepare('DELETE FROM blocked_slots WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Admin: blacklist
  router.get('/admin/blacklist', requireAdmin, (req, res) => {
    res.json(getDb().prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all());
  });

  router.post('/admin/blacklist', requireAdmin, (req, res) => {
    const { phone, email, client_name, reason } = req.body;
    if (!phone && !email) return res.status(400).json({ error: 'Se necesita teléfono o email' });
    const db = getDb();
    const existing = db.prepare('SELECT id FROM blacklist WHERE phone = ? OR (email != "" AND email = ?)').get(phone || '', email || '');
    if (existing) return res.json({ success: true, id: existing.id, already: true });
    const result = db.prepare(
      'INSERT INTO blacklist (phone, email, client_name, reason) VALUES (?, ?, ?, ?)'
    ).run(phone || '', email || '', client_name || '', reason || '');
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.delete('/admin/blacklist/:id', requireAdmin, (req, res) => {
    getDb().prepare('DELETE FROM blacklist WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Mark booking as no-show (and optionally blacklist)
  router.post('/admin/bookings/:id/noshow', requireAdmin, (req, res) => {
    const { blacklist: doBlacklist } = req.body;
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(req.params.id);
    if (doBlacklist) {
      const existing = db.prepare('SELECT id FROM blacklist WHERE phone = ? OR (email != "" AND email = ?)').get(booking.client_phone, booking.client_email);
      if (!existing) {
        db.prepare('INSERT INTO blacklist (phone, email, client_name, reason) VALUES (?, ?, ?, ?)').run(
          booking.client_phone, booking.client_email, booking.client_name, 'No presentado'
        );
      }
    }
    res.json({ success: true });
  });

  return router;
}

module.exports = createApiRouter;

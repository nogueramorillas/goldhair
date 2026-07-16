const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getDb, getSettings, generateAvailableSlots, findEarliest, barberHours, timeToMinutes, minutesToTime } = require('../database');
const { sendBookingConfirmation, sendAdminNotification } = require('../email');
const { sendVerificationSMS, isConfigured: smsConfigured } = require('../sms');
const { sendBookingReminder, isConfigured: whatsappConfigured } = require('../whatsapp');

function normalizePhone(p) {
  return (p || '').replace(/\s+/g, '').trim();
}

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

  function requireStaff(req, res, next) {
    if (req.session && req.session.staffBarberId) return next();
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
    const barbers = db.prepare('SELECT id, name, color, photo_url FROM barbers WHERE active = 1 ORDER BY id').all();
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

    const barber = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barber_id);
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
    const { open_time, close_time } = barberHours(barber, settings);
    const available = generateAvailableSlots(open_time, close_time, Number(duration), bookings, blocked, minStart);
    res.json({ available });
  });

  // ==================== PHONE VERIFICATION (SMS) ====================
  // Sending is a no-op until Twilio env vars are set (see src/sms.js), so the
  // booking flow keeps working exactly as before until then.
  router.post('/phone/send-code', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Teléfono requerido' });

    const db = getDb();
    const already = db.prepare('SELECT phone FROM verified_phones WHERE phone = ?').get(phone);
    if (already) return res.json({ already_verified: true, sms_configured: smsConfigured() });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO phone_verifications (phone, code, expires_at) VALUES (?, ?, ?)').run(phone, code, expires_at);

    try {
      await sendVerificationSMS(phone, code);
    } catch (e) {
      console.error('[sms error]', e.message);
      return res.status(500).json({ error: 'No se pudo enviar el SMS. Inténtalo de nuevo.' });
    }
    res.json({ sent: true, sms_configured: smsConfigured() });
  });

  router.post('/phone/verify-code', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const code = (req.body.code || '').trim();
    if (!phone || !code) return res.status(400).json({ error: 'Faltan datos' });

    const db = getDb();
    const record = db.prepare(
      'SELECT * FROM phone_verifications WHERE phone = ? AND verified = 0 ORDER BY id DESC LIMIT 1'
    ).get(phone);

    if (!record) return res.status(400).json({ error: 'Solicita un código nuevo' });
    if (record.attempts >= 5) return res.status(429).json({ error: 'Demasiados intentos. Solicita un código nuevo.' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'El código ha caducado. Solicita uno nuevo.' });

    if (record.code !== code) {
      db.prepare('UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      return res.status(400).json({ error: 'Código incorrecto' });
    }

    db.prepare('UPDATE phone_verifications SET verified = 1 WHERE id = ?').run(record.id);
    db.prepare(
      "INSERT INTO verified_phones (phone) VALUES (?) ON CONFLICT(phone) DO UPDATE SET verified_at = datetime('now')"
    ).run(phone);

    res.json({ verified: true });
  });

  router.post('/bookings', async (req, res) => {
    const { barber_id, service_id, client_name, date, time_start, terms_accepted } = req.body;
    const client_email = (req.body.client_email || '').trim();
    const client_phone = normalizePhone(req.body.client_phone);

    if (!barber_id || !service_id || !client_name || !client_phone || !date || !time_start) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    if (!terms_accepted) return res.status(400).json({ error: 'Debes aceptar los términos y condiciones' });

    const db = getDb();
    const settings = getSettings();

    if (smsConfigured()) {
      const phoneVerified = db.prepare('SELECT phone FROM verified_phones WHERE phone = ?').get(client_phone);
      if (!phoneVerified) return res.status(403).json({ error: 'Verifica tu teléfono antes de reservar' });
    }

    // Check blacklist by phone or email
    const blocked = db.prepare(
      'SELECT id FROM blacklist WHERE phone = ? OR (email != "" AND email = ?)'
    ).get(client_phone.trim(), client_email);
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
    const { open_time, close_time } = barberHours(barber, settings);
    const available = generateAvailableSlots(open_time, close_time, service.duration_minutes, bookings, blockedSlots, minStartBook);
    if (!available.includes(time_start)) {
      return res.status(409).json({ error: 'La hora seleccionada ya no está disponible' });
    }

    const result = db.prepare(`
      INSERT INTO bookings (barber_id, service_id, client_name, client_email, client_phone, date, time_start, time_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(barber_id, service_id, client_name.trim(), client_email, client_phone.trim(), date, time_start, time_end);

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);

    // Responder al cliente inmediatamente, enviar email en segundo plano (si dio uno)
    res.json({ success: true, booking_id: booking.id, time_end });

    if (client_email) {
      sendBookingConfirmation(booking, service, barber, settings)
        .catch(e => console.error('[email error]', e.message));
    }
    sendAdminNotification(booking, service, barber, settings)
      .catch(e => console.error('[email admin notify error]', e.message));
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

  // ==================== STAFF (per-barber, read-only) ====================
  router.post('/staff/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const db = getDb();
    const barber = db.prepare('SELECT * FROM barbers WHERE username = ? AND active = 1').get(username);
    if (!barber || !barber.password_hash) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const ok = await bcrypt.compare(password, barber.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
    req.session.staffBarberId = barber.id;
    res.json({ success: true });
  });

  router.post('/staff/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });

  router.get('/staff/check', (req, res) => {
    res.json({ loggedIn: !!(req.session && req.session.staffBarberId) });
  });

  router.get('/staff/me', requireStaff, (req, res) => {
    const barber = getDb().prepare('SELECT id, name, color, photo_url FROM barbers WHERE id = ?').get(req.session.staffBarberId);
    if (!barber) return res.status(404).json({ error: 'Barbero no encontrado' });
    res.json(barber);
  });

  router.get('/staff/bookings', requireStaff, (req, res) => {
    const db = getDb();
    const { date_from, date_to } = req.query;
    let q = `SELECT b.id, b.client_name, b.date, b.time_start, b.time_end, b.status, s.name as service_name
             FROM bookings b JOIN services s ON s.id = b.service_id
             WHERE b.barber_id = ? AND b.status != 'cancelled'`;
    const params = [req.session.staffBarberId];
    if (date_from) { q += ' AND b.date >= ?'; params.push(date_from); }
    if (date_to) { q += ' AND b.date <= ?'; params.push(date_to); }
    q += ' ORDER BY b.date, b.time_start';
    res.json(db.prepare(q).all(...params));
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
    const barbers = getDb().prepare(
      'SELECT id, name, color, photo_url, open_time, close_time, username, active, created_at FROM barbers ORDER BY id'
    ).all();
    res.json(barbers.map(b => ({ ...b, has_login: !!b.username })));
  });

  router.post('/admin/barbers', requireAdmin, async (req, res) => {
    const { name, color, open_time, close_time, username, password } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const db = getDb();

    let password_hash = '';
    let finalUsername = null;
    if (username && username.trim()) {
      if (!password) return res.status(400).json({ error: 'Define una contraseña para el acceso de trabajador' });
      const clash = db.prepare('SELECT id FROM barbers WHERE username = ?').get(username.trim());
      if (clash) return res.status(409).json({ error: 'Ese usuario ya está en uso' });
      finalUsername = username.trim();
      password_hash = bcrypt.hashSync(password, 10);
    }

    const result = db.prepare(
      'INSERT INTO barbers (name, color, open_time, close_time, username, password_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, color || '#c8a96e', open_time || '', close_time || '', finalUsername, password_hash);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.put('/admin/barbers/:id', requireAdmin, async (req, res) => {
    const { name, color, active, open_time, close_time, username, password } = req.body;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM barbers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Barbero no encontrado' });

    let finalUsername = existing.username;
    let password_hash = existing.password_hash;

    if (!username || !username.trim()) {
      // Clearing the username revokes staff access entirely
      finalUsername = null;
      password_hash = '';
    } else {
      const trimmed = username.trim();
      const clash = db.prepare('SELECT id FROM barbers WHERE username = ? AND id != ?').get(trimmed, req.params.id);
      if (clash) return res.status(409).json({ error: 'Ese usuario ya está en uso' });
      finalUsername = trimmed;
      if (password) password_hash = bcrypt.hashSync(password, 10);
      else if (!existing.username) return res.status(400).json({ error: 'Define una contraseña para el acceso de trabajador' });
    }

    db.prepare('UPDATE barbers SET name=?, color=?, active=?, open_time=?, close_time=?, username=?, password_hash=? WHERE id=?')
      .run(name, color || '#c8a96e', active ? 1 : 0, open_time || '', close_time || '', finalUsername, password_hash, req.params.id);
    res.json({ success: true });
  });

  router.post('/admin/barbers/:id/photo', requireAdmin, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    const db = getDb();
    const barber = db.prepare('SELECT photo_url FROM barbers WHERE id = ?').get(req.params.id);
    if (barber && barber.photo_url) {
      const oldPath = path.join(uploadsDir, path.basename(barber.photo_url));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    const url = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE barbers SET photo_url = ? WHERE id = ?').run(url, req.params.id);
    res.json({ success: true, url });
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
    const { open_time, close_time } = barberHours(barber, settings);
    const available = generateAvailableSlots(open_time, close_time, service.duration_minutes, bookings, blocked);
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

  // Admin: move/edit a booking (drag-and-drop reschedule or manual edit)
  router.put('/admin/bookings/:id/reschedule', requireAdmin, (req, res) => {
    const db = getDb();
    const bookingId = req.params.id;
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!existing) return res.status(404).json({ error: 'Cita no encontrada' });

    const barber_id = req.body.barber_id || existing.barber_id;
    const date = req.body.date || existing.date;
    const time_start = req.body.time_start || existing.time_start;

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(existing.service_id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    const barber = db.prepare('SELECT * FROM barbers WHERE id = ?').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'Barbero no encontrado' });

    const time_end = minutesToTime(timeToMinutes(time_start) + service.duration_minutes);

    const bookings = db.prepare(
      'SELECT id, time_start, time_end FROM bookings WHERE barber_id = ? AND date = ? AND status != "cancelled" AND id != ?'
    ).all(barber_id, date, bookingId);
    const blocked = db.prepare('SELECT time_start, time_end FROM blocked_slots WHERE barber_id = ? AND date = ?').all(barber_id, date);

    const newStart = timeToMinutes(time_start);
    const newEnd = timeToMinutes(time_end);
    const overlapsBooking = bookings.some(b => newStart < timeToMinutes(b.time_end) && newEnd > timeToMinutes(b.time_start));
    const overlapsBlocked = blocked.some(b => newStart < timeToMinutes(b.time_end) && newEnd > timeToMinutes(b.time_start));
    if (overlapsBooking || overlapsBlocked) {
      return res.status(409).json({ error: 'Ese horario se solapa con otra cita o bloqueo' });
    }

    db.prepare('UPDATE bookings SET barber_id = ?, date = ?, time_start = ?, time_end = ? WHERE id = ?')
      .run(barber_id, date, time_start, time_end, bookingId);

    res.json({ success: true, booking_id: bookingId, date, time_start, time_end, barber_id });
  });

  router.post('/admin/bookings/:id/send-whatsapp-reminder', requireAdmin, async (req, res) => {
    if (!whatsappConfigured()) {
      return res.status(400).json({ error: 'WhatsApp no configurado todavía (faltan credenciales de Twilio)' });
    }
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Cita no encontrada' });
    if (!booking.client_phone) return res.status(400).json({ error: 'Esta cita no tiene teléfono' });

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(booking.service_id);
    const barber = db.prepare('SELECT * FROM barbers WHERE id = ?').get(booking.barber_id);
    const settings = getSettings();

    try {
      await sendBookingReminder(booking, service, barber, settings);
      res.json({ success: true });
    } catch (e) {
      console.error('[whatsapp error]', e.message);
      res.status(500).json({ error: 'No se pudo enviar el recordatorio por WhatsApp' });
    }
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

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('./src/database');
const createApiRouter = require('./src/routes/api');

const PORT = process.env.PORT || 3000;

// Use DATA_DIR env var if set; otherwise use /data on Railway (volume mount), ./data locally
const DATA_DIR = process.env.DATA_DIR ||
  (process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, 'data'));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

async function start() {
  await initDatabase(DATA_DIR);

  const app = express();
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(session({
    store: new FileStore({ path: SESSIONS_DIR, ttl: 86400, retries: 0 }),
    secret: process.env.SESSION_SECRET || 'barberia-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: 'lax',
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/api', createApiRouter(DATA_DIR, UPLOADS_DIR));

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.listen(PORT, () => {
    console.log(`✂  Gold Hair corriendo en http://localhost:${PORT}`);
    console.log(`   Datos en: ${DATA_DIR}`);
    console.log(`   Admin: http://localhost:${PORT}/admin  (user: admin / pass: admin123)`);
  });
}

start().catch(err => { console.error('Error al iniciar:', err); process.exit(1); });

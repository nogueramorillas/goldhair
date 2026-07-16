const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
}

function formatDateES(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return `${days[dt.getDay()]} ${Number(d)} de ${months[Number(m) - 1]} de ${y}`;
}

async function sendBookingConfirmation(booking, service, barber, settings) {
  const t = getTransporter();
  if (!t) {
    console.log('[email] No configurado, omitiendo confirmación');
    return;
  }

  const shopName = settings.shop_name || 'Barbería';

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmación de cita</title>
<style>
  body{margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif}
  .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)}
  .hd{background:#111;padding:35px 30px;text-align:center}
  .hd h1{margin:0;color:#c8a96e;font-size:26px;letter-spacing:3px;font-weight:700}
  .hd p{margin:6px 0 0;color:#888;font-size:14px;letter-spacing:1px}
  .body{padding:30px}
  .body p{color:#333;line-height:1.6;margin:0 0 15px}
  .card{background:#faf7f2;border-left:4px solid #c8a96e;border-radius:6px;padding:20px;margin:20px 0}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
  .row:last-child{border-bottom:none}
  .lbl{color:#777;font-size:13px}
  .val{font-weight:700;color:#111;font-size:14px}
  .badge{display:inline-block;background:#111;color:#c8a96e;padding:4px 12px;border-radius:20px;font-size:12px;letter-spacing:1px;margin-bottom:15px}
  .info{background:#f9f9f9;border-radius:6px;padding:15px;margin:15px 0;font-size:13px;color:#555}
  .info strong{color:#111}
  .ft{background:#111;padding:20px;text-align:center}
  .ft p{margin:4px 0;color:#555;font-size:12px}
  .ft .sc{color:#c8a96e}
</style>
</head>
<body>
<div class="wrap">
  <div class="hd">
    <h1>${shopName}</h1>
    <p>Confirmación de cita</p>
  </div>
  <div class="body">
    <p>Hola <strong>${booking.client_name}</strong>,</p>
    <p>Tu cita ha sido <strong>confirmada</strong> con éxito. Aquí tienes todos los detalles:</p>
    <span class="badge">RESERVA CONFIRMADA</span>
    <div class="card">
      <div class="row"><span class="lbl">Servicio</span><span class="val">${service.name}</span></div>
      <div class="row"><span class="lbl">Barbero</span><span class="val">${barber.name}</span></div>
      <div class="row"><span class="lbl">Fecha</span><span class="val">${formatDateES(booking.date)}</span></div>
      <div class="row"><span class="lbl">Hora</span><span class="val">${booking.time_start} - ${booking.time_end}</span></div>
      <div class="row"><span class="lbl">Duración</span><span class="val">${service.duration_minutes} minutos</span></div>
      <div class="row"><span class="lbl">Precio</span><span class="val">${service.price}€</span></div>
      <div class="row"><span class="lbl">Pago</span><span class="val">En local (efectivo o tarjeta)</span></div>
    </div>
    <div class="info">
      <strong>📍 Dirección:</strong> ${settings.shop_address || ''}<br>
      <strong>📞 Teléfono:</strong> ${settings.shop_phone || ''}
    </div>
    <p style="font-size:13px;color:#888">Si necesitas cancelar o modificar tu cita, contacta con nosotros con al menos 24 horas de antelación.</p>
  </div>
  <div class="ft">
    <p class="sc">${shopName}</p>
    <p>${settings.shop_address || ''}</p>
    <p>© ${new Date().getFullYear()} ${shopName}. Todos los derechos reservados.</p>
  </div>
</div>
</body></html>`;

  await t.sendMail({
    from: `${shopName} <${process.env.GMAIL_USER}>`,
    to: booking.client_email,
    subject: `Cita confirmada - ${shopName}`,
    html
  });
}

async function sendAdminNotification(booking, service, barber, settings) {
  const t = getTransporter();
  if (!t || !settings.shop_email) {
    console.log('[email] Notificación admin omitida (email no configurado o sin shop_email)');
    return;
  }

  const shopName = settings.shop_name || 'Gold Hair';

  await t.sendMail({
    from: `${shopName} <${process.env.GMAIL_USER}>`,
    to: settings.shop_email,
    subject: `🔔 Nueva reserva: ${booking.client_name} - ${formatDateES(booking.date)}`,
    html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
  <div style="background:#111;padding:24px;text-align:center">
    <h1 style="margin:0;color:#c8a96e;font-size:20px;letter-spacing:2px">🔔 Nueva reserva</h1>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 12px;color:#333"><strong>${booking.client_name}</strong> ha reservado cita:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#777">Servicio</td><td style="padding:6px 0;text-align:right;font-weight:700">${service.name}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Barbero</td><td style="padding:6px 0;text-align:right;font-weight:700">${barber.name}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Fecha</td><td style="padding:6px 0;text-align:right;font-weight:700">${formatDateES(booking.date)}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Hora</td><td style="padding:6px 0;text-align:right;font-weight:700">${booking.time_start} - ${booking.time_end}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Teléfono</td><td style="padding:6px 0;text-align:right;font-weight:700">${booking.client_phone || '—'}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Email</td><td style="padding:6px 0;text-align:right;font-weight:700">${booking.client_email || '—'}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Precio</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#c8a96e">${service.price}€</td></tr>
    </table>
  </div>
</div></body></html>`
  });
}

async function sendVerificationCode(email, code, settings) {
  const t = getTransporter();
  if (!t) throw new Error('Email no configurado');
  const shopName = (settings && settings.shop_name) || 'Barbería';
  await t.sendMail({
    from: `${shopName} <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `${code} – Código de verificación`,
    html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:20px;background:#f0f0f0;font-family:Arial,sans-serif">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
  <div style="background:#111;padding:28px;text-align:center">
    <h1 style="margin:0;color:#c8a96e;font-size:22px;letter-spacing:2px">${shopName}</h1>
  </div>
  <div style="padding:32px;text-align:center">
    <p style="color:#333;margin:0 0 8px">Tu código de verificación es:</p>
    <div style="font-size:42px;font-weight:700;letter-spacing:10px;color:#111;margin:16px 0">${code}</div>
    <p style="color:#888;font-size:13px;margin:0">Válido durante 10 minutos. No lo compartas con nadie.</p>
  </div>
</div></body></html>`
  });
}

module.exports = { sendBookingConfirmation, sendAdminNotification, sendVerificationCode };

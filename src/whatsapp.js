// Sends WhatsApp messages via Twilio's REST API (same account as SMS, plain fetch).
// Until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM are set, this
// no-ops instead of throwing, mirroring src/sms.js's behavior.

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

function toWhatsAppAddress(number) {
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

async function sendWhatsAppMessage(phone, message) {
  if (!isConfigured()) {
    console.log(`[whatsapp] Twilio WhatsApp no configurado, omitiendo envío a ${phone}: ${message}`);
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  const body = new URLSearchParams({
    To: toWhatsAppAddress(phone),
    From: toWhatsAppAddress(from),
    Body: message
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Twilio WhatsApp error ${res.status}: ${errText}`);
  }
}

async function sendBookingReminder(booking, service, barber, settings) {
  const shopName = (settings && settings.shop_name) || 'Gold Hair';
  const message = `${shopName}: te recordamos tu cita de ${service.name} con ${barber.name} el ${booking.date} a las ${booking.time_start}. ¡Te esperamos!`;
  await sendWhatsAppMessage(booking.client_phone, message);
}

module.exports = { sendWhatsAppMessage, sendBookingReminder, isConfigured };

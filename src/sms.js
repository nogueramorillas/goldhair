// Sends SMS verification codes via Twilio's REST API (plain fetch, no SDK dependency).
// Until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are set, this
// no-ops instead of throwing, mirroring src/email.js's behavior when Gmail isn't configured.

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

async function sendVerificationSMS(phone, code, settings) {
  if (!isConfigured()) {
    console.log(`[sms] Twilio no configurado, omitiendo envío (código para ${phone}: ${code})`);
    return;
  }

  const shopName = (settings && settings.shop_name) || 'Gold Hair';
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `${shopName}: tu código de verificación es ${code}. Válido 10 minutos.`
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
    throw new Error(`Twilio error ${res.status}: ${errText}`);
  }
}

module.exports = { sendVerificationSMS, isConfigured };

// State
const state = {
  step: 1,
  service: null,
  barber: null,
  date: null,
  time: null,
  calYear: null,
  calMonth: null,
  services: [],
  barbers: [],
  shopSettings: {}
};

const DAYS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  const [settings, services, barbers] = await Promise.all([
    fetch('/api/settings').then(r => r.json()),
    fetch('/api/services').then(r => r.json()),
    fetch('/api/barbers').then(r => r.json())
  ]);
  state.shopSettings = settings;
  state.services = services;
  state.barbers = barbers;

  document.getElementById('shopName').textContent = settings.shop_name || 'Barbería';
  document.getElementById('shopTagline').textContent = settings.shop_tagline || '';
  document.getElementById('footerShopName').textContent = settings.shop_name || 'Barbería';
  document.getElementById('footerAddress').textContent = settings.shop_address || '';
  document.getElementById('footerPhone').textContent = settings.shop_phone || '';
  document.title = (settings.shop_name || 'Barbería') + ' · Reservas Online';

  setupSocialSection(settings);
  renderServiceCards();
}

function renderServiceCards() {
  const grid = document.getElementById('servicesGrid');
  if (!state.services.length) {
    grid.innerHTML = '<p style="color:var(--grey);text-align:center;grid-column:1/-1;padding:40px">No hay servicios disponibles</p>';
    return;
  }
  grid.innerHTML = state.services.map(s => `
    <div class="service-card" onclick="openBookingWithService(${s.id})">
      ${s.photo_url
        ? `<img class="service-img" src="${s.photo_url}" alt="${s.name}" loading="lazy">`
        : `<div class="service-img-placeholder">✂</div>`}
      <div class="service-info">
        <h3>${s.name}</h3>
        <p>${s.description || ''}</p>
        <div class="service-meta">
          <span class="service-price">${s.price}€</span>
          <span class="service-duration">⏱ ${s.duration_minutes} min</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ===== SOCIAL SECTION =====
function setupSocialSection(settings) {
  const hasIg = settings.instagram_url && settings.instagram_url.trim();
  const hasAddress = settings.shop_address && settings.shop_address.trim();
  const hasMaps = settings.google_maps_url && settings.google_maps_url.trim();

  if (!hasIg && !hasAddress && !hasMaps) return;

  document.getElementById('socialSection').classList.remove('hidden');

  if (hasIg) {
    const card = document.getElementById('igCard');
    card.href = settings.instagram_url;
    card.classList.remove('hidden');
    try {
      const u = new URL(settings.instagram_url);
      const handle = u.pathname.replace(/\//g, '').trim();
      document.getElementById('igHandle').textContent = handle ? '@' + handle : 'Instagram';
    } catch { /* keep default */ }
  }

  if (hasAddress || hasMaps) {
    const mapsCard = document.getElementById('mapsCard');
    mapsCard.classList.remove('hidden');
    const src = hasMaps
      ? settings.google_maps_url
      : `https://www.google.com/maps?q=${encodeURIComponent(settings.shop_address)}&output=embed&hl=es`;
    document.getElementById('mapsFrame').src = src;
  }
}

// ===== BOOKING MODAL =====
function openBooking() {
  resetBooking();
  document.getElementById('bookingModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function openBookingWithService(serviceId) {
  resetBooking();
  const svc = state.services.find(s => s.id === serviceId);
  if (svc) {
    state.service = svc;
    goToStep(2);
  } else {
    goToStep(1);
  }
  document.getElementById('bookingModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeBooking() {
  document.getElementById('bookingModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeBookingOnOverlay(e) {
  if (e.target === document.getElementById('bookingModal')) closeBooking();
}

function resetBooking() {
  state.step = 1;
  state.service = null;
  state.barber = null;
  state.date = null;
  state.time = null;
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth();
  goToStep(1);
}

function prevStep() {
  if (state.step > 1) goToStep(state.step - 1);
}

function nextStep() {
  if (!validateCurrentStep()) return;
  goToStep(state.step + 1);
}

function validateCurrentStep() {
  if (state.step === 1 && !state.service) { alert('Por favor selecciona un servicio'); return false; }
  if (state.step === 2 && !state.barber) { alert('Por favor selecciona un barbero'); return false; }
  if (state.step === 3 && !state.date) { alert('Por favor selecciona una fecha'); return false; }
  if (state.step === 4 && !state.time) { alert('Por favor selecciona una hora'); return false; }
  if (state.step === 5) {
    const name = document.getElementById('clientName').value.trim();
    const email = document.getElementById('clientEmail').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    if (!name || !email || !phone) { alert('Por favor rellena todos los campos'); return false; }
    if (!/\S+@\S+\.\S+/.test(email)) { alert('Email no válido'); return false; }
  }
  return true;
}

async function goToStep(n) {
  // Update dots
  document.querySelectorAll('.step-dot').forEach(d => {
    const s = Number(d.dataset.step);
    d.classList.remove('active', 'done');
    if (s === n) d.classList.add('active');
    else if (s < n) d.classList.add('done');
  });

  // Hide all steps
  for (let i = 1; i <= 6; i++) {
    document.getElementById(`step${i}`).classList.add('hidden');
  }
  document.getElementById(`step${n}`).classList.remove('hidden');

  state.step = n;

  // Navigation
  const btnBack = document.getElementById('btnBack');
  const btnNext = document.getElementById('btnNext');
  const btnConfirm = document.getElementById('btnConfirm');

  btnBack.style.visibility = n === 1 ? 'hidden' : 'visible';

  if (n === 6) {
    btnNext.classList.add('hidden');
    btnConfirm.classList.remove('hidden');
    btnConfirm.disabled = !document.getElementById('termsCheck').checked;
  } else {
    btnNext.classList.remove('hidden');
    btnConfirm.classList.add('hidden');
    btnNext.disabled = false;
  }

  // Step-specific rendering
  if (n === 1) renderBookingServices();
  if (n === 2) renderBarbersList();
  if (n === 3) renderCalendar();
  if (n === 4) await renderTimeSlots();
  if (n === 6) renderSummary();
}

function renderBookingServices() {
  const container = document.getElementById('bookingServices');
  container.innerHTML = state.services.map(s => `
    <div class="booking-service-item ${state.service?.id === s.id ? 'selected' : ''}" onclick="selectService(${s.id})">
      <div class="bsi-icon">
        ${s.photo_url ? `<img src="${s.photo_url}" alt="${s.name}">` : '✂'}
      </div>
      <div class="bsi-info">
        <div class="bsi-name">${s.name}</div>
        <div class="bsi-desc">${s.description || ''}</div>
      </div>
      <div class="bsi-right">
        <div class="bsi-price">${s.price}€</div>
        <div class="bsi-dur">${s.duration_minutes} min</div>
      </div>
    </div>
  `).join('');
}

function selectService(id) {
  state.service = state.services.find(s => s.id === id);
  state.barber = null;
  state.date = null;
  state.time = null;
  renderBookingServices();
}

async function renderBarbersList() {
  const container = document.getElementById('barbersList');
  if (!state.barbers.length) {
    container.innerHTML = '<p style="color:var(--grey);text-align:center;padding:20px">No hay barberos disponibles</p>';
    return;
  }
  container.innerHTML = '<p style="color:var(--grey);font-size:13px;margin-bottom:12px">Cargando disponibilidad...</p>';

  const duration = state.service?.duration_minutes || 30;
  const earliestData = await Promise.all(
    state.barbers.map(b => fetch(`/api/barbers/${b.id}/earliest?duration=${duration}`).then(r => r.json()))
  );

  container.innerHTML = state.barbers.map((b, i) => {
    const e = earliestData[i];
    const earliestText = e && e.date
      ? `Próxima cita: ${formatDateShort(e.date)} a las ${e.time}`
      : 'Sin disponibilidad próxima';
    return `
      <div class="barber-item ${state.barber?.id === b.id ? 'selected' : ''}" onclick="selectBarber(${b.id}, '${e.date || ''}', '${e.time || ''}')">
        <div class="barber-avatar" style="background:${b.color}22;border:2px solid ${b.color}">
          <span style="color:${b.color}">✂</span>
        </div>
        <div class="barber-item-info">
          <div class="barber-item-name">${b.name}</div>
          <div class="barber-earliest">${earliestText}</div>
        </div>
        ${state.barber?.id === b.id ? '<span style="color:var(--gold);font-size:18px">✓</span>' : ''}
      </div>
    `;
  }).join('');
}

function selectBarber(id, earliestDate, earliestTime) {
  state.barber = state.barbers.find(b => b.id === id);
  // Pre-select earliest date
  if (earliestDate) {
    const [y, m, d] = earliestDate.split('-').map(Number);
    state.calYear = y;
    state.calMonth = m - 1;
    state.date = earliestDate;
  } else {
    state.date = null;
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();
  }
  state.time = null;
  renderBarbersList();
}

function renderCalendar() {
  document.getElementById('calendarTitle').textContent = `${MONTHS_ES[state.calMonth]} ${state.calYear}`;
  const grid = document.getElementById('calendarGrid');

  const openDays = (state.shopSettings.open_days || '1,2,3,4,5,6').split(',').map(Number);
  const today = new Date();
  today.setHours(0,0,0,0);

  const firstDay = new Date(state.calYear, state.calMonth, 1);
  const lastDay = new Date(state.calYear, state.calMonth + 1, 0);
  const startDow = firstDay.getDay();

  let html = DAYS_ES.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  for (let i = 0; i < startDow; i++) html += '<div class="cal-day empty"></div>';

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const d = new Date(state.calYear, state.calMonth, day);
    const dateStr = `${state.calYear}-${String(state.calMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isPast = d < today;
    const isClosed = !openDays.includes(d.getDay());
    const isToday = d.getTime() === today.getTime();
    const isSelected = dateStr === state.date;
    const disabled = isPast || isClosed;

    html += `<div class="cal-day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}${disabled ? ' disabled' : ''}"
      ${!disabled ? `onclick="selectDate('${dateStr}')"` : ''}>${day}</div>`;
  }

  grid.innerHTML = html;
}

function changeMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  renderCalendar();
}

function selectDate(dateStr) {
  state.date = dateStr;
  state.time = null;
  renderCalendar();
}

async function renderTimeSlots() {
  const container = document.getElementById('timeSlots');
  const dateEl = document.getElementById('dateDisplay');

  if (!state.date || !state.barber || !state.service) {
    container.innerHTML = '<p class="no-slots">Faltan datos para mostrar horarios</p>';
    return;
  }

  dateEl.textContent = formatDateLong(state.date) + ' · ' + state.barber.name;
  container.innerHTML = '<p class="no-slots">Cargando horarios...</p>';

  const res = await fetch(`/api/availability?barber_id=${state.barber.id}&date=${state.date}&duration=${state.service.duration_minutes}`);
  const data = await res.json();

  if (!data.available || !data.available.length) {
    const reason = data.reason === 'blocked_day' ? 'Este día está bloqueado' :
                   data.reason === 'closed' ? 'El local está cerrado este día' : 'No hay horas disponibles para esta fecha';
    container.innerHTML = `<p class="no-slots">⚠ ${reason}</p>`;
    return;
  }

  container.innerHTML = data.available.map(t => `
    <div class="time-slot ${state.time === t ? 'selected' : ''}" onclick="selectTime('${t}')">${t}</div>
  `).join('');
}

function selectTime(t) {
  state.time = t;
  document.querySelectorAll('.time-slot').forEach(el => {
    el.classList.toggle('selected', el.textContent.trim() === t);
  });
}


function renderSummary() {
  const s = state;
  const endMin = timeToMinutes(s.time) + s.service.duration_minutes;
  const endTime = minutesToTime(endMin);

  document.getElementById('bookingSummary').innerHTML = `
    <div class="summary-row"><span class="summary-label">Servicio</span><span class="summary-value">${s.service.name}</span></div>
    <div class="summary-row"><span class="summary-label">Barbero</span><span class="summary-value">${s.barber.name}</span></div>
    <div class="summary-row"><span class="summary-label">Fecha</span><span class="summary-value">${formatDateLong(s.date)}</span></div>
    <div class="summary-row"><span class="summary-label">Hora</span><span class="summary-value">${s.time} - ${endTime}</span></div>
    <div class="summary-row"><span class="summary-label">Precio</span><span class="summary-value gold">${s.service.price}€</span></div>
    <div class="summary-row"><span class="summary-label">Pago</span><span class="summary-value">En local (efectivo o tarjeta)</span></div>
    <div class="summary-row"><span class="summary-label">Nombre</span><span class="summary-value">${document.getElementById('clientName').value}</span></div>
    <div class="summary-row"><span class="summary-label">Email</span><span class="summary-value">${document.getElementById('clientEmail').value}</span></div>
    <div class="summary-row"><span class="summary-label">Teléfono</span><span class="summary-value">${document.getElementById('clientPhone').value}</span></div>
  `;
}

function updateConfirmBtn() {
  document.getElementById('btnConfirm').disabled = !document.getElementById('termsCheck').checked;
}

async function submitBooking() {
  const confirmError = document.getElementById('confirmError');
  confirmError.classList.add('hidden');

  const btn = document.getElementById('btnConfirm');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const body = {
    barber_id: state.barber.id,
    service_id: state.service.id,
    client_name: document.getElementById('clientName').value.trim(),
    client_email: document.getElementById('clientEmail').value.trim(),
    client_phone: document.getElementById('clientPhone').value.trim(),
    date: state.date,
    time_start: state.time,
    terms_accepted: true
  };

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error al crear la reserva');

    closeBooking();
    showSuccess(data);
  } catch (e) {
    confirmError.textContent = e.message;
    confirmError.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Confirmar reserva';
  }
}

function showSuccess(data) {
  const endMin = timeToMinutes(state.time) + state.service.duration_minutes;
  document.getElementById('successDetails').innerHTML =
    `<strong>${state.service.name}</strong> con <strong>${state.barber.name}</strong><br>
     ${formatDateLong(state.date)} · ${state.time} - ${minutesToTime(endMin)}<br>
     <strong style="color:var(--gold)">${state.service.price}€</strong>`;
  document.getElementById('successModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSuccess() {
  document.getElementById('successModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ===== LEGAL =====
async function showLegal() {
  const modal = document.getElementById('legalModal');
  const content = document.getElementById('legalContent');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (!content.textContent) {
    const data = await fetch('/api/legal').then(r => r.json());
    content.textContent = data.text;
  }
}

function closeLegal() {
  document.getElementById('legalModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeLegalOnOverlay(e) {
  if (e.target === document.getElementById('legalModal')) closeLegal();
}

// ===== UTILS =====
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
}

function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = ['dom','lun','mar','mié','jue','vie','sáb'];
  return `${days[dt.getDay()]} ${d}/${m}`;
}

function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${days[dt.getDay()]} ${d} de ${months[m-1]} de ${y}`;
}

document.addEventListener('DOMContentLoaded', init);

// State
let allBarbers = [];
let allServices = [];
let currentWeekStart = null;
let agendaBookings = [];
let agendaBlocked = [];
let agendaBlockedDays = [];
let pendingPhotoFile = null;

// Wrapper for all admin API calls – shows login on 401
async function adminFetch(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (res.status === 401) {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    showToast('Sesión expirada, vuelve a entrar', 'error');
    return null;
  }
  return res;
}

function populateTimeSelects() {
  const opts = [];
  for (let h = 7; h <= 23; h++) {
    for (let m = 0; m < 60; m += 15) {
      const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      opts.push(`<option value="${t}">${t}</option>`);
    }
  }
  const html = opts.join('');
  ['bsStart', 'bsEnd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
  const startEl = document.getElementById('bsStart');
  const endEl = document.getElementById('bsEnd');
  if (startEl) startEl.value = '09:00';
  if (endEl) endEl.value = '14:00';
}

const DAYS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ===== INIT =====
async function init() {
  const res = await fetch('/api/admin/check');
  const data = await res.json();
  if (data.loggedIn) showDashboard();
}

async function doLogin(e) {
  e.preventDefault();
  const err = document.getElementById('loginError');
  err.classList.add('hidden');

  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('loginUser').value,
      password: document.getElementById('loginPass').value
    })
  });
  const data = await res.json();
  if (data.success) showDashboard();
  else { err.textContent = data.error || 'Error al iniciar sesión'; err.classList.remove('hidden'); }
}

async function doLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginPass').value = '';
}

async function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  populateTimeSelects();
  await loadBarbers();
  await loadServices();
  initWeek();
  loadAgenda();
  populateBarberSelects();
}

function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  if (sec) { sec.classList.remove('hidden'); sec.classList.add('active'); }
  if (el) el.classList.add('active');
  document.getElementById('mobileTitle').textContent = el ? el.querySelector('span:last-child').textContent : '';
  if (window.innerWidth < 900) closeSidebar();

  if (name === 'agenda') loadAgenda();
  if (name === 'services') loadServicesTable();
  if (name === 'barbers') loadBarbersCards();
  if (name === 'blocked') loadBlocked();
  if (name === 'settings') loadSettings();
  if (name === 'new-booking') populateNbSelects();
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
}

// ===== BARBERS =====
async function loadBarbers() {
  const res = await adminFetch('/api/admin/barbers');
  if (!res) return;
  allBarbers = await res.json();
}

async function loadBarbersCards() {
  await loadBarbers();
  const container = document.getElementById('barbersCards');
  if (!allBarbers.length) {
    container.innerHTML = '<p style="color:var(--grey);padding:20px">No hay barberos. Añade el primero.</p>';
    return;
  }
  container.innerHTML = allBarbers.map(b => `
    <div class="barber-card">
      <div class="barber-avatar-lg" style="background:${b.color}22;border:2px solid ${b.color}">
        <span style="color:${b.color};font-size:28px">✂</span>
      </div>
      <h3>${b.name}</h3>
      <p class="barber-card-status">
        <span class="badge ${b.active ? 'badge-active' : 'badge-inactive'}">${b.active ? 'Activo' : 'Inactivo'}</span>
      </p>
      <div class="barber-card-actions">
        <button class="btn-sm btn-edit" onclick="openBarberModal(${b.id})">Editar</button>
      </div>
    </div>
  `).join('');
}

function openBarberModal(id) {
  document.getElementById('barberModal').classList.remove('hidden');
  document.getElementById('barberName').value = '';
  document.getElementById('barberColor').value = '#c8a96e';
  document.getElementById('barberColorHex').textContent = '#c8a96e';
  document.getElementById('barberActiveGroup').style.display = 'none';
  document.getElementById('barberId').value = '';
  document.getElementById('barberModalTitle').textContent = 'Nuevo barbero';

  if (id) {
    const b = allBarbers.find(x => x.id === id);
    if (b) {
      document.getElementById('barberId').value = b.id;
      document.getElementById('barberName').value = b.name;
      document.getElementById('barberColor').value = b.color;
      document.getElementById('barberColorHex').textContent = b.color;
      document.getElementById('barberActive').value = b.active;
      document.getElementById('barberActiveGroup').style.display = 'block';
      document.getElementById('barberModalTitle').textContent = 'Editar barbero';
    }
  }
}

document.getElementById('barberColor')?.addEventListener('input', function() {
  document.getElementById('barberColorHex').textContent = this.value;
});

async function saveBarber() {
  const id = document.getElementById('barberId').value;
  const name = document.getElementById('barberName').value.trim();
  const color = document.getElementById('barberColor').value;
  const active = document.getElementById('barberActive').value;
  if (!name) return showToast('El nombre es obligatorio', 'error');

  const url = id ? `/api/admin/barbers/${id}` : '/api/admin/barbers';
  const method = id ? 'PUT' : 'POST';
  const body = id ? { name, color, active: Number(active) } : { name, color };

  const res = await adminFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res) return;
  const data = await res.json();
  if (data.success) {
    closeBarberModal();
    await loadBarbers();
    loadBarbersCards();
    populateBarberSelects();
    showToast(id ? 'Barbero actualizado' : 'Barbero añadido', 'success');
  } else showToast(data.error || 'Error', 'error');
}

function closeBarberModal() { document.getElementById('barberModal').classList.add('hidden'); }
function closeBarberModalOnOverlay(e) { if (e.target === document.getElementById('barberModal')) closeBarberModal(); }

function populateBarberSelects() {
  const active = allBarbers.filter(b => b.active);
  ['agendaBarberId','bdBarber','bsBarber'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const hasAll = id === 'agendaBarberId';
    el.innerHTML = (hasAll ? '<option value="">Todos</option>' : '') +
      active.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  });
}

// ===== SERVICES =====
async function loadServices() {
  const res = await adminFetch('/api/admin/services');
  if (!res) return;
  allServices = await res.json();
}

async function loadServicesTable() {
  await loadServices();
  const tbody = document.getElementById('servicesTbody');
  if (!allServices.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--grey);padding:30px">No hay servicios</td></tr>';
    return;
  }
  tbody.innerHTML = allServices.map(s => `
    <tr>
      <td>${s.photo_url
        ? `<img class="svc-thumb" src="${s.photo_url}" alt="${s.name}">`
        : `<div class="svc-thumb-placeholder">✂</div>`}</td>
      <td><strong>${s.name}</strong></td>
      <td style="color:var(--grey);font-size:12px;max-width:200px">${s.description || '—'}</td>
      <td><strong style="color:var(--gold)">${s.price}€</strong></td>
      <td>${s.duration_minutes} min</td>
      <td><span class="badge ${s.active ? 'badge-active' : 'badge-inactive'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="table-actions">
        <button class="btn-sm btn-edit" onclick="openServiceModal(${s.id})">Editar</button>
        <button class="btn-sm btn-delete" onclick="deleteService(${s.id})">Eliminar</button>
      </div></td>
    </tr>
  `).join('');
}

function openServiceModal(id) {
  document.getElementById('serviceModal').classList.remove('hidden');
  document.getElementById('serviceId').value = '';
  document.getElementById('svcName').value = '';
  document.getElementById('svcDesc').value = '';
  document.getElementById('svcPrice').value = '';
  document.getElementById('svcDuration').value = '30';
  document.getElementById('svcOrder').value = '0';
  document.getElementById('svcActive').value = '1';
  document.getElementById('svcPhotoPreview').classList.add('hidden');
  document.getElementById('svcPhotoPreview').src = '';
  document.getElementById('photoUploadBtn').style.display = 'flex';
  document.getElementById('serviceModalTitle').textContent = 'Nuevo servicio';
  pendingPhotoFile = null;

  if (id) {
    const s = allServices.find(x => x.id === id);
    if (s) {
      document.getElementById('serviceId').value = s.id;
      document.getElementById('svcName').value = s.name;
      document.getElementById('svcDesc').value = s.description || '';
      document.getElementById('svcPrice').value = s.price;
      document.getElementById('svcDuration').value = s.duration_minutes;
      document.getElementById('svcOrder').value = s.sort_order;
      document.getElementById('svcActive').value = s.active;
      document.getElementById('serviceModalTitle').textContent = 'Editar servicio';
      if (s.photo_url) {
        document.getElementById('svcPhotoPreview').src = s.photo_url;
        document.getElementById('svcPhotoPreview').classList.remove('hidden');
        document.getElementById('photoUploadBtn').textContent = '📷 Cambiar foto';
      }
    }
  }
}

function previewPhoto(input) {
  if (input.files && input.files[0]) {
    pendingPhotoFile = input.files[0];
    const reader = new FileReader();
    reader.onload = e => {
      const preview = document.getElementById('svcPhotoPreview');
      preview.src = e.target.result;
      preview.classList.remove('hidden');
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function saveService() {
  const id = document.getElementById('serviceId').value;
  const name = document.getElementById('svcName').value.trim();
  const price = document.getElementById('svcPrice').value;
  if (!name || !price) return showToast('Nombre y precio son obligatorios', 'error');

  const body = {
    name,
    description: document.getElementById('svcDesc').value.trim(),
    price: Number(price),
    duration_minutes: Number(document.getElementById('svcDuration').value),
    active: Number(document.getElementById('svcActive').value),
    sort_order: Number(document.getElementById('svcOrder').value) || 0
  };

  const url = id ? `/api/admin/services/${id}` : '/api/admin/services';
  const method = id ? 'PUT' : 'POST';
  const res = await adminFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res) return;
  const data = await res.json();

  if (!data.success) return showToast(data.error || 'Error', 'error');

  const svcId = id || data.id;

  // Upload photo if pending
  if (pendingPhotoFile) {
    const fd = new FormData();
    fd.append('photo', pendingPhotoFile);
    await adminFetch(`/api/admin/services/${svcId}/photo`, { method: 'POST', body: fd });
    pendingPhotoFile = null;
  }

  closeServiceModal();
  await loadServices();
  loadServicesTable();
  showToast(id ? 'Servicio actualizado' : 'Servicio creado', 'success');
}

async function deleteService(id) {
  if (!confirm('¿Desactivar este servicio?')) return;
  const res = await adminFetch(`/api/admin/services/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) { await loadServices(); loadServicesTable(); showToast('Servicio desactivado', 'success'); }
}

function closeServiceModal() { document.getElementById('serviceModal').classList.add('hidden'); pendingPhotoFile = null; }
function closeServiceModalOnOverlay(e) { if (e.target === document.getElementById('serviceModal')) closeServiceModal(); }

// ===== AGENDA =====
function initWeek() {
  const today = new Date();
  today.setHours(0,0,0,0);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  currentWeekStart = monday;
}

function changeWeek(delta) {
  currentWeekStart = new Date(currentWeekStart);
  currentWeekStart.setDate(currentWeekStart.getDate() + delta * 7);
  loadAgenda();
}

function goToToday() { initWeek(); loadAgenda(); }

async function loadAgenda() {
  if (!currentWeekStart) return;
  const barberId = document.getElementById('agendaBarberId')?.value || '';
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const dateFrom = fmtDate(currentWeekStart);
  const dateTo = fmtDate(weekEnd);

  let bUrl = `/api/admin/bookings?date_from=${dateFrom}&date_to=${dateTo}`;
  if (barberId) bUrl += `&barber_id=${barberId}`;

  const [r1, r2, r3] = await Promise.all([
    adminFetch(bUrl),
    adminFetch(`/api/admin/blocked-days${barberId ? `?barber_id=${barberId}` : ''}`),
    adminFetch(`/api/admin/blocked-slots${barberId ? `?barber_id=${barberId}` : ''}`)
  ]);
  if (!r1 || !r2 || !r3) return;
  const [bookings, blockedDays, blockedSlots] = await Promise.all([r1.json(), r2.json(), r3.json()]);

  agendaBookings = bookings;
  agendaBlocked = blockedSlots;
  agendaBlockedDays = blockedDays;

  renderAgenda();
}

function renderAgenda() {
  const cal = document.getElementById('agendaCalendar');
  const settings = { open_time: '09:00', close_time: '20:00' };

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const today = new Date(); today.setHours(0,0,0,0);

  // Header label
  const firstStr = `${days[0].getDate()} ${MONTHS_ES[days[0].getMonth()].slice(0,3)}`;
  const lastStr = `${days[6].getDate()} ${MONTHS_ES[days[6].getMonth()].slice(0,3)} ${days[6].getFullYear()}`;
  document.getElementById('weekLabel').textContent = `${firstStr} – ${lastStr}`;

  // Build time rows from 09:00 to 20:00 in 15-min blocks
  const startMin = 9 * 60;
  const endMin = 20 * 60;
  const rowHeight = 20;

  let html = '<div class="ag-cell ag-header"></div>';
  days.forEach((d, i) => {
    const isToday = d.getTime() === today.getTime();
    const dateStr = fmtDate(d);
    const isDayBlocked = agendaBlockedDays.some(bd => bd.date === dateStr);
    html += `<div class="ag-cell ag-header ${isToday ? 'today-col' : ''}">
      <div>${DAYS_ES[d.getDay()]}</div>
      <div style="font-size:15px;font-weight:700">${d.getDate()}</div>
      ${isDayBlocked ? '<div style="font-size:9px;color:var(--red)">BLOQUEADO</div>' : ''}
    </div>`;
  });

  // Time rows
  for (let t = startMin; t < endMin; t += 15) {
    const timeStr = `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
    html += `<div class="ag-cell ag-time">${timeStr}</div>`;

    days.forEach(d => {
      const dateStr = fmtDate(d);
      const isDayBlocked = agendaBlockedDays.some(bd => bd.date === dateStr);
      const isSlotBlocked = agendaBlocked.some(s => s.date === dateStr && timeToMins(s.time_start) <= t && t < timeToMins(s.time_end));
      const isPast = d < today;

      // Find bookings that START at this slot
      const slotBookings = agendaBookings.filter(b => b.date === dateStr && timeToMins(b.time_start) === t && b.status !== 'cancelled');

      let cellClass = 'ag-slot';
      if (isDayBlocked || isSlotBlocked) cellClass += ' blocked';
      if (isPast) cellClass += ' closed';

      let cellContent = '';
      slotBookings.forEach(b => {
        const dur = timeToMins(b.time_end) - timeToMins(b.time_start);
        const heightPx = (dur / 15) * rowHeight - 2;
        const color = b.barber_color || '#c8a96e';
        cellContent += `<div class="ag-booking" style="background:${color};height:${heightPx}px;top:2px"
          onclick="openBookingDetail(${b.id})" title="${b.client_name} · ${b.service_name}">
          ${b.time_start} ${b.client_name} (${b.service_name})
        </div>`;
      });

      html += `<div class="ag-cell ${cellClass}" style="position:relative;height:${rowHeight}px">${cellContent}</div>`;
    });
  }

  cal.innerHTML = html;
}

// ===== NEW BOOKING =====
function populateNbSelects() {
  const activeBarbers = allBarbers.filter(b => b.active);
  document.getElementById('nbBarber').innerHTML =
    '<option value="">Selecciona barbero</option>' +
    activeBarbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

  const activeServices = allServices.filter(s => s.active);
  document.getElementById('nbService').innerHTML =
    '<option value="">Selecciona servicio</option>' +
    activeServices.map(s => `<option value="${s.id}">${s.name} (${s.duration_minutes}min · ${s.price}€)</option>`).join('');

  // Set today as default date
  document.getElementById('nbDate').value = fmtDate(new Date());
}

async function loadNbAvailability() {
  const barberId = document.getElementById('nbBarber').value;
  const serviceId = document.getElementById('nbService').value;
  const date = document.getElementById('nbDate').value;
  const timeSelect = document.getElementById('nbTime');

  if (!barberId || !serviceId || !date) {
    timeSelect.innerHTML = '<option value="">Selecciona barbero, servicio y fecha</option>';
    return;
  }

  const service = allServices.find(s => s.id === Number(serviceId));
  if (!service) return;

  timeSelect.innerHTML = '<option value="">Cargando...</option>';
  const res = await fetch(`/api/availability?barber_id=${barberId}&date=${date}&duration=${service.duration_minutes}`);
  const data = await res.json();

  if (!data.available || !data.available.length) {
    timeSelect.innerHTML = '<option value="">Sin disponibilidad</option>';
    return;
  }

  timeSelect.innerHTML = '<option value="">Selecciona hora</option>' +
    data.available.map(t => `<option value="${t}">${t}</option>`).join('');
}

async function submitLocalBooking() {
  const result = document.getElementById('nbResult');
  result.className = 'nb-result hidden';

  const body = {
    barber_id: document.getElementById('nbBarber').value,
    service_id: document.getElementById('nbService').value,
    date: document.getElementById('nbDate').value,
    time_start: document.getElementById('nbTime').value,
    client_name: document.getElementById('nbName').value.trim() || 'Cliente local',
    client_email: document.getElementById('nbEmail').value.trim(),
    client_phone: document.getElementById('nbPhone').value.trim(),
    notes: document.getElementById('nbNotes').value.trim()
  };

  if (!body.barber_id || !body.service_id || !body.date || !body.time_start) {
    result.textContent = 'Completa todos los campos obligatorios';
    result.className = 'nb-result error';
    return;
  }

  const res = await adminFetch('/api/admin/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (data.success) {
    result.textContent = `✓ Cita creada: ${body.date} de ${body.time_start} a ${data.time_end}`;
    result.className = 'nb-result success';
    loadNbAvailability();
    showToast('Cita creada con éxito', 'success');
  } else {
    result.textContent = data.error || 'Error al crear la cita';
    result.className = 'nb-result error';
  }
}

// ===== BOOKING DETAIL =====
async function openBookingDetail(id) {
  const b = agendaBookings.find(x => x.id === id);
  if (!b) return;

  const statusLabels = { confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Completada', no_show: 'No presentado' };
  const statusClass = { confirmed: 'status-confirmed', cancelled: 'status-cancelled', completed: 'status-completed', no_show: 'status-cancelled' };

  document.getElementById('bookingDetailContent').innerHTML = `
    <div class="booking-detail-row"><span class="bd-label">Cliente</span><span class="bd-value">${b.client_name}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Email</span><span class="bd-value">${b.client_email || '—'}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Teléfono</span><span class="bd-value">${b.client_phone || '—'}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Barbero</span><span class="bd-value">${b.barber_name}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Servicio</span><span class="bd-value">${b.service_name}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Fecha</span><span class="bd-value">${b.date}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Hora</span><span class="bd-value">${b.time_start} – ${b.time_end}</span></div>
    <div class="booking-detail-row"><span class="bd-label">Precio</span><span class="bd-value" style="color:var(--gold)">${b.price}€</span></div>
    <div class="booking-detail-row"><span class="bd-label">Estado</span><span class="bd-value ${statusClass[b.status]}">${statusLabels[b.status]}</span></div>
    ${b.notes ? `<div class="booking-detail-row"><span class="bd-label">Notas</span><span class="bd-value">${b.notes}</span></div>` : ''}
    <div class="booking-detail-row"><span class="bd-label">Creada</span><span class="bd-value" style="color:var(--grey);font-size:12px">${b.created_at}</span></div>
  `;

  document.getElementById('bookingDetailActions').innerHTML = `
    ${b.status === 'confirmed' ? `
      <button class="btn-sm btn-edit" onclick="updateBookingStatus(${b.id},'completed')">Marcar completada</button>
      <button class="btn-sm btn-delete" onclick="updateBookingStatus(${b.id},'cancelled')">Cancelar cita</button>
      <button class="btn-sm" style="background:#7a0010;color:#fff;border:none" onclick="markNoShow(${b.id}, false)">No presentado</button>
      <button class="btn-sm" style="background:#3a0006;color:#fff;border:none" onclick="markNoShow(${b.id}, true)">No presentado + Bloquear</button>
    ` : ''}
    <button class="btn-secondary" onclick="closeBookingDetail()">Cerrar</button>
  `;

  document.getElementById('bookingDetailModal').classList.remove('hidden');
}

async function updateBookingStatus(id, status) {
  const res = await adminFetch(`/api/admin/bookings/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  const data = await res.json();
  if (data.success) {
    closeBookingDetail();
    loadAgenda();
    showToast('Estado actualizado', 'success');
  }
}

function closeBookingDetail() { document.getElementById('bookingDetailModal').classList.add('hidden'); }
function closeBookingDetailOnOverlay(e) { if (e.target === document.getElementById('bookingDetailModal')) closeBookingDetail(); }

async function markNoShow(id, blacklist) {
  const msg = blacklist ? '¿Marcar como no presentado y bloquear este contacto?' : '¿Marcar como no presentado?';
  if (!confirm(msg)) return;
  const res = await adminFetch(`/api/admin/bookings/${id}/noshow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blacklist })
  });
  if (!res) return;
  const data = await res.json();
  if (data.success) {
    closeBookingDetail();
    loadAgenda();
    showToast(blacklist ? 'Marcado y contacto bloqueado' : 'Marcado como no presentado', 'success');
  }
}

// ===== BLOCKED =====
async function loadBlocked() {
  const [r1, r2] = await Promise.all([
    adminFetch('/api/admin/blocked-days'),
    adminFetch('/api/admin/blocked-slots')
  ]);
  if (!r1 || !r2) return;
  const [days, slots] = await Promise.all([r1.json(), r2.json()]);
  loadBlacklist();

  const daysList = document.getElementById('blockedDaysList');
  daysList.innerHTML = days.length ? days.map(d => {
    const barber = allBarbers.find(b => b.id === d.barber_id);
    return `<div class="blocked-item">
      <div class="blocked-item-info">
        <div class="blocked-item-date">${d.date} · ${barber?.name || '?'}</div>
        ${d.reason ? `<div class="blocked-item-reason">${d.reason}</div>` : ''}
      </div>
      <button class="btn-sm btn-delete" onclick="unblockDay(${d.id})">✕</button>
    </div>`;
  }).join('') : '<p style="color:var(--grey);font-size:12px">Sin días bloqueados</p>';

  const slotsList = document.getElementById('blockedSlotsList');
  slotsList.innerHTML = slots.length ? slots.map(s => {
    const barber = allBarbers.find(b => b.id === s.barber_id);
    return `<div class="blocked-item">
      <div class="blocked-item-info">
        <div class="blocked-item-date">${s.date} · ${barber?.name || '?'}</div>
        <div class="blocked-item-detail">${s.time_start} – ${s.time_end}</div>
        ${s.reason ? `<div class="blocked-item-reason">${s.reason}</div>` : ''}
      </div>
      <button class="btn-sm btn-delete" onclick="unblockSlot(${s.id})">✕</button>
    </div>`;
  }).join('') : '<p style="color:var(--grey);font-size:12px">Sin horas bloqueadas</p>';
}

async function blockDay() {
  const barber_id = document.getElementById('bdBarber').value;
  const date = document.getElementById('bdDate').value;
  const reason = document.getElementById('bdReason').value;
  if (!barber_id || !date) return showToast('Selecciona barbero y fecha', 'error');

  const res = await adminFetch('/api/admin/blocked-days', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barber_id, date, reason })
  });
  if (!res) return;
  const data = await res.json();
  if (data.success) { loadBlocked(); showToast('Día bloqueado', 'success'); document.getElementById('bdDate').value = ''; }
  else showToast(data.error || 'Error', 'error');
}

async function unblockDay(id) {
  await adminFetch(`/api/admin/blocked-days/${id}`, { method: 'DELETE' });
  loadBlocked();
  showToast('Día desbloqueado', 'success');
}

async function blockSlot() {
  const barber_id = document.getElementById('bsBarber').value;
  const date = document.getElementById('bsDate').value;
  const time_start = document.getElementById('bsStart').value;
  const time_end = document.getElementById('bsEnd').value;
  const reason = document.getElementById('bsReason').value;
  if (!barber_id || !date || !time_start || !time_end) return showToast('Rellena todos los campos', 'error');
  if (time_start >= time_end) return showToast('La hora de fin debe ser posterior a la de inicio', 'error');

  const res = await adminFetch('/api/admin/blocked-slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barber_id, date, time_start, time_end, reason })
  });
  if (!res) return;
  const data = await res.json();
  if (data.success) { loadBlocked(); showToast('Horas bloqueadas', 'success'); document.getElementById('bsDate').value = ''; }
  else showToast(data.error || 'Error', 'error');
}

async function unblockSlot(id) {
  await adminFetch(`/api/admin/blocked-slots/${id}`, { method: 'DELETE' });
  loadBlocked();
  showToast('Bloqueo eliminado', 'success');
}

async function loadBlacklist() {
  const res = await adminFetch('/api/admin/blacklist');
  if (!res) return;
  const list = await res.json();
  const container = document.getElementById('blacklistContainer');
  if (!list.length) {
    container.innerHTML = '<p style="color:var(--grey);font-size:12px">Sin contactos bloqueados</p>';
    return;
  }
  container.innerHTML = list.map(b => `
    <div class="blocked-item">
      <div class="blocked-item-info">
        <div class="blocked-item-date" style="color:var(--red)">${b.client_name || 'Sin nombre'}</div>
        <div class="blocked-item-detail">${b.phone ? '📞 ' + b.phone : ''}${b.phone && b.email ? ' · ' : ''}${b.email ? '✉ ' + b.email : ''}</div>
        ${b.reason ? `<div class="blocked-item-reason">${b.reason}</div>` : ''}
      </div>
      <button class="btn-sm btn-edit" onclick="unblockContact(${b.id})">Desbloquear</button>
    </div>
  `).join('');
}

async function unblockContact(id) {
  if (!confirm('¿Desbloquear este contacto?')) return;
  await adminFetch(`/api/admin/blacklist/${id}`, { method: 'DELETE' });
  loadBlacklist();
  showToast('Contacto desbloqueado', 'success');
}

// ===== SETTINGS =====
async function loadSettings() {
  const res = await adminFetch('/api/admin/settings');
  if (!res) return;
  const s = await res.json();

  document.getElementById('setName').value = s.shop_name || '';
  document.getElementById('setTagline').value = s.shop_tagline || '';
  document.getElementById('setAddress').value = s.shop_address || '';
  document.getElementById('setPhone').value = s.shop_phone || '';
  document.getElementById('setEmail').value = s.shop_email || '';
  document.getElementById('setInstagram').value = s.instagram_url || '';
  document.getElementById('setMapsUrl').value = s.google_maps_url || '';
  document.getElementById('setOpenTime').value = s.open_time || '09:00';
  document.getElementById('setCloseTime').value = s.close_time || '20:00';
  document.getElementById('setLegal').value = s.legal_text || '';

  const openDays = (s.open_days || '1,2,3,4,5,6').split(',').map(Number);
  const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  document.getElementById('daysCheckboxes').innerHTML = [0,1,2,3,4,5,6].map(i => `
    <label class="day-check-label">
      <input type="checkbox" name="day" value="${i}" ${openDays.includes(i) ? 'checked' : ''}>
      ${dayNames[i]}
    </label>
  `).join('');
}

async function saveSettings() {
  const openDays = [...document.querySelectorAll('[name="day"]:checked')].map(c => c.value).join(',');
  const newPass = document.getElementById('setNewPass').value;
  const newPass2 = document.getElementById('setNewPass2').value;

  if (newPass && newPass !== newPass2) return showToast('Las contraseñas no coinciden', 'error');
  if (newPass && newPass.length < 6) return showToast('La contraseña debe tener al menos 6 caracteres', 'error');

  const body = {
    shop_name: document.getElementById('setName').value.trim(),
    shop_tagline: document.getElementById('setTagline').value.trim(),
    shop_address: document.getElementById('setAddress').value.trim(),
    shop_phone: document.getElementById('setPhone').value.trim(),
    shop_email: document.getElementById('setEmail').value.trim(),
    open_time: document.getElementById('setOpenTime').value,
    close_time: document.getElementById('setCloseTime').value,
    open_days: openDays,
    legal_text: document.getElementById('setLegal').value,
    instagram_url: document.getElementById('setInstagram').value.trim(),
    google_maps_url: document.getElementById('setMapsUrl').value.trim()
  };
  if (newPass) body.new_password = newPass;

  const res = await adminFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res) return;
  const data = await res.json();
  if (data.success) {
    showToast('Ajustes guardados', 'success');
    document.getElementById('settingsResult').textContent = '✓ Guardado correctamente';
    document.getElementById('settingsResult').className = 'nb-result success';
    document.getElementById('setNewPass').value = '';
    document.getElementById('setNewPass2').value = '';
    setTimeout(() => document.getElementById('settingsResult').classList.add('hidden'), 3000);
  } else showToast(data.error || 'Error', 'error');
}

// ===== UTILS =====
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

document.addEventListener('DOMContentLoaded', init);

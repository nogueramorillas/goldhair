let staffRange = 'today';

const DAYS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS_ES[dt.getDay()]} ${d} de ${MONTHS_ES[m - 1]}`;
}

async function staffFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    document.getElementById('staffDashboard').classList.add('hidden');
    document.getElementById('staffLoginScreen').classList.remove('hidden');
    return null;
  }
  return res;
}

async function doStaffLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('staffLoginError');
  errEl.classList.add('hidden');

  const username = document.getElementById('staffLoginUser').value.trim();
  const password = document.getElementById('staffLoginPass').value;

  const res = await fetch('/api/staff/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();

  if (data.success) {
    showStaffDashboard();
  } else {
    errEl.textContent = data.error || 'Error al iniciar sesión';
    errEl.classList.remove('hidden');
  }
}

async function doStaffLogout() {
  await fetch('/api/staff/logout', { method: 'POST' });
  location.reload();
}

async function showStaffDashboard() {
  document.getElementById('staffLoginScreen').classList.add('hidden');
  document.getElementById('staffDashboard').classList.remove('hidden');

  const me = await staffFetch('/api/staff/me');
  if (!me) return;
  const barber = await me.json();

  document.getElementById('staffName').textContent = barber.name;
  document.getElementById('staffAvatar').innerHTML = barber.photo_url
    ? `<img src="${barber.photo_url}" alt="${barber.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<span style="color:${barber.color}">✂</span>`;
  document.getElementById('staffAvatar').style.background = `${barber.color}22`;
  document.getElementById('staffAvatar').style.border = `2px solid ${barber.color}`;

  await loadStaffSchedule();
}

function setStaffRange(range, el) {
  staffRange = range;
  document.querySelectorAll('.staff-range-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadStaffSchedule();
}

async function loadStaffSchedule() {
  const list = document.getElementById('staffScheduleList');
  list.innerHTML = '<p class="staff-empty">Cargando...</p>';

  const today = new Date();
  const dateFrom = fmtDate(today);
  let dateTo = dateFrom;
  if (staffRange === 'week') {
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - today.getDay()));
    dateTo = fmtDate(end);
  } else if (staffRange === 'upcoming') {
    const end = new Date(today);
    end.setDate(end.getDate() + 15);
    dateTo = fmtDate(end);
  }

  const res = await staffFetch(`/api/staff/bookings?date_from=${dateFrom}&date_to=${dateTo}`);
  if (!res) return;
  const bookings = await res.json();

  if (!bookings.length) {
    list.innerHTML = '<p class="staff-empty">No tienes citas en este período</p>';
    return;
  }

  const byDate = {};
  bookings.forEach(b => {
    if (!byDate[b.date]) byDate[b.date] = [];
    byDate[b.date].push(b);
  });

  list.innerHTML = Object.keys(byDate).sort().map(date => `
    <div class="staff-day-group">
      <h3 class="staff-day-title">${formatDateLong(date)}</h3>
      ${byDate[date].map(b => `
        <div class="staff-booking-item">
          <div class="staff-booking-time">${b.time_start}<span>${b.time_end}</span></div>
          <div class="staff-booking-info">
            <div class="staff-booking-client">${b.client_name}</div>
            <div class="staff-booking-service">${b.service_name}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/staff/check');
  const data = await res.json();
  if (data.loggedIn) showStaffDashboard();
});

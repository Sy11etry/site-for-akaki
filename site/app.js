const API_BASE = 'https://corei5.tail3a8354.ts.net';

const DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

let weekStart = getMonday(new Date());
let selectedDate = null;
let selectedTime = null;

const bookBtn = document.getElementById('bookBtn');
const calendarModal = document.getElementById('calendarModal');
const closeModal = document.getElementById('closeModal');
const prevWeek = document.getElementById('prevWeek');
const nextWeek = document.getElementById('nextWeek');
const weekLabel = document.getElementById('weekLabel');
const daysRow = document.getElementById('daysRow');
const timesGrid = document.getElementById('timesGrid');
const timeTitle = document.getElementById('timeTitle');
const confirmBtn = document.getElementById('confirmBtn');
const nameInput = document.getElementById('nameInput');
const contactInput = document.getElementById('contactInput');

// The API lives on a home server, so the first connection can be slow to
// establish. Give it a bounded wait and one retry instead of hanging.
async function apiFetch(path, options = {}, attempt = 0) {
    try {
          return await fetch(`${API_BASE}${path}`, { ...options, signal: AbortSignal.timeout(8000) });
    } catch (err) {
          if (attempt === 0) return apiFetch(path, options, 1);
          throw err;
    }
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderWeek() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  weekLabel.textContent = sameMonth
  ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS[weekStart.getMonth()]}`
    : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()]} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]}`;

daysRow.innerHTML = '';

for (let i = 0; i < 7; i++) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + i);

  const btn = document.createElement('button');
  btn.className = 'day-cell';
  if (isSameDay(d, today)) btn.classList.add('today');
  if (selectedDate && isSameDay(d, selectedDate)) btn.classList.add('selected');

  if (d < today) btn.disabled = true;

  btn.innerHTML = `<span class="dow">${DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span>`;
  btn.addEventListener('click', () => {
    selectedDate = d;
    selectedTime = null;
    renderWeek();
    renderTimes();
    updateConfirm();
  });

  daysRow.appendChild(btn);
}
}

async function renderTimes() {
  timesGrid.innerHTML = '';

if (!selectedDate) {
  timeTitle.textContent = 'Свободное время';
  timesGrid.innerHTML = '<div class="empty-times">Сначала выберите день</div>';
  return;
}

const dateStr = fmtDate(selectedDate);
  const dateLabel = selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  timeTitle.textContent = `Свободное время — ${dateLabel}`;
  timesGrid.innerHTML = '<div class="empty-times">Загрузка…</div>';

let slots;
  try {
    const res = await apiFetch(`/api/slots?date=${dateStr}`);
    if (!res.ok) throw new Error('bad response');
    slots = (await res.json()).slots;
  } catch {
    timesGrid.innerHTML = '<div class="empty-times">Не удалось загрузить расписание</div>';
    return;
  }

const freeHours = slots.filter((s) => s.free).map((s) => s.hour);

timesGrid.innerHTML = '';

if (freeHours.length === 0) {
  timesGrid.innerHTML = '<div class="empty-times">Нет свободных слотов</div>';
  return;
}

freeHours.forEach((h) => {
  const btn = document.createElement('button');
  btn.className = 'time-slot';
  if (selectedTime === h) btn.classList.add('selected');
  btn.textContent = `${String(h).padStart(2, '0')}:00`;
  btn.addEventListener('click', () => {
    selectedTime = h;
    renderTimes();
    updateConfirm();
  });
  timesGrid.appendChild(btn);
});
}

function updateConfirm() {
  confirmBtn.disabled = !(selectedDate && selectedTime !== null && nameInput.value.trim() && contactInput.value.trim());
}

nameInput.addEventListener('input', updateConfirm);
contactInput.addEventListener('input', updateConfirm);

function openModal() {
  calendarModal.classList.add('open');
  renderWeek();
  renderTimes();
  updateConfirm();
}

function closeModalFn() {
  calendarModal.classList.remove('open');
}

bookBtn.addEventListener('click', openModal);
closeModal.addEventListener('click', closeModalFn);
calendarModal.addEventListener('click', (e) => {
  if (e.target === calendarModal) closeModalFn();
});

prevWeek.addEventListener('click', () => {
  weekStart.setDate(weekStart.getDate() - 7);
  renderWeek();
});

nextWeek.addEventListener('click', () => {
  weekStart.setDate(weekStart.getDate() + 7);
  renderWeek();
});

confirmBtn.addEventListener('click', async () => {
  if (!selectedDate || selectedTime === null) return;
  const name = nameInput.value.trim();
  const contact = contactInput.value.trim();
  if (!name || !contact) return;

                            confirmBtn.disabled = true;
  confirmBtn.textContent = 'Записываем…';

                            const dateStr = fmtDate(selectedDate);

                            let res;
  try {
    res = await apiFetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, hour: selectedTime, name, contact }),
    });
  } catch {
    confirmBtn.textContent = 'Подтвердить запись';
    updateConfirm();
    alert('Не удалось связаться с сервером. Попробуйте ещё раз или напишите в чат.');
    return;
  }

                            confirmBtn.textContent = 'Подтвердить запись';

                            if (res.status === 409) {
                              alert('Извините, это время уже заняли. Выберите другое.');
                              selectedTime = null;
                              renderTimes();
                              updateConfirm();
                              return;
                            }

                            if (!res.ok) {
                              updateConfirm();
                              alert('Не удалось создать запись. Попробуйте ещё раз или напишите в чат.');
                              return;
                            }

                            const dateLabel = selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  alert(`Готово! Вы записаны на ${dateLabel} в ${String(selectedTime).padStart(2, '0')}:00`);
  closeModalFn();
  selectedDate = null;
  selectedTime = null;
  nameInput.value = '';
  contactInput.value = '';
});

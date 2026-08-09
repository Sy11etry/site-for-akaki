const SUPABASE_URL = 'https://qcawrntvxxedibbfqwyo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjYXdybnR2eHhlZGliYmZxd3lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzE1MTksImV4cCI6MjEwMTg0NzUxOX0.Xb20oUByKJdpeAPtQMP8IdYL9MoIoEzCmM6ShUANJW0';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HOURS = Array.from({ length: 14 }, (_, i) => 9 + i); // 9..22

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
  return d.toISOString().slice(0, 10);
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

    const isPast = d < today;
    if (isPast) btn.disabled = true;

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

  const { data, error } = await sb
    .from('schedule')
    .select('hour, status')
    .eq('date', dateStr);

  if (error) {
    timesGrid.innerHTML = '<div class="empty-times">Ошибка загрузки</div>';
    return;
  }

  const busyHours = new Set(
    data.filter(r => r.status === 'busy' || r.status === 'booked').map(r => r.hour)
  );
  const freeHours = HOURS.filter(h => !busyHours.has(h));

  timesGrid.innerHTML = '';

  if (freeHours.length === 0) {
    timesGrid.innerHTML = '<div class="empty-times">Нет свободных слотов</div>';
    return;
  }

  freeHours.forEach(h => {
    const label = `${String(h).padStart(2, '0')}:00`;
    const btn = document.createElement('button');
    btn.className = 'time-slot';
    if (selectedTime === h) btn.classList.add('selected');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      selectedTime = h;
      renderTimes();
      updateConfirm();
    });
    timesGrid.appendChild(btn);
  });
}

function updateConfirm() {
  const nameOk = nameInput.value.trim().length > 0;
  confirmBtn.disabled = !(selectedDate && selectedTime !== null && nameOk);
}

nameInput.addEventListener('input', updateConfirm);

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
  if (!name) return;

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Записываем…';

  const dateStr = fmtDate(selectedDate);

  // Проверяем, что слот всё ещё свободен, перед записью
  const { data: existing } = await sb
    .from('schedule')
    .select('status')
    .eq('date', dateStr)
    .eq('hour', selectedTime)
    .maybeSingle();

  if (existing && (existing.status === 'busy' || existing.status === 'booked')) {
    alert('Извините, это время уже занято. Выберите другое.');
    confirmBtn.textContent = 'Подтвердить запись';
    selectedTime = null;
    renderTimes();
    updateConfirm();
    return;
  }

  const { error } = await sb
    .from('schedule')
    .upsert(
      { date: dateStr, hour: selectedTime, status: 'booked', client_name: name, updated_at: new Date().toISOString() },
      { onConflict: 'date,hour' }
    );

  confirmBtn.textContent = 'Подтвердить запись';

  if (error) {
    alert('Не удалось создать запись. Попробуйте ещё раз или напишите в чат.');
    return;
  }

  const dateLabel = selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  alert(`Готово! Вы записаны на ${dateLabel} в ${String(selectedTime).padStart(2, '0')}:00`);
  closeModalFn();
  selectedDate = null;
  selectedTime = null;
  nameInput.value = '';
});

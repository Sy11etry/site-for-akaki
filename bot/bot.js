require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HOURS = Array.from({ length: 14 }, (_, i) => 9 + i); // 9..22
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function fmtDayLabel(d) {
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

bot.start((ctx) => sendWeek(ctx, getMonday(new Date())));
bot.command('week', (ctx) => sendWeek(ctx, getMonday(new Date())));

bot.command('clear', (ctx) => {
  return ctx.reply(
    'Точно снести всё расписание? Это удалит все отметки и записи клиентов без возможности отмены.',
    Markup.inlineKeyboard([
      [Markup.button.callback('Да, снести всё', 'clear:confirm')],
      [Markup.button.callback('Отмена', 'clear:cancel')],
    ])
  );
});

bot.action('clear:confirm', async (ctx) => {
  await ctx.answerCbQuery();
  const { error } = await supabase.from('schedule').delete().gte('id', 0);
  if (error) {
    await ctx.editMessageText('Не получилось очистить: ' + error.message);
    return;
  }
  await ctx.editMessageText('Расписание снесено. Все слоты снова свободны.');
});

bot.action('clear:cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('Отменено, ничего не тронул.');
});

function weekKeyboard(monday) {
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    rows.push([Markup.button.callback(fmtDayLabel(d), `day:${fmtDate(d)}`)]);
  }
  rows.push([
    Markup.button.callback('« Пред. неделя', `nav:${fmtDate(monday)}:-7`),
    Markup.button.callback('След. неделя »', `nav:${fmtDate(monday)}:7`),
  ]);
  return Markup.inlineKeyboard(rows);
}

async function sendWeek(ctx, monday, edit = false) {
  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const text = `Расписание: ${fmtDayLabel(monday)} — ${fmtDayLabel(weekEnd)}\n\nЧто смотрим?`;
  const kb = weekKeyboard(monday);
  if (edit) {
    await ctx.editMessageText(text, kb);
  } else {
    await ctx.reply(text, kb);
  }
}

async function getDaySlots(dateStr) {
  const { data, error } = await supabase
    .from('schedule')
    .select('hour, status, client_name')
    .eq('date', dateStr);
  if (error) throw error;
  const map = {};
  for (const row of data) map[row.hour] = row;
  return map;
}

function statusIcon(status) {
  if (status === 'busy') return '❌';
  if (status === 'booked') return '👤';
  return '✅';
}

async function dayKeyboard(dateStr) {
  const slots = await getDaySlots(dateStr);
  const rows = [];
  for (const h of HOURS) {
    const slot = slots[h];
    const status = slot ? slot.status : 'free';
    const label = status === 'booked' && slot.client_name
      ? `${h}:00 👤 ${slot.client_name}`
      : `${h}:00 ${statusIcon(status)}`;
    rows.push([Markup.button.callback(label, `h:${dateStr}:${h}`)]);
  }
  rows.push([Markup.button.callback('« Назад', `back:${dateStr}`)]);
  return Markup.inlineKeyboard(rows);
}

async function sendDay(ctx, dateStr, edit = false) {
  const d = new Date(dateStr + 'T00:00:00');
  const text = `${fmtDayLabel(d)}\n\n✅ свободно · ❌ занято · 👤 записан\n\nТыкаем час:`;
  const kb = await dayKeyboard(dateStr);
  if (edit) {
    await ctx.editMessageText(text, kb);
  } else {
    await ctx.reply(text, kb);
  }
}

bot.action(/^day:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await sendDay(ctx, ctx.match[1], true);
});

bot.action(/^back:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const d = new Date(ctx.match[1] + 'T00:00:00');
  await sendWeek(ctx, getMonday(d), true);
});

bot.action(/^nav:(.+):(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const d = new Date(ctx.match[1] + 'T00:00:00');
  d.setDate(d.getDate() + parseInt(ctx.match[2], 10));
  await sendWeek(ctx, getMonday(d), true);
});

bot.action(/^h:(.+):(\d+)$/, async (ctx) => {
  const dateStr = ctx.match[1];
  const hour = parseInt(ctx.match[2], 10);

  const { data: existing } = await supabase
    .from('schedule')
    .select('status')
    .eq('date', dateStr)
    .eq('hour', hour)
    .maybeSingle();

  const current = existing ? existing.status : 'free';

  if (current === 'booked') {
    await ctx.answerCbQuery('Слот занят. Свободи если надо.', { show_alert: true });
    return;
  }

  const next = current === 'free' ? 'busy' : 'free';

  await supabase
    .from('schedule')
    .upsert({ date: dateStr, hour, status: next, client_name: null, updated_at: new Date().toISOString() }, { onConflict: 'date,hour' });

  await ctx.answerCbQuery(next === 'busy' ? '❌ занято' : '✅ свободно');
  await sendDay(ctx, dateStr, true);
});

bot.launch();
console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

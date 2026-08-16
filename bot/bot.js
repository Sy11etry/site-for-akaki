require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { openDb, HOURS } = require('../api/db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = openDb();

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
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  db.prepare('delete from schedule').run();
  await ctx.editMessageText('Расписание снесено. Все слоты снова закрыты.');
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

function getDaySlots(dateStr) {
  const rows = db.prepare('select hour, status, client_name, client_contact from schedule where date = ?').all(dateStr);
  const map = {};
  for (const row of rows) map[row.hour] = row;
  return map;
}

function statusIcon(status) {
  if (status === 'free') return '✅';
  if (status === 'booked') return '👤';
  return '❌';
}

function dayKeyboard(dateStr) {
  const slots = getDaySlots(dateStr);
  const rows = [];
  for (const h of HOURS) {
    const slot = slots[h];
    // No row means the hour was never opened, so it stays closed.
    const status = slot ? slot.status : 'busy';
    const label = status === 'booked' && slot.client_name
      ? `${h}:00 👤 ${slot.client_name}${slot.client_contact ? ` (${slot.client_contact})` : ''}`
      : `${h}:00 ${statusIcon(status)}`;
    rows.push([Markup.button.callback(label, `h:${dateStr}:${h}`)]);
  }
  rows.push([Markup.button.callback('« Назад', `back:${dateStr}`)]);
  return Markup.inlineKeyboard(rows);
}

async function sendDay(ctx, dateStr, edit = false) {
  const d = new Date(dateStr + 'T00:00:00');
  const text = `${fmtDayLabel(d)}\n\n✅ свободно · ❌ занято · 👤 записан\n\nТыкаем час:`;
  const kb = dayKeyboard(dateStr);
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

  const existing = db.prepare('select status, client_name from schedule where date = ? and hour = ?').get(dateStr, hour);
  const current = existing ? existing.status : 'busy';

  if (current === 'booked') {
    const who = existing.client_name || 'клиент';
    db.prepare("update schedule set status = 'free', client_name = null, updated_at = ? where date = ? and hour = ?")
      .run(new Date().toISOString(), dateStr, hour);
    await ctx.answerCbQuery(`Запись отменена (${who}), слот снова свободен`, { show_alert: true });
    await sendDay(ctx, dateStr, true);
    return;
  }

  const next = current === 'busy' ? 'free' : 'busy';

  db.prepare(`
    insert into schedule (date, hour, status, client_name, updated_at)
    values (?, ?, ?, null, ?)
    on conflict(date, hour) do update set status = excluded.status, client_name = null, updated_at = excluded.updated_at
  `).run(dateStr, hour, next, new Date().toISOString());

  await ctx.answerCbQuery(next === 'free' ? '✅ свободно' : '❌ занято');
  await sendDay(ctx, dateStr, true);
});

bot.catch((err, ctx) => {
  console.error('Bot error for update', ctx.update.update_id, err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

bot.launch();
console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { openDb, HOURS } = require('../api/db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = openDb();

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
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  db.prepare('delete from schedule').run();
  await ctx.editMessageText('Расписание снесено. Все слоты снова закрыты.');
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

function getDaySlots(dateStr) {
  const rows = db.prepare('select hour, status, client_name from schedule where date = ?').all(dateStr);
  const map = {};
  for (const row of rows) map[row.hour] = row;
  return map;
}

function statusIcon(status) {
  if (status === 'free') return '✅';
  if (status === 'booked') return '👤';
  return '❌';
}

function dayKeyboard(dateStr) {
  const slots = getDaySlots(dateStr);
  const rows = [];
  for (const h of HOURS) {
    const slot = slots[h];
    // No row means the hour was never opened, so it stays closed.
    const status = slot ? slot.status : 'busy';
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
  const kb = dayKeyboard(dateStr);
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

  const existing = db.prepare('select status, client_name from schedule where date = ? and hour = ?').get(dateStr, hour);
  const current = existing ? existing.status : 'busy';

  if (current === 'booked') {
    const who = existing.client_name || 'клиент';
    db.prepare("update schedule set status = 'free', client_name = null, updated_at = ? where date = ? and hour = ?")
      .run(new Date().toISOString(), dateStr, hour);
    await ctx.answerCbQuery(`Запись отменена (${who}), слот снова свободен`, { show_alert: true });
    await sendDay(ctx, dateStr, true);
    return;
  }

  const next = current === 'busy' ? 'free' : 'busy';

  db.prepare(`
    insert into schedule (date, hour, status, client_name, updated_at)
    values (?, ?, ?, null, ?)
    on conflict(date, hour) do update set status = excluded.status, client_name = null, updated_at = excluded.updated_at
  `).run(dateStr, hour, next, new Date().toISOString());

  await ctx.answerCbQuery(next === 'free' ? '✅ свободно' : '❌ занято');
  await sendDay(ctx, dateStr, true);
});

bot.catch((err, ctx) => {
  console.error('Bot error for update', ctx.update.update_id, err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

bot.launch();
console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

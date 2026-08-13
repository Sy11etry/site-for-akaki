const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Lessons run on the hour, 9:00–22:00.
const HOURS = Array.from({ length: 14 }, (_, i) => 9 + i);

const DB_PATH = process.env.SCHEDULE_DB || path.join(__dirname, 'data', 'schedule.db');

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // WAL lets the bot and the API touch the same file concurrently.
  db.exec('pragma journal_mode = WAL');
  db.exec(`
    create table if not exists schedule (
      date text not null,
      hour integer not null,
      status text not null check (status in ('free', 'busy', 'booked')),
      client_name text,
      updated_at text not null,
      primary key (date, hour)
    )
  `);
  return db;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidHour(value) {
  return Number.isInteger(value) && HOURS.includes(value);
}

module.exports = { openDb, HOURS, DB_PATH, isValidDate, isValidHour };

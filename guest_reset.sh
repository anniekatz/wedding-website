#!/usr/bin/env bash
#
# guest_reset.sh — wipe all guest/RSVP data in wedding.db and reload it from CSVs.
# you can also add/modify guests/hosueholds from admin dashboard !
#
# CSV rules:
#   - First row is header. columns must be a subset of the table's columns. 
#   - households.csv needs at least id, invite_code, name; guests.csv needs household_id, first_name, last_name.
#   - guests.csv household_id must match an id in households.csv.

set -euo pipefail
cd "$(dirname "$0")"

DB_FILE="wedding.db"
HOUSEHOLDS_CSV="households.csv"
GUESTS_CSV="guests.csv"

die() { echo "guest_reset: $*" >&2; exit 1; }

ASSUME_YES=0
case "${1:-}" in
  -y|--yes) ASSUME_YES=1 ;;
  -h|--help) echo "Usage: ./guest_reset.sh [-y]"
             echo "Resets rsvp/guest/household data in $DB_FILE from $HOUSEHOLDS_CSV + $GUESTS_CSV."
             echo "See the comment block at the top of this script for details."; exit 0 ;;
  "") ;;
  *) die "unknown option: $1 (try --help)" ;;
esac

NODE_BIN="$(command -v node || command -v node.exe || true)"
[[ -n "$NODE_BIN" ]] || die "node not found on PATH (on Windows, run this from Git Bash)"
[[ -f "$DB_FILE" ]]        || die "$DB_FILE not found (run this from the project root)"
[[ -f "$HOUSEHOLDS_CSV" ]] || die "$HOUSEHOLDS_CSV not found"
[[ -f "$GUESTS_CSV" ]]     || die "$GUESTS_CSV not found"
[[ -e node_modules/better-sqlite3 ]] || die "node_modules/better-sqlite3 missing — run: npm install"

BACKUP_FILE="wedding.backup-$(date +%Y%m%d-%H%M%S).db"
n=1
while [[ -e "$BACKUP_FILE" ]]; do
  BACKUP_FILE="wedding.backup-$(date +%Y%m%d-%H%M%S)-$n.db"
  n=$((n + 1))
done

run_importer() {
  "$NODE_BIN" - "$1" "$DB_FILE" "$HOUSEHOLDS_CSV" "$GUESTS_CSV" "$BACKUP_FILE" <<'NODE'
'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');

const [mode, dbPath, hhPath, gPath, backupPath] = process.argv.slice(2);

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// Minimal RFC-4180 CSV parser: BOM-aware, CRLF/LF, quoted fields (embedded
// commas/quotes/newlines). Returns rows with their 1-based line numbers;
// fully blank lines are skipped.
function parseCsv(path) {
  const text = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let cells = [], field = '', inQuotes = false, line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(field); field = '';
      rows.push({ line: startLine, cells });
      cells = []; line++; startLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error(`unterminated quoted field (starts near line ${startLine})`);
  if (field !== '' || cells.length) { cells.push(field); rows.push({ line: startLine, cells }); }
  return rows.filter(r => r.cells.some(c => c.trim() !== ''));
}

function readSheet(path) {
  let rows;
  try { rows = parseCsv(path); } catch (e) { fail(`${path}: ${e.message}`); }
  if (rows.length < 2) fail(`${path}: needs a header row and at least one data row`);
  return { path, header: rows[0].cells.map(h => h.trim()), rows: rows.slice(1) };
}

const db = new Database(dbPath, { fileMustExist: true });
db.pragma('foreign_keys = ON');

for (const t of ['households', 'guests', 'plus_ones', 'rsvp_logs']) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
    fail(`${dbPath}: table '${t}' not found — start the server once so it creates the schema`);
}

const errors = [], warnings = [];
const err = m => errors.push(m);

const BOOL_VALUES = { TRUE: 1, FALSE: 0, 1: 1, 0: 0 };

// Cell -> DB value. Empty cells become NULL except where the table defines a
// NOT NULL default (allow_plus_one 0, type 'adult'), which we mirror here.
function convert(file, col, raw, line) {
  const v = raw.trim();
  if (col === 'id' || col === 'household_id') {
    if (v === '') return null;
    if (!/^\d+$/.test(v)) { err(`${file} line ${line}: ${col} must be a positive integer, got "${raw}"`); return null; }
    return Number(v);
  }
  if (col === 'allow_plus_one' || col === 'attending') {
    if (v === '') return col === 'allow_plus_one' ? 0 : null;
    const b = BOOL_VALUES[v.toUpperCase()];
    if (b === undefined) err(`${file} line ${line}: ${col} must be TRUE, FALSE, 1 or 0, got "${raw}"`);
    return b ?? null;
  }
  if (col === 'type') {
    if (v === '') return 'adult';
    const t = v.toLowerCase();
    if (t !== 'adult' && t !== 'child') { err(`${file} line ${line}: type must be "adult" or "child", got "${raw}"`); return 'adult'; }
    return t;
  }
  return v === '' ? null : v;
}

// Validate the header against the live table schema and build row records.
// Required = the table's NOT-NULL-without-default columns, plus extras
// (households.csv must carry id so guests.csv household_id refs line up).
function buildRecords(sheet, table, extraRequired) {
  const cols = db.pragma(`table_info(${table})`);
  const colNames = new Set(cols.map(c => c.name));
  const required = new Set([
    ...cols.filter(c => c.notnull && c.dflt_value === null && !c.pk).map(c => c.name),
    ...extraRequired,
  ]);

  const before = errors.length;
  const seen = new Set();
  for (const h of sheet.header) {
    if (!colNames.has(h)) err(`${sheet.path}: unknown column "${h}" — ${table} columns are: ${cols.map(c => c.name).join(', ')}`);
    else if (seen.has(h)) err(`${sheet.path}: column "${h}" appears twice in the header`);
    seen.add(h);
  }
  for (const r of required) {
    if (!seen.has(r)) err(`${sheet.path}: required column "${r}" is missing from the header`);
  }
  if (errors.length > before) return null;

  const records = [];
  for (const { line, cells } of sheet.rows) {
    const c = cells.slice();
    while (c.length > sheet.header.length && c[c.length - 1].trim() === '') c.pop();
    if (c.length !== sheet.header.length) {
      err(`${sheet.path} line ${line}: has ${c.length} fields but the header has ${sheet.header.length}`);
      continue;
    }
    const rec = { __line: line };
    sheet.header.forEach((col, i) => { rec[col] = convert(sheet.path, col, c[i], line); });
    for (const r of required) {
      if (rec[r] === null) err(`${sheet.path} line ${line}: "${r}" is empty`);
    }
    records.push(rec);
  }
  return records;
}

const groupLines = (recs, keyFn) => {
  const m = new Map();
  for (const r of recs) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r.__line);
  }
  return m;
};
const dupes = m => [...m.entries()].filter(([, lines]) => lines.length > 1);

const hhSheet = readSheet(hhPath);
const gSheet = readSheet(gPath);
const hh = buildRecords(hhSheet, 'households', ['id']);
const gg = buildRecords(gSheet, 'guests', []);

if (hh) {
  for (const [id, lines] of dupes(groupLines(hh, r => r.id)))
    err(`${hhPath}: household id ${id} appears on lines ${lines.join(', ')}`);
  // the RSVP lookup matches codes with upper(), so duplicates differing only
  // by case would still make a code ambiguous
  for (const [code, lines] of dupes(groupLines(hh, r => (r.invite_code ?? '').toUpperCase())))
    err(`${hhPath}: invite_code "${code}" is used on lines ${lines.join(', ')} — invite codes must be unique (matched case-insensitively)`);
}
if (hh && gg) {
  const ids = new Set(hh.map(r => r.id));
  for (const g of gg) {
    if (g.household_id !== null && !ids.has(g.household_id))
      err(`${gPath} line ${g.__line}: household_id ${g.household_id} does not exist in ${hhPath}`);
  }
  const guestsPerHousehold = groupLines(gg, r => r.household_id);
  for (const r of hh) {
    if (!guestsPerHousehold.has(r.id))
      warnings.push(`household ${r.id} ("${r.name}") has no guests in ${gPath} — it can RSVP by invite code but not by name lookup`);
  }
  for (const [key, lines] of dupes(groupLines(gg, r => `${r.household_id}|${(r.first_name ?? '').toLowerCase()} ${(r.last_name ?? '').toLowerCase()}`)))
    warnings.push(`${gPath}: possible duplicate guest "${key.split('|')[1]}" in household ${key.split('|')[0]} on lines ${lines.join(', ')}`);
}

if (errors.length) {
  console.error(`Found ${errors.length} problem(s) in the CSVs — nothing was changed:`);
  for (const e of errors) console.error('  ERROR: ' + e);
  process.exit(1);
}
for (const w of warnings) console.error('  WARNING: ' + w);

const current = {};
for (const t of ['households', 'guests', 'plus_ones', 'rsvp_logs'])
  current[t] = db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;

if (mode === 'validate') {
  const adults = gg.filter(g => (g.type ?? 'adult') === 'adult').length;
  console.log('CSVs parsed and validated:');
  console.log(`  ${hhPath}: ${hh.length} households`);
  console.log(`  ${gPath}: ${gg.length} guests (${adults} adults, ${gg.length - adults} children)`);
  console.log('');
  console.log(`Current data in ${dbPath} that will be DELETED:`);
  console.log(`  households: ${current.households}, guests: ${current.guests}, plus_ones: ${current.plus_ones}, rsvp_logs: ${current.rsvp_logs}`);
  process.exit(0);
}

// ---- apply ----
db.prepare('VACUUM INTO ?').run(backupPath);

const insertAll = (table, header, recs) => {
  const cols = header.map(c => `"${c}"`).join(', ');
  const marks = header.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${marks})`);
  for (const r of recs) stmt.run(header.map(c => r[c]));
};

const deleted = {};
db.transaction(() => {
  for (const t of ['rsvp_logs', 'plus_ones', 'guests', 'households'])
    deleted[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('rsvp_logs','plus_ones','guests','households')").run();
  insertAll('households', hhSheet.header, hh);
  insertAll('guests', gSheet.header, gg);
  const fk = db.pragma('foreign_key_check');
  if (fk.length) throw new Error('foreign_key_check failed after import: ' + JSON.stringify(fk.slice(0, 5)));
}).immediate();

console.log(`Backup of the previous database: ${backupPath}`);
console.log(`Deleted:  ${deleted.households} households, ${deleted.guests} guests, ${deleted.plus_ones} plus-ones, ${deleted.rsvp_logs} rsvp log entries`);
console.log(`Imported: ${hh.length} households, ${gg.length} guests`);
console.log('Autoincrement counters reset; foreign key check passed.');
NODE
}

run_importer validate

if [[ $ASSUME_YES -ne 1 ]]; then
  [[ -t 0 ]] || die "refusing to modify $DB_FILE without confirmation (no terminal) — re-run with -y"
  printf '\nThis will DELETE the data listed above from %s and reload it from the CSVs.\nType "yes" to continue: ' "$DB_FILE"
  read -r reply
  [[ "$reply" == "yes" ]] || { echo "Aborted — nothing was changed."; exit 1; }
fi

echo ""
run_importer apply
echo "Done."

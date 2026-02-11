#!/usr/bin/env node
/**
 * docs-folder-sync.js
 *
 * Mirrors markdown files in backend/docs/ into the `documents` table (category='Docs').
 * - Upsert by filename
 * - Delete DB rows whose filename no longer exists on disk (only for category='Docs')
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const dbPath = path.resolve(__dirname, 'bot.db');
const docsDir = path.resolve(__dirname, 'docs');

function listMdFiles() {
  const out = [];
  for (const name of fs.readdirSync(docsDir)) {
    if (name.toLowerCase().endsWith('.md')) out.push(name);
  }
  return out;
}

function deriveTitle(content, filename) {
  const m = content.match(/^#\s+(.+)\s*$/m);
  if (m) return m[1].trim();
  return filename.replace(/\.md$/i, '');
}

async function main() {
  const db = new sqlite3.Database(dbPath);
  const files = listMdFiles();
  const fileSet = new Set(files);

  const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (e,r)=>e?rej(e):res(r)));
  const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (e,r)=>e?rej(e):res(r)));
  const run = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(e){e?rej(e):res(this)}));

  let upserts = 0;
  for (const filename of files) {
    const full = path.join(docsDir, filename);
    const content = fs.readFileSync(full, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    const title = deriveTitle(content, filename);
    
    // Smart category assignment
    let category = 'Docs';
    if (filename.toLowerCase().includes('watchlist') || filename.toLowerCase().includes('strategic')) {
      category = 'Research';
    } else if (filename.toLowerCase().includes('backup')) {
      category = 'System';
    }

    const existing = await get('SELECT id FROM documents WHERE filename = ? LIMIT 1', [filename]);
    if (!existing) {
      await run(
        'INSERT INTO documents (title, content, category, filename, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [title, content, category, filename, size]
      );
      upserts++;
    } else {
      await run(
        'UPDATE documents SET title=?, content=?, category=?, size=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [title, content, category, size, existing.id]
      );
      upserts++;
    }
  }

  // Deletions: only rows in category='Docs' with filename not present
  const rows = await all('SELECT id, filename FROM documents WHERE category = ? AND filename IS NOT NULL', ['Docs']);
  let deletes = 0;
  for (const r of rows) {
    if (!r.filename) continue;
    if (!fileSet.has(r.filename) && r.filename.toLowerCase().endsWith('.md')) {
      await run('DELETE FROM documents WHERE id = ?', [r.id]);
      deletes++;
    }
  }

  db.close();
  console.log(JSON.stringify({ ok: true, upserts, deletes, files: files.length }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});

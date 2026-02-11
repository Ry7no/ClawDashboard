require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const EventEmitter = require('events');


const app = express();
const PORT = process.env.PORT || 3001;

// OpenClaw config (for agent list)
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || path.join(__dirname, '../../..', 'openclaw.json');

// ========== REALTIME EVENTS (SSE) ==========
const events = new EventEmitter();
function broadcast(event, data = {}) {
  events.emit('event', { event, data, ts: new Date().toISOString() });
}

// ========== DATABASE SETUP (SQLite) ==========
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.isAbsolute(process.env.DB_PATH || 'bot.db')
  ? process.env.DB_PATH
  : path.join(__dirname, process.env.DB_PATH || 'bot.db');
const db = new sqlite3.Database(dbPath);
console.log('Using SQLite database');

// Local documents storage
const docsDir = path.isAbsolute(process.env.DOCS_DIR || 'docs')
  ? process.env.DOCS_DIR
  : path.join(__dirname, process.env.DOCS_DIR || 'docs');
fs.ensureDirSync(docsDir);

// Workspace markdown scan (for Docs tab)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(__dirname, '../../..', 'workspace');
const WORKSPACE_EXCLUDE = new Set(['node_modules', '.git', '.openclaw', 'dist', 'build', 'ClawDashboard']);

async function listWorkspaceMarkdown() {
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      // Allow ClawDashboard/records only; skip other ClawDashboard content
      if (entry.isDirectory() && entry.name === 'ClawDashboard') {
        const recordsDir = path.join(full, 'records');
        await walk(recordsDir);
        continue;
      }

      if (WORKSPACE_EXCLUDE.has(entry.name)) continue;

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        try {
          const stat = await fs.stat(full);
          const rel = path.relative(WORKSPACE_ROOT, full);
          results.push({ full, rel, mtime: stat.mtime });
        } catch (_) { }
      }
    }
  }
  await walk(WORKSPACE_ROOT);
  return results;
}

async function listBackendDocs() {
  const results = [];
  try {
    const entries = await fs.readdir(docsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const full = path.join(docsDir, entry.name);
        const stat = await fs.stat(full);
        results.push({ full, name: entry.name, mtime: stat.mtime });
      }
    }
  } catch (_) {}
  return results;
}

function loadAgentsFromConfig() {
  try {
    const raw = fs.readFileSync(OPENCLAW_CONFIG, 'utf8');
    const cfg = JSON.parse(raw);
    const agents = cfg?.agents || {};
    const names = Object.keys(agents).filter(k => k !== 'defaults');
    return names.map(name => ({ name }));
  } catch (e) {
    return [];
  }
}

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl) or from localhost
    if (!origin || origin.startsWith('http://localhost')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Root health check
app.get('/', (req, res) => {
  res.json({
    name: "Claw Dashboard API",
    status: "online",
    version: "v5.0.0-local",
    environment: 'local'
  });
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('retry: 3000\n');

  const send = (payload) => {
    res.write('event: ' + payload.event + '\n');
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  };

  const handler = (payload) => send(payload);
  events.on('event', handler);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { }
  }, 15000);

  send({ event: 'hello', data: { environment: 'local' }, ts: new Date().toISOString() });

  req.on('close', () => {
    clearInterval(ping);
    events.off('event', handler);
    res.end();
  });
});

// ========== FILE UPLOAD SETUP ==========
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, docsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: diskStorage });

// ========== DATABASE HELPERS ==========
const dbQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// ========== INITIALIZE DATABASE ==========
const initDatabase = async () => {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo',
        priority TEXT DEFAULT 'medium',
        checked INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        category TEXT DEFAULT 'Guide',
        filename TEXT,
        size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'info',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT DEFAULT 'idle',
        active_agent TEXT DEFAULT 'Claw',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS model_usage (
        provider TEXT,
        model TEXT,
        usage_pct INTEGER,
        cd_reset DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, model)
      )
    `);

    // Migrations: Add columns if missing (safe to run multiple times)
    try { await dbRun('ALTER TABLE status ADD COLUMN active_agent TEXT DEFAULT \'Claw\''); } catch (e) { }
    try { await dbRun('ALTER TABLE status ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch (e) { }
    try { await dbRun('ALTER TABLE documents ADD COLUMN is_pinned INTEGER DEFAULT 0'); } catch (e) { }
    try { await dbRun('ALTER TABLE documents ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch (e) { }

    // Insert initial status if not exists
    await dbRun(`INSERT OR IGNORE INTO status (id, state) VALUES (1, 'idle')`);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
};

// Initialize database on startup
initDatabase();

// ========== LOGGING HELPER ==========
const addLog = async (title, description, type = 'info') => {
  try {
    await dbRun('INSERT INTO logs (title, description, type) VALUES (?, ?, ?)', [title, description, type]);
  } catch (err) {
    console.error('Failed to add log:', err);
  }
};

// ========== AGENTS ENDPOINT ==========
app.get('/api/agents', async (req, res) => {
  try {
    const agents = loadAgentsFromConfig();
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== STATUS ENDPOINTS ==========
app.get('/api/status', async (req, res) => {
  try {
    const row = await dbGet('SELECT state, active_agent, updated_at FROM status WHERE id = 1');
    res.json({
      status: row?.state || 'idle',
      activeAgent: row?.active_agent || 'Claw',
      uptime: process.uptime(),
      timestamp: row?.updated_at || new Date().toISOString(),
      environment: 'local'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/status', async (req, res) => {
  const { state, status, activeAgent } = req.body;
  const nextState = state ?? status;

  try {
    let query, params;
    if (nextState && activeAgent) {
      query = 'UPDATE status SET state = ?, active_agent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1';
      params = [nextState, activeAgent];
    } else if (nextState) {
      query = 'UPDATE status SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1';
      params = [nextState];
    } else if (activeAgent) {
      query = 'UPDATE status SET active_agent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1';
      params = [activeAgent];
    }

    if (query) {
      await dbRun(query, params);
      broadcast('statusUpdated', { state: nextState, activeAgent });
      res.json({ success: true, state: nextState, activeAgent });
    } else {
      res.status(400).json({ error: 'Missing state or activeAgent' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MODEL USAGE ENDPOINTS ==========
app.get('/api/models', async (req, res) => {
  try {
    const rows = await dbQuery('SELECT * FROM model_usage ORDER BY provider, model');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models', async (req, res) => {
  const { provider, model, usage_pct, cd_reset } = req.body;
  if (!provider || !model) {
    return res.status(400).json({ error: 'Missing provider or model' });
  }

  try {
    await dbRun(
      `INSERT OR REPLACE INTO model_usage (provider, model, usage_pct, cd_reset, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [provider, model, usage_pct, cd_reset]
    );
    broadcast('modelsUpdated', { provider, model, usage_pct, cd_reset });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== WEBHOOK (Messages -> Tasks) ==========
app.post('/api/webhook/message', async (req, res) => {
  const { text = '', stage = 'received' } = req.body || {};
  const summary = String(text).trim().split('\n')[0].slice(0, 120) || 'New task';

  try {
    if (stage === 'received') {
      const result = await dbRun(
        'INSERT INTO tasks (title, description, status, priority) VALUES (?, ?, ?, ?)',
        [summary, text, 'todo', 'medium']
      );
      await addLog('Task Created (Webhook)', summary, 'task');
      const row = await dbGet('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
      broadcast('tasksUpdated', { source: 'webhook.received' });
      return res.json({ success: true, task: row });
    }

    if (stage === 'started' || stage === 'completed') {
      const status = stage === 'started' ? 'in_progress' : 'done';
      const { taskId } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'taskId required for started/completed' });
      await dbRun('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, taskId]);
      broadcast('tasksUpdated', { source: `webhook.${stage}`, id: taskId });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid stage' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== TASKS ENDPOINTS ==========
app.get('/api/tasks', async (req, res) => {
  try {
    const rows = await dbQuery('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { title, description, status = 'todo', priority = 'medium' } = req.body;
  try {
    const result = await dbRun(
      'INSERT INTO tasks (title, description, status, priority) VALUES (?, ?, ?, ?)',
      [title, description, status, priority]
    );
    await addLog('Task Created', `New task: ${title}`, 'task');
    const row = await dbGet('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
    broadcast('tasksUpdated', { source: 'task.create' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { status, checked, title, description, priority } = req.body;

  try {
    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (checked !== undefined) { updates.push('checked = ?'); values.push(checked ? 1 : 0); }

    if (updates.length === 0) return res.json({ success: true });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);
    broadcast('tasksUpdated', { source: 'task.update', id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM tasks WHERE id = ?', [id]);
    await addLog('Task Deleted', 'Task removed', 'task');
    broadcast('tasksUpdated', { source: 'task.delete', id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DOCUMENTS ENDPOINTS ==========
app.put('/api/docs/file', async (req, res) => {
  const { id, title, content } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    if (String(id).startsWith('file:')) {
      const rel = String(id).replace(/^file:/, '');
      const full = path.join(WORKSPACE_ROOT, rel);
      if (content !== undefined) {
        await fs.writeFile(full, content, 'utf8');
      }
      if (title && title !== rel) {
        const newRel = title;
        const newFull = path.join(WORKSPACE_ROOT, newRel);
        await fs.ensureDir(path.dirname(newFull));
        await fs.move(full, newFull, { overwrite: true });
      }
      broadcast("docsUpdated", { source: "doc.update", id });
      return res.json({ success: true });
    }

    if (String(id).startsWith('docs:')) {
      const name = String(id).replace(/^docs:/, '');
      const full = path.join(docsDir, name);
      if (content !== undefined) {
        await fs.writeFile(full, content, 'utf8');
      }
      if (title && title !== name) {
        const newName = title;
        const newFull = path.join(docsDir, newName);
        await fs.ensureDir(path.dirname(newFull));
        await fs.move(full, newFull, { overwrite: true });
      }
      broadcast("docsUpdated", { source: "doc.update", id });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid id' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/docs', async (req, res) => {
  try {
    const rows = await dbQuery(
      'SELECT id, title, category, is_pinned, sort_order, created_at, updated_at FROM documents ORDER BY is_pinned DESC, sort_order ASC, created_at DESC'
    );

    const workspaceFiles = await listWorkspaceMarkdown();
    const workspaceDocs = workspaceFiles.map(f => {
      const isRecord = f.rel.startsWith('ClawDashboard/records/');
      const displayTitle = isRecord ? f.rel.replace(/^ClawDashboard\/records\//, '') : f.rel;
      return {
        id: `file:${f.rel}`,
        title: displayTitle,
        category: isRecord ? 'Records' : 'System',
        is_pinned: 0,
        sort_order: 0,
        created_at: f.mtime?.toISOString?.() || new Date().toISOString(),
        updated_at: f.mtime?.toISOString?.() || new Date().toISOString(),
        isSystem: !isRecord,
      };
    });

    const backendFiles = await listBackendDocs();
    const backendDocs = backendFiles.map(f => ({
      id: `docs:${f.name}`,
      title: f.name,
      category: 'Docs',
      is_pinned: 0,
      sort_order: 0,
      created_at: f.mtime?.toISOString?.() || new Date().toISOString(),
      updated_at: f.mtime?.toISOString?.() || new Date().toISOString(),
      isSystem: false,
    }));

    res.json([...rows, ...workspaceDocs, ...backendDocs]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/docs/:id/pin', async (req, res) => {
  const { id } = req.params;
  const { is_pinned } = req.body;
  try {
    if (String(id).startsWith('file:')) {
      return res.status(400).json({ error: 'Workspace files are read-only' });
    }
    await dbRun('UPDATE documents SET is_pinned = ? WHERE id = ?', [is_pinned ? 1 : 0, id]);
    res.json({ success: true });
    broadcast("docsUpdated", { source: "doc.pin", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/docs/reorder', async (req, res) => {
  const { orders } = req.body;
  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ error: 'Missing or invalid orders array' });
  }

  try {
    for (const item of orders) {
      if (String(item.id).startsWith('file:')) continue;
      await dbRun('UPDATE documents SET sort_order = ? WHERE id = ?', [item.sort_order, item.id]);
    }
    res.json({ success: true });
    broadcast("docsUpdated", { source: "doc.reorder" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docs', async (req, res) => {
  const { title, content, category = 'Guide', writePath } = req.body;
  try {
    if (writePath) {
      const full = path.join(WORKSPACE_ROOT, writePath);
      await fs.ensureDir(path.dirname(full));
      await fs.writeFile(full, content || '', 'utf8');
      broadcast("docsUpdated", { source: "doc.create", path: writePath });
      return res.json({ success: true, id: `file:${writePath}` });
    }
    const result = await dbRun(
      'INSERT INTO documents (title, content, category) VALUES (?, ?, ?)',
      [title, content, category]
    );
    await addLog('Document Created', `New document: ${title}`, 'document');
    const row = await dbGet('SELECT * FROM documents WHERE id = ?', [result.lastID]);
    res.json(row);
    broadcast("docsUpdated", { source: "doc.create" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/docs/content', async (req, res) => {
  const id = req.query.id;
  try {
    if (String(id || '').startsWith('file:')) {
      const rel = String(id).replace(/^file:/, '');
      const full = path.join(WORKSPACE_ROOT, rel);
      const content = await fs.readFile(full, 'utf8');
      return res.json({ content });
    }

    if (String(id || '').startsWith('docs:')) {
      const name = String(id).replace(/^docs:/, '');
      const full = path.join(docsDir, name);
      const content = await fs.readFile(full, 'utf8');
      return res.json({ content });
    }

    const row = await dbGet('SELECT content, filename FROM documents WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Document not found' });

    if (!row.content && row.filename) {
      const filePath = path.join(docsDir, row.filename);
      if (await fs.pathExists(filePath)) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        return res.json({ content: fileContent });
      }
    }

    res.json({ content: row.content || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/docs/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, category } = req.body;

  try {
    if (String(id).startsWith('file:')) {
      const rel = String(id).replace(/^file:/, '');
      const full = path.join(WORKSPACE_ROOT, rel);
      if (content !== undefined) {
        await fs.writeFile(full, content, 'utf8');
      }
      if (title && title !== rel) {
        const newRel = title;
        const newFull = path.join(WORKSPACE_ROOT, newRel);
        await fs.ensureDir(path.dirname(newFull));
        await fs.move(full, newFull, { overwrite: true });
      }
      broadcast("docsUpdated", { source: "doc.update", id });
      return res.json({ success: true });
    }
    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }

    if (updates.length === 0) return res.json({ success: true });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await dbRun(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
    broadcast("docsUpdated", { source: "doc.update", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/docs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (String(id).startsWith('file:')) {
      const rel = String(id).replace(/^file:/, '');
      const full = path.join(WORKSPACE_ROOT, rel);
      if (await fs.pathExists(full)) await fs.remove(full);
      broadcast("docsUpdated", { source: "doc.delete", id });
      return res.json({ success: true });
    }
    const doc = await dbGet('SELECT filename FROM documents WHERE id = ?', [id]);

    await dbRun('DELETE FROM documents WHERE id = ?', [id]);

    // If it has a filename, delete the file too
    if (doc && doc.filename) {
      const filePath = path.join(docsDir, doc.filename);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        await addLog('File Deleted', `Removed file: ${doc.filename}`, 'document');
      }
    }

    await addLog('Document Deleted', 'Document removed', 'document');
    res.json({ success: true });
    broadcast("docsUpdated", { source: "doc.delete", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== LOGS ENDPOINTS ==========
app.get('/api/logs', async (req, res) => {
  try {
    const rows = await dbQuery('SELECT * FROM logs ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== SYNC ENDPOINTS (Local Data Export/Import) ==========
app.get('/api/sync/export', async (req, res) => {
  try {
    const tasks = await dbQuery('SELECT * FROM tasks');
    const documents = await dbQuery('SELECT * FROM documents');
    const logs = await dbQuery('SELECT * FROM logs ORDER BY created_at DESC LIMIT 500');
    const status = await dbGet('SELECT * FROM status WHERE id = 1');

    res.json({
      exportedAt: new Date().toISOString(),
      dbType: 'sqlite',
      data: { tasks, documents, logs, status }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/import', async (req, res) => {
  const { data, strategy = 'last-write-wins' } = req.body;
  if (!data) return res.status(400).json({ error: 'No data provided' });

  const results = { tasks: 0, documents: 0, status: 0 };

  try {
    if (strategy === 'replace') {
      await dbRun('DELETE FROM tasks');
      if (data.tasks && Array.isArray(data.tasks)) {
        for (const task of data.tasks) {
          await dbRun(
            `INSERT INTO tasks (id, title, description, status, priority, checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [task.id, task.title, task.description, task.status, task.priority, task.checked, task.created_at, task.updated_at]
          );
          results.tasks++;
        }
      }

      await dbRun('DELETE FROM documents');
      if (data.documents && Array.isArray(data.documents)) {
        for (const doc of data.documents) {
          await dbRun(
            `INSERT INTO documents (id, title, content, category, filename, size, is_pinned, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [doc.id, doc.title, doc.content, doc.category, doc.filename, doc.size, doc.is_pinned || 0, doc.sort_order || 0, doc.created_at, doc.updated_at]
          );
          results.documents++;
        }
      }

      if (data.status) {
        await dbRun('DELETE FROM status');
        await dbRun(`INSERT INTO status (id, state, active_agent, updated_at) VALUES (1, ?, ?, ?)`,
          [data.status.state, data.status.active_agent, data.status.updated_at]);
        results.status++;
      }


    }

    // Last-write-wins merge for tasks
    if (strategy !== 'replace' && data.tasks && Array.isArray(data.tasks)) {
      for (const task of data.tasks) {
        const existing = await dbGet('SELECT * FROM tasks WHERE id = ?', [task.id]);
        if (!existing) {
          await dbRun(
            `INSERT INTO tasks (id, title, description, status, priority, checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [task.id, task.title, task.description, task.status, task.priority, task.checked, task.created_at, task.updated_at]
          );
          results.tasks++;
        } else if (new Date(task.updated_at) > new Date(existing.updated_at)) {
          await dbRun(
            `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, checked = ?, updated_at = ? WHERE id = ?`,
            [task.title, task.description, task.status, task.priority, task.checked, task.updated_at, task.id]
          );
          results.tasks++;
        }
      }
    }

    // Last-write-wins merge for documents
    if (data.documents && Array.isArray(data.documents)) {
      for (const doc of data.documents) {
        const existing = await dbGet('SELECT * FROM documents WHERE id = ?', [doc.id]);
        if (!existing) {
          await dbRun(
            `INSERT INTO documents (id, title, content, category, filename, size, is_pinned, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [doc.id, doc.title, doc.content, doc.category, doc.filename, doc.size, doc.is_pinned || 0, doc.sort_order || 0, doc.created_at, doc.updated_at]
          );
          results.documents++;
        } else if (new Date(doc.updated_at) > new Date(existing.updated_at)) {
          await dbRun(
            `UPDATE documents SET title = ?, content = ?, category = ?, filename = ?, size = ?, is_pinned = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
            [doc.title, doc.content, doc.category, doc.filename, doc.size, doc.is_pinned || 0, doc.sort_order || 0, doc.updated_at, doc.id]
          );
          results.documents++;
        }
      }
    }

    // Status
    if (data.status) {
      await dbRun('UPDATE status SET state = ?, active_agent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [data.status.state, data.status.active_agent]);
      results.status = 1;
    }

    await addLog('Sync Import', `Imported: ${results.tasks} tasks, ${results.documents} docs`, 'sync');

    if (results.tasks) broadcast('tasksUpdated', { source: 'sync.import', count: results.tasks, strategy });
    if (results.documents) broadcast('docsUpdated', { source: 'sync.import', count: results.documents, strategy });

    res.json({ success: true, imported: results });
  } catch (err) {
    console.error('Sync import error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/status', async (req, res) => {
  try {
    const taskCount = await dbGet('SELECT COUNT(*) as count FROM tasks');
    const docCount = await dbGet('SELECT COUNT(*) as count FROM documents');
    const logCount = await dbGet('SELECT COUNT(*) as count FROM logs');
    const lastTask = await dbGet('SELECT updated_at FROM tasks ORDER BY updated_at DESC LIMIT 1');
    const lastDoc = await dbGet('SELECT updated_at FROM documents ORDER BY updated_at DESC LIMIT 1');

    res.json({
      dbType: 'sqlite',
      environment: 'local',
      counts: {
        tasks: taskCount?.count || 0,
        documents: docCount?.count || 0,
        logs: logCount?.count || 0
      },
      lastUpdated: {
        tasks: lastTask?.updated_at || null,
        documents: lastDoc?.updated_at || null
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ========== SERVER START ==========
const startServer = async () => {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`Dashboard Backend running on port ${PORT}`);
    console.log(`Database: SQLite (${dbPath})`);
    console.log(`Storage: Local (${docsDir})`);

    addLog('System Started', 'Dashboard backend initialized', 'system');
  });
};

startServer();

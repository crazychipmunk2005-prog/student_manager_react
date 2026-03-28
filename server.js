import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DATA_DIR = path.join(process.cwd(), 'data');
const collections = ['admins', 'batches', 'students', 'activities', 'attendance', 'pendingUsers'];

// Initialization to ensure collections act like a NoSQL document database
async function initDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const col of collections) {
    const filePath = path.join(DATA_DIR, `${col}.json`);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '[]', 'utf8');
    }
  }
}

// Load a specific collection (NoSQL get all docs in collection)
app.get('/api/collection/:name', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, `${req.params.name}.json`), 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync entire DB structure from frontend (efficient snapshot sync for Zustand)
app.post('/api/sync', async (req, res) => {
  try {
    for (const col of collections) {
      if (req.body[col] !== undefined) {
         await fs.writeFile(path.join(DATA_DIR, `${col}.json`), JSON.stringify(req.body[col], null, 2), 'utf8');
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Load all NoSQL Collections
app.get('/api/database', async (req, res) => {
  const db = {};
  try {
    for (const col of collections) {
      const data = await fs.readFile(path.join(DATA_DIR, `${col}.json`), 'utf8');
      db[col] = JSON.parse(data);
    }
    res.json(db);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 5000;
app.listen(PORT, async () => {
  await initDb();
  console.log(`NoSQL Backend Server listening on port ${PORT}`);
});

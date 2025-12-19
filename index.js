import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* =========================
   STORAGE
   ========================= */

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'votes.json');
const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

function ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ items: {} }, null, 2));
    }
}

function loadData() {
    ensureStorage();
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getIP(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown'
    );
}

/* =========================
   ROUTES
   ========================= */

// получить рейтинг объекта
app.get('/rating/:itemId', (req, res) => {
    const data = loadData();
    const item = data.items?.[req.params.itemId];

    res.json({
        rating: item?.rating ?? 0,
        votes: item?.votes ?? 0
    });
});

// проголосовать
app.post('/vote', (req, res) => {
    const { item_id, vote, user_hash, user_agent } = req.body;

    if (!item_id || ![1, -1].includes(vote) || !user_hash || !user_agent) {
        return res.status(400).json({ message: 'bad_request' });
    }

    const now = Date.now();
    const ip = getIP(req);

    const data = loadData();
    data.items[item_id] ??= { rating: 0, votes: 0, history: [] };

    const item = data.items[item_id];

    const lastVote = [...item.history]
        .reverse()
        .find(v => v.user_hash === user_hash && v.user_agent === user_agent);

    if (lastVote && (now - lastVote.ts) < MONTH_MS) {
        return res.status(429).json({
            message: 'cooldown',
            retry_after_ms: MONTH_MS - (now - lastVote.ts)
        });
    }

    item.rating += vote;
    item.votes += 1;

    item.history.push({
        vote,
        user_hash,
        user_agent,
        ip,
        ts: now
    });

    saveData(data);

    res.json({
        success: true,
        rating: item.rating,
        votes: item.votes
    });
});

/* =========================
   START
   ========================= */

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

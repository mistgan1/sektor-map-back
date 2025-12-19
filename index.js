import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = './votes.json';
const MONTH = 1000 * 60 * 60 * 24 * 30;

app.use(cors());
app.use(express.json());

// ---------- helpers ----------

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ items: {} }, null, 2));
    }
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

// ---------- routes ----------

// получить рейтинг объекта
app.get('/rating/:itemId', (req, res) => {
    const data = loadData();
    const item = data.items[req.params.itemId];

    res.json({
        rating: item?.rating || 0,
        votes: item?.votes || 0
    });
});

// проголосовать
app.post('/vote', (req, res) => {
    const { item_id, vote, user_hash, user_agent } = req.body;
    if (!item_id || !vote || !user_hash) {
        return res.status(400).json({ error: 'invalid payload' });
    }

    const ip = getIP(req);
    const now = Date.now();
    const data = loadData();

    if (!data.items[item_id]) {
        data.items[item_id] = {
            rating: 0,
            votes: 0,
            history: []
        };
    }

    const item = data.items[item_id];

    const lastVote = item.history.find(v =>
        v.user_hash === user_hash &&
        v.user_agent === user_agent
    );

    if (lastVote && (now - lastVote.ts) < MONTH) {
        return res.status(429).json({
            error: 'cooldown',
            retry_after: Math.ceil((MONTH - (now - lastVote.ts)) / 1000)
        });
    }

    item.rating += vote;
    item.votes += 1;

    item.history.push({
        user_hash,
        user_agent,
        ip,
        vote,
        ts: now
    });

    saveData(data);

    res.json({
        success: true,
        rating: item.rating,
        votes: item.votes
    });
});

// ---------- start ----------

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

app.use(cors());
app.use(express.json());

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  VOTES_PATH
} = process.env;

const GH_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${VOTES_PATH}`;

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/* =========================
   GitHub helpers
   ========================= */

async function loadVotes() {
  const res = await fetch(GH_API, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('GitHub load error:', res.status, text);
    throw new Error('Failed to load votes.json');
  }

  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf-8');

  return {
    sha: json.sha,
    data: JSON.parse(content)
  };
}


async function saveVotes(data, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    sha
  };

  const res = await fetch(GH_API, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

    if (!res.ok) {
    const text = await res.text();
    console.error('GitHub save error:', res.status, text);
    throw new Error('Failed to save votes.json');
    }
}

/* =========================
   Routes
   ========================= */

app.get('/rating/:itemId', async (req, res) => {
  try {
    const { data } = await loadVotes();
    const item = data.items?.[req.params.itemId];

    res.json({
      rating: item?.rating ?? 0,
      votes: item?.votes ?? 0
    });
  } catch (e) {
    res.status(500).json({ error: 'load_failed' });
  }
});

app.post('/vote', async (req, res) => {
  const { item_id, vote, user_hash, user_agent } = req.body;

  if (!item_id || ![1, -1].includes(vote) || !user_hash || !user_agent) {
    return res.status(400).json({ message: 'bad_request' });
  }

  try {
    const ip = getIP(req);
    const now = Date.now();

    const { data, sha } = await loadVotes();

    data.items[item_id] ??= { rating: 0, votes: 0, history: [] };
    const item = data.items[item_id];

    const lastVote = [...item.history]
      .reverse()
      .find(v =>
        v.user_hash === user_hash &&
        v.user_agent === user_agent
      );

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

    await saveVotes(data, sha, `vote: ${item_id} (${vote})`);

    res.json({
      success: true,
      rating: item.rating,
      votes: item.votes
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'vote_failed' });
  }
});

/* ========================= */

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

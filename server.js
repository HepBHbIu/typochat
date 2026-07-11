const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(express.json());

const PORT = process.env.PORT || 3001;
const PEERS = (process.env.PEERS || '').split(',').filter(Boolean);
const SERVER_NAME = process.env.SERVER_NAME || 'Node-' + PORT;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const channels = new Map();
const users = new Map();
const history = new Map();
const knownPeers = new Set(PEERS);
const MAX_HISTORY = 50;

channels.set('general', { id: 'general', name: 'Общий', icon: '💬', description: 'Главный чат', created_at: Date.now(), last_activity: Date.now() });

app.use(express.static('public'));

// ===== API =====
app.get('/api/channels', (req, res) => res.json(Array.from(channels.values())));
app.get('/api/stats', (req, res) => res.json({ users: users.size, channels: channels.size, peers: knownPeers.size }));
app.get('/api/channels/:id/history', (req, res) => res.json(history.get(req.params.id) || []));

app.post('/api/channels', (req, res) => {
  const { name, icon, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '-').replace(/-+/g, '-');
  if (channels.has(id)) return res.status(409).json({ error: 'Channel exists' });
  const ch = { id, name, icon: icon || '💬', description: description || '', created_at: Date.now(), last_activity: Date.now() };
  channels.set(id, ch);
  relay({ type: 'channel_created', channel: ch });
  res.json(ch);
});

// ===== FEDERATION =====
app.get('/federation/info', (req, res) => res.json({
  name: 'TypoChat', version: '1.0.0', server: SERVER_NAME, public_url: PUBLIC_URL,
  channels: channels.size, users: users.size, peers: Array.from(knownPeers),
}));

app.get('/federation/channels', (req, res) => res.json(Array.from(channels.values())));

app.get('/federation/history/:channelId', (req, res) => res.json(history.get(req.params.channelId) || []));

app.post('/federation/register', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  knownPeers.add(url);
  console.log(`[Federation] Registered peer: ${url} (${name || '?'})`);
  res.json({ ok: true, peers: Array.from(knownPeers), channels: Array.from(channels.values()), server: SERVER_NAME });
});

app.post('/federation/relay', (req, res) => {
  const { from, msg } = req.body;
  if (!msg) return res.status(400).json({ error: 'No message' });

  // Store message in history
  if (msg.type === 'message' && msg.message) {
    const ch = msg.message.channel;
    if (!channels.has(ch)) {
      channels.set(ch, { id: ch, name: ch, icon: '💬', description: '', created_at: Date.now(), last_activity: Date.now() });
    }
    if (!history.has(ch)) history.set(ch, []);
    history.get(ch).push(msg.message);
    if (history.get(ch).length > MAX_HISTORY) history.get(ch).shift();
  }

  // Store channel
  if (msg.type === 'channel_created' && msg.channel) {
    channels.set(msg.channel.id, { ...msg.channel, last_activity: Date.now() });
  }

  // Broadcast to local clients
  if (msg.channel) {
    broadcastToChannel(msg.channel, msg);
  } else {
    broadcastAllLocal(msg);
  }
  res.json({ ok: true });
});

// ===== AUTO-DISCOVERY =====
async function discoverPeers() {
  for (const peer of knownPeers) {
    try {
      const res = await fetch(`${peer}/federation/info`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const info = await res.json();
        console.log(`[Federation] Found peer: ${peer} (${info.server})`);

        // Register ourselves with peer
        await fetch(`${peer}/federation/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: PUBLIC_URL, name: SERVER_NAME }),
        });

        // Sync channels from peer
        const chRes = await fetch(`${peer}/federation/channels`, { signal: AbortSignal.timeout(3000) });
        if (chRes.ok) {
          const peerChannels = await chRes.json();
          for (const ch of peerChannels) {
            if (!channels.has(ch.id)) {
              channels.set(ch.id, ch);
              console.log(`[Federation] Synced channel: ${ch.id}`);
            }
          }
        }

        // Sync history from peer
        for (const [chId] of channels) {
          try {
            const hRes = await fetch(`${peer}/federation/history/${chId}`, { signal: AbortSignal.timeout(3000) });
            if (hRes.ok) {
              const msgs = await hRes.json();
              if (msgs.length > 0) {
                if (!history.has(chId)) history.set(chId, []);
                const existing = new Set(history.get(chId).map(m => m.id));
                for (const msg of msgs) {
                  if (!existing.has(msg.id)) history.get(chId).push(msg);
                }
                history.get(chId).sort((a, b) => a.timestamp - b.timestamp);
                if (history.get(chId).length > MAX_HISTORY) history.get(chId).splice(0, history.get(chId).length - MAX_HISTORY);
              }
            }
          } catch {}
        }

        // Get more peers from this peer
        if (info.peers) {
          for (const p of info.peers) {
            if (p !== PUBLIC_URL && !knownPeers.has(p)) {
              knownPeers.add(p);
              console.log(`[Federation] Discovered new peer: ${p}`);
            }
          }
        }
      }
    } catch {}
  }
}

// Periodic sync
setInterval(discoverPeers, 60000);

// ===== WEBSOCKET =====
wss.on('connection', (ws) => {
  const userId = uuidv4();
  ws.userId = userId;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try { handleMessage(ws, userId, JSON.parse(data.toString())); } catch {}
  });

  ws.on('close', () => {
    const user = users.get(userId);
    if (user) {
      broadcastToChannel(user.channel, { type: 'user_left', nickname: user.nickname });
      users.delete(userId);
      broadcastChannelUsers(user.channel);
    }
  });

  ws.send(JSON.stringify({ type: 'welcome', userId, peers: Array.from(knownPeers) }));
});

function handleMessage(ws, userId, msg) {
  switch (msg.type) {
    case 'join': {
      const { nickname, channel } = msg;
      if (!nickname || !channel) return;

      // Auto-create channel if doesn't exist
      if (!channels.has(channel)) {
        channels.set(channel, { id: channel, name: channel, icon: '💬', description: '', created_at: Date.now(), last_activity: Date.now() });
      }

      const user = { id: userId, nickname: nickname.slice(0, 20), channel, color: genColor(nickname) };
      users.set(userId, user);

      const msgs = history.get(channel) || [];
      ws.send(JSON.stringify({ type: 'history', channel, messages: msgs }));

      const channelUsers = Array.from(users.values()).filter(u => u.channel === channel).map(u => ({ nickname: u.nickname, color: u.color }));
      ws.send(JSON.stringify({ type: 'users', users: channelUsers }));

      broadcastToChannel(channel, { type: 'user_joined', nickname: user.nickname, color: user.color }, userId);
      break;
    }

    case 'message': {
      const user = users.get(userId);
      if (!user) return;

      const ch = channels.get(user.channel);
      if (ch) ch.last_activity = Date.now();

      const chatMsg = {
        id: uuidv4(), nickname: user.nickname, channel: user.channel,
        text: (msg.text || '').slice(0, 2000), color: user.color,
        timestamp: Date.now(),
      };

      if (!history.has(user.channel)) history.set(user.channel, []);
      history.get(user.channel).push(chatMsg);
      if (history.get(user.channel).length > MAX_HISTORY) history.get(user.channel).shift();

      broadcastToChannel(user.channel, { type: 'message', message: chatMsg }, userId);
      relay({ type: 'message', message: chatMsg });
      break;
    }

    case 'typing': {
      const user = users.get(userId);
      if (!user) return;
      broadcastToChannel(user.channel, { type: 'typing', nickname: user.nickname }, userId);
      break;
    }
  }
}

// ===== BROADCAST =====
function relay(msg) {
  broadcastAllLocal(msg);
  for (const peer of knownPeers) {
    fetch(`${peer}/federation/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: SERVER_NAME, msg }),
    }).catch(() => {});
  }
}

function broadcastAllLocal(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}

function broadcastToChannel(channelId, msg, excludeUserId) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const user = users.get(ws.userId);
    if (user && user.channel === channelId && ws.userId !== excludeUserId) ws.send(data);
  });
}

function broadcastChannelUsers(channelId) {
  const channelUsers = Array.from(users.values()).filter(u => u.channel === channelId).map(u => ({ nickname: u.nickname, color: u.color }));
  broadcastToChannel(channelId, { type: 'users', users: channelUsers });
}

function genColor(nick) {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = nick.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h % 360)}, 70%, 60%)`;
}

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Auto-delete inactive channels (24h)
setInterval(() => {
  const now = Date.now();
  channels.forEach((ch, id) => {
    if (id === 'general') return;
    if (now - ch.last_activity > 86400000) {
      channels.delete(id);
      history.delete(id);
      relay({ type: 'channel_deleted', channelId: id });
    }
  });
}, 60000);

// Start discovery
setTimeout(discoverPeers, 2000);

server.listen(PORT, () => {
  console.log(`TypoChat running on http://localhost:${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
  console.log(`Peers: ${knownPeers.size > 0 ? Array.from(knownPeers).join(', ') : 'none (add with PEERS=env)'}`);
});

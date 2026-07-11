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

const channels = new Map();
const users = new Map();
const history = new Map(); // channel -> last 50 messages
const MAX_HISTORY = 50;

channels.set('general', { id: 'general', name: 'Общий', icon: '💬', description: 'Главный чат', created_at: Date.now(), last_activity: Date.now() });

app.use(express.static('public'));

app.get('/api/channels', (req, res) => res.json(Array.from(channels.values())));
app.get('/api/stats', (req, res) => res.json({ users: users.size, channels: channels.size }));

app.get('/api/channels/:id/history', (req, res) => {
  const msgs = history.get(req.params.id) || [];
  res.json(msgs);
});

app.post('/api/channels', (req, res) => {
  const { name, icon, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '-').replace(/-+/g, '-');
  if (channels.has(id)) return res.status(409).json({ error: 'Channel exists' });
  const ch = { id, name, icon: icon || '💬', description: description || '', created_at: Date.now(), last_activity: Date.now() };
  channels.set(id, ch);
  broadcastAll({ type: 'channel_created', channel: ch });
  res.json(ch);
});

// Auto-delete inactive channels (24h)
setInterval(() => {
  const now = Date.now();
  channels.forEach((ch, id) => {
    if (id === 'general') return;
    if (now - ch.last_activity > 86400000) {
      channels.delete(id);
      history.delete(id);
      broadcastAll({ type: 'channel_deleted', channelId: id });
    }
  });
}, 60000);

// Federation
app.get('/federation/info', (req, res) => res.json({ name: 'TypoChat', version: '1.0.0', channels: channels.size, users: users.size }));
app.post('/federation/relay', (req, res) => {
  const { msg } = req.body;
  if (!msg) return res.status(400).json({ error: 'No message' });
  // Store in history
  if (msg.type === 'message' && msg.message) {
    const ch = msg.message.channel;
    if (!history.has(ch)) history.set(ch, []);
    history.get(ch).push(msg.message);
    if (history.get(ch).length > MAX_HISTORY) history.get(ch).shift();
  }
  // Broadcast to local clients
  if (msg.channel) {
    broadcastToChannel(msg.channel, msg);
  } else {
    broadcastAll(msg);
  }
  res.json({ ok: true });
});

// WebSocket
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

  ws.send(JSON.stringify({ type: 'welcome', userId }));
});

function handleMessage(ws, userId, msg) {
  switch (msg.type) {
    case 'join': {
      const { nickname, channel } = msg;
      if (!nickname || !channel || !channels.has(channel)) return;
      
      const user = { id: userId, nickname: nickname.slice(0, 20), channel, color: genColor(nickname) };
      users.set(userId, user);
      
      // Send history to joining user
      const msgs = history.get(channel) || [];
      ws.send(JSON.stringify({ type: 'history', channel, messages: msgs }));
      
      // Send current user list
      const channelUsers = Array.from(users.values())
        .filter(u => u.channel === channel)
        .map(u => ({ nickname: u.nickname, color: u.color }));
      ws.send(JSON.stringify({ type: 'users', users: channelUsers }));
      
      // Notify others
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
      
      // Store in history
      if (!history.has(user.channel)) history.set(user.channel, []);
      history.get(user.channel).push(chatMsg);
      if (history.get(user.channel).length > MAX_HISTORY) history.get(user.channel).shift();
      
      // Broadcast to others in channel
      broadcastToChannel(user.channel, { type: 'message', message: chatMsg }, userId);
      
      // Federation: relay to peers
      PEERS.forEach(peer => {
        fetch(`${peer}/federation/relay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: SERVER_NAME, msg: { type: 'message', message: chatMsg } }),
        }).catch(() => {});
      });
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

function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
  PEERS.forEach(peer => {
    fetch(`${peer}/federation/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: SERVER_NAME, msg }),
    }).catch(() => {});
  });
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

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log(`TypoChat running on http://localhost:${PORT}`));

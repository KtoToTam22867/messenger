const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 10e6 });

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname, size: req.file.size });
});

// ===== DATA =====
const users = new Map();
const channels = new Map();
const servers = new Map();
const voiceRooms = new Map();
const registered = new Map();

const SID = 'srv-1';

const defaultChannels = [
  { id: 'ch-general', name: 'общий', type: 'text' },
  { id: 'ch-memes', name: 'мемы', type: 'text' },
  { id: 'ch-music', name: 'музыка', type: 'text' },
  { id: 'ch-v1', name: 'Голосовой', type: 'voice' },
  { id: 'ch-v2', name: 'Музыка 🎵', type: 'voice' },
  { id: 'ch-v3', name: 'Игры 🎮', type: 'voice' }
];

defaultChannels.forEach(c => {
  channels.set(c.id, { id: c.id, name: c.name, type: c.type, serverId: SID, messages: [] });
  if (c.type === 'voice') voiceRooms.set(c.id, new Set());
});

servers.set(SID, {
  id: SID, name: 'Мой Сервер', icon: '🎮',
  ownerId: null,
  channelIds: defaultChannels.map(c => c.id),
  memberIds: []
});

// ===== HELPERS =====
function getServerPayload(srvId) {
  const s = servers.get(srvId);
  if (!s) return null;
  return { id: s.id, name: s.name, icon: s.icon };
}

function getChannelsPayload(srvId) {
  const s = servers.get(srvId);
  if (!s) return [];
  return s.channelIds.map(id => {
    const ch = channels.get(id);
    if (!ch) return null;
    return { id: ch.id, name: ch.name, type: ch.type, serverId: ch.serverId };
  }).filter(Boolean);
}

function membersList() {
  return Array.from(users.values()).map(u => ({
    id: u.id, username: u.username, color: u.color, avatarUrl: u.avatarUrl, status: u.status
  }));
}

function vcMembers(chId) {
  const room = voiceRooms.get(chId);
  if (!room) return [];
  return Array.from(room).map(sid => {
    const u = users.get(sid);
    if (!u) return null;
    return { id: u.id, username: u.username, color: u.color, avatarUrl: u.avatarUrl, socketId: sid, muted: !!u.muted };
  }).filter(Boolean);
}

function bcastVoice(chId) {
  io.to(SID).emit('voice-members-update', { channelId: chId, members: vcMembers(chId) });
}

function lvVoice(socket, chId) {
  const room = voiceRooms.get(chId);
  if (!room) return;
  room.delete(socket.id);
  socket.leave('vc-' + chId);
  socket.to('vc-' + chId).emit('voice-user-left', { channelId: chId, socketId: socket.id });
  bcastVoice(chId);
}

function doLogin(socket, userData, cb) {
  userData.socketId = socket.id;
  userData.muted = false;
  users.set(socket.id, userData);

  const srv = servers.get(SID);
  if (!srv.memberIds.includes(userData.id)) srv.memberIds.push(userData.id);

  socket.join(SID);
  srv.channelIds.forEach(id => socket.join(id));

  const voiceState = {};
  for (const [chId] of voiceRooms) {
    voiceState[chId] = vcMembers(chId);
  }

  // Отправляем ответ ДО broadcast чтобы клиент успел настроиться
  cb({
    ok: true,
    user: {
      id: userData.id,
      username: userData.username,
      color: userData.color,
      avatarUrl: userData.avatarUrl,
      status: userData.status
    },
    server: getServerPayload(SID),
    channels: getChannelsPayload(SID),
    members: membersList(),
    voiceState: voiceState
  });

  // Теперь оповещаем остальных
  io.to(SID).emit('user-joined', {
    id: userData.id, username: userData.username,
    color: userData.color, avatarUrl: userData.avatarUrl, status: userData.status
  });
  io.to(SID).emit('members-update', membersList());
}

// ===== SOCKET =====
io.on('connection', (socket) => {
  console.log('+ connected:', socket.id);

  // --- REGISTER ---
  socket.on('register', (data, cb) => {
    try {
      const { username, password, avatarUrl } = data;
      if (!username || !password) return cb({ ok: false, err: 'Заполните все поля' });
      if (registered.has(username.toLowerCase())) return cb({ ok: false, err: 'Имя уже занято' });

      const id = uuidv4();
      const color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      registered.set(username.toLowerCase(), { password, id, color, avatarUrl: avatarUrl || null, username });
      console.log('  registered:', username);
      cb({ ok: true });
    } catch (e) {
      console.error('register error:', e);
      cb({ ok: false, err: 'Ошибка сервера' });
    }
  });

  // --- LOGIN ---
  socket.on('login', (data, cb) => {
    try {
      const { username, password } = data;
      const r = registered.get(username.toLowerCase());
      if (!r || r.password !== password) return cb({ ok: false, err: 'Неверное имя или пароль' });

      console.log('  login:', r.username);
      doLogin(socket, {
        id: r.id, username: r.username, color: r.color,
        avatarUrl: r.avatarUrl, status: 'online'
      }, cb);
    } catch (e) {
      console.error('login error:', e);
      cb({ ok: false, err: 'Ошибка сервера' });
    }
  });

  // --- GUEST ---
  socket.on('guest-login', (data, cb) => {
    try {
      const { username, avatarUrl } = data;
      if (!username) return cb({ ok: false, err: 'Введите имя' });

      const id = uuidv4();
      const color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      console.log('  guest:', username);
      doLogin(socket, {
        id, username, color, avatarUrl: avatarUrl || null, status: 'online'
      }, cb);
    } catch (e) {
      console.error('guest error:', e);
      cb({ ok: false, err: 'Ошибка сервера' });
    }
  });

  // --- AVATAR ---
  socket.on('update-avatar', ({ avatarUrl }) => {
    const u = users.get(socket.id);
    if (!u) return;
    u.avatarUrl = avatarUrl;
    const r = registered.get(u.username.toLowerCase());
    if (r) r.avatarUrl = avatarUrl;
    io.to(SID).emit('members-update', membersList());
  });

  // --- MESSAGES ---
  socket.on('send-message', ({ channelId, content, imageUrl }) => {
    const u = users.get(socket.id);
    const ch = channels.get(channelId);
    if (!u || !ch) return;

    const msg = {
      id: uuidv4(),
      content: content || '',
      imageUrl: imageUrl || null,
      author: { id: u.id, username: u.username, color: u.color, avatarUrl: u.avatarUrl },
      timestamp: Date.now(),
      channelId,
      reactions: {},
      edited: false
    };

    ch.messages.push(msg);
    if (ch.messages.length > 500) ch.messages = ch.messages.slice(-500);
    io.to(channelId).emit('new-message', msg);
  });

  socket.on('edit-message', ({ messageId, channelId, content }) => {
    const u = users.get(socket.id);
    const ch = channels.get(channelId);
    if (!u || !ch) return;
    const m = ch.messages.find(x => x.id === messageId);
    if (m && m.author.id === u.id) {
      m.content = content;
      m.edited = true;
      io.to(channelId).emit('message-edited', { messageId, channelId, content });
    }
  });

  socket.on('delete-message', ({ messageId, channelId }) => {
    const u = users.get(socket.id);
    const ch = channels.get(channelId);
    if (!u || !ch) return;
    const i = ch.messages.findIndex(x => x.id === messageId);
    if (i !== -1 && ch.messages[i].author.id === u.id) {
      ch.messages.splice(i, 1);
      io.to(channelId).emit('message-deleted', { messageId, channelId });
    }
  });

  socket.on('add-reaction', ({ messageId, channelId, emoji }) => {
    const u = users.get(socket.id);
    const ch = channels.get(channelId);
    if (!u || !ch) return;
    const m = ch.messages.find(x => x.id === messageId);
    if (!m) return;
    if (!m.reactions[emoji]) m.reactions[emoji] = [];
    const i = m.reactions[emoji].indexOf(u.id);
    if (i === -1) m.reactions[emoji].push(u.id);
    else {
      m.reactions[emoji].splice(i, 1);
      if (!m.reactions[emoji].length) delete m.reactions[emoji];
    }
    io.to(channelId).emit('reaction-updated', { messageId, channelId, reactions: m.reactions });
  });

  socket.on('typing', ({ channelId }) => {
    const u = users.get(socket.id);
    if (u) socket.to(channelId).emit('user-typing', { channelId, username: u.username });
  });

  socket.on('get-messages', ({ channelId }, cb) => {
    const ch = channels.get(channelId);
    cb(ch ? ch.messages.slice(-100) : []);
  });

  // --- CHANNELS ---
  socket.on('create-channel', ({ name, type, serverId }, cb) => {
    const chId = 'ch-' + uuidv4().slice(0, 8);
    const ch = { id: chId, name, type: type || 'text', serverId, messages: [] };
    channels.set(chId, ch);

    const srv = servers.get(serverId);
    if (srv) {
      srv.channelIds.push(chId);
      if (type === 'voice') voiceRooms.set(chId, new Set());
      for (const [sid] of users) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.join(chId);
      }
      io.to(serverId).emit('channel-created', { id: ch.id, name: ch.name, type: ch.type, serverId: ch.serverId });
      if (cb) cb({ ok: true });
    }
  });

  // --- VOICE ---
  socket.on('join-voice', ({ channelId }) => {
    const u = users.get(socket.id);
    const room = voiceRooms.get(channelId);
    if (!u || !room) return;

    const existing = Array.from(room).map(s => {
      const usr = users.get(s);
      return usr ? {
        socketId: s,
        user: { id: usr.id, username: usr.username, color: usr.color, avatarUrl: usr.avatarUrl }
      } : null;
    }).filter(Boolean);

    room.add(socket.id);
    socket.join('vc-' + channelId);

    socket.emit('voice-peers', { channelId, peers: existing });

    socket.to('vc-' + channelId).emit('voice-user-joined', {
      channelId,
      socketId: socket.id,
      user: { id: u.id, username: u.username, color: u.color, avatarUrl: u.avatarUrl }
    });

    bcastVoice(channelId);
  });

  socket.on('leave-voice', ({ channelId }) => lvVoice(socket, channelId));

  socket.on('webrtc-offer', ({ to, offer, channelId }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer, channelId });
  });
  socket.on('webrtc-answer', ({ to, answer, channelId }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer, channelId });
  });
  socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
  });
  socket.on('webrtc-renegotiate-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-renegotiate-offer', { from: socket.id, offer });
  });
  socket.on('webrtc-renegotiate-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-renegotiate-answer', { from: socket.id, answer });
  });

  socket.on('screen-share-started', ({ channelId }) => {
    const u = users.get(socket.id);
    if (u) socket.to('vc-' + channelId).emit('peer-screen-share', {
      socketId: socket.id, username: u.username, sharing: true
    });
  });

  socket.on('screen-share-stopped', ({ channelId }) => {
    socket.to('vc-' + channelId).emit('peer-screen-share', { socketId: socket.id, sharing: false });
  });

  socket.on('toggle-mute', ({ channelId, muted }) => {
    const u = users.get(socket.id);
    if (u) {
      u.muted = muted;
      socket.to('vc-' + channelId).emit('peer-mute-toggle', { socketId: socket.id, muted });
      bcastVoice(channelId);
    }
  });

  socket.on('toggle-video', ({ channelId, videoOn }) => {
    socket.to('vc-' + channelId).emit('peer-video-toggle', { socketId: socket.id, videoOn });
  });

  // --- STATUS ---
  socket.on('set-status', ({ status }) => {
    const u = users.get(socket.id);
    if (u) { u.status = status; io.to(SID).emit('members-update', membersList()); }
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if (u) {
      for (const [chId, room] of voiceRooms) {
        if (room.has(socket.id)) lvVoice(socket, chId);
      }
      users.delete(socket.id);
      io.to(SID).emit('user-left', { id: u.id, username: u.username });
      io.to(SID).emit('members-update', membersList());
      console.log('- disconnected:', u.username);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  Discord Clone v3.1 → http://localhost:${PORT}\n`);
});
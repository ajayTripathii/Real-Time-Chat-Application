const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  // detect dead connections faster so online/offline status stays accurate
  pingInterval: 10000,
  pingTimeout: 8000,
});

const users = [
  ['ajay', 'Ajay Tripathi', 'AT'],
  ['rahul', 'Rahul Sharma', 'RS'],
  ['priya', 'Priya Verma', 'PV'],
  ['amit', 'Amit Kumar', 'AK'],
  ['neha', 'Neha Singh', 'NS'],
].map(([id, name, initials]) => ({ id, name, initials }));

// ---- In-memory state (resets when the server restarts) ----
const messages = [];            // { id, senderId, receiverId, text, time, status, deletedForEveryone, deletedFor[] }
const sockets = new Map();      // userId -> Set(socket.id)   (one user can have many tabs)
const announced = new Set();    // users currently shown as "online" to everybody
const lastSeen = {};            // userId -> ISO time
const offlineTimers = new Map();
const OFFLINE_GRACE_MS = 3000;  // page refresh / quick reconnect should not flicker to offline

const isConnected = (id) => (sockets.get(id)?.size || 0) > 0;
const involves = (m, id) => m.senderId === id || m.receiverId === id;
const toBoth = (a, b) => io.to(a).to(b);

// what the browser is allowed to see of a message
const pub = (m) => ({
  id: m.id,
  senderId: m.senderId,
  receiverId: m.receiverId,
  text: m.deletedForEveryone ? '' : m.text,
  time: m.time,
  status: m.status,           // sent -> delivered -> read
  deleted: m.deletedForEveryone,
});

app.get('/api/health', (q, s) => s.json({ ok: true }));
app.get('/api/users', (q, s) => s.json(users));

io.on('connection', (socket) => {
  // ---------- join / presence ----------
  socket.on('join', (id) => {
    if (!users.some((u) => u.id === id)) return;
    socket.data.userId = id;
    socket.join(id);
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id).add(socket.id);
    clearTimeout(offlineTimers.get(id));
    offlineTimers.delete(id);

    // messages sent while this user was offline are now DELIVERED
    const bySender = {};
    messages.forEach((m) => {
      if (m.receiverId === id && m.status === 'sent') {
        m.status = 'delivered';
        (bySender[m.senderId] ||= []).push(m.id);
      }
    });
    Object.entries(bySender).forEach(([senderId, ids]) =>
      io.to(senderId).emit('status_update', { ids, status: 'delivered' })
    );

    socket.emit('initial_data', {
      users,
      online: [...announced],
      lastSeen,
      messages: messages.filter((m) => involves(m, id) && !m.deletedFor.includes(id)).map(pub),
    });

    if (!announced.has(id)) {
      announced.add(id);
      io.emit('presence', { userId: id, online: true });
    }
  });

  // ---------- send ----------
  // The client generates the id, so re-sending after a reconnect never creates duplicates.
  socket.on('send_message', ({ id, receiverId, text } = {}, ack) => {
    const senderId = socket.data.userId;
    const body = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
    if (!senderId || senderId === receiverId || !users.some((u) => u.id === receiverId) || !body) {
      return ack?.({ ok: false });
    }
    const wantedId = typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
    let m = wantedId ? messages.find((x) => x.id === wantedId) : null;
    if (m && m.senderId !== senderId) return ack?.({ ok: false });

    if (!m) {
      m = {
        id: wantedId || Date.now() + '-' + Math.random().toString(16).slice(2),
        senderId,
        receiverId,
        text: body,
        time: new Date().toISOString(),
        status: isConnected(receiverId) ? 'delivered' : 'sent',
        deletedForEveryone: false,
        deletedFor: [],
      };
      messages.push(m);
      toBoth(senderId, receiverId).emit('message_update', pub(m));
    }
    ack?.({ ok: true, message: pub(m) });
  });

  // ---------- read receipts ----------
  socket.on('mark_read', ({ senderId } = {}) => {
    const readerId = socket.data.userId;
    if (!readerId || !senderId) return;
    const ids = [];
    messages.forEach((m) => {
      if (m.senderId === senderId && m.receiverId === readerId && m.status !== 'read') {
        m.status = 'read';
        ids.push(m.id);
      }
    });
    if (ids.length) toBoth(senderId, readerId).emit('status_update', { ids, status: 'read' });
  });

  // ---------- delete (for me / for everyone) ----------
  socket.on('delete_message', ({ id, scope } = {}, ack) => {
    const userId = socket.data.userId;
    const m = messages.find((x) => x.id === id && involves(x, userId));
    if (!m) return ack?.({ ok: false });

    if (scope === 'everyone') {
      if (m.senderId !== userId) return ack?.({ ok: false }); // only the sender can delete for everyone
      m.deletedForEveryone = true;
      m.text = '';
      toBoth(m.senderId, m.receiverId).emit('message_deleted', { id, scope: 'everyone' });
    } else {
      if (!m.deletedFor.includes(userId)) m.deletedFor.push(userId);
      io.to(userId).emit('message_deleted', { id, scope: 'me' });
      if (m.deletedFor.length >= 2) messages.splice(messages.indexOf(m), 1); // both removed it
    }
    ack?.({ ok: true });
  });

  // ---------- disconnect ----------
  socket.on('disconnect', () => {
    const id = socket.data.userId;
    if (!id) return;
    const set = sockets.get(id);
    set?.delete(socket.id);
    if (set && set.size) return; // still connected from another tab
    sockets.delete(id);
    const seen = new Date().toISOString();
    offlineTimers.set(
      id,
      setTimeout(() => {
        offlineTimers.delete(id);
        if (isConnected(id)) return;
        announced.delete(id);
        lastSeen[id] = seen;
        io.emit('presence', { userId: id, online: false, lastSeen: seen });
      }, OFFLINE_GRACE_MS)
    );
  });
});

server.listen(PORT, () => console.log(`Connectly server running at http://localhost:${PORT}`));

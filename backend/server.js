
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 12e6,
});

const USERS = [
  "ryan",
  "jasprit",
  "rohit",
  "sherphan",
  "tilak",
];

// Demo storage: data server memory mein rahega.
let messages = [];

const userSockets = new Map();
const lastSeen = {};

function getOnlineUsers() {
  return [...userSockets.entries()]
    .filter(([, sockets]) => sockets.size > 0)
    .map(([userId]) => userId);
}

function getUserMessages(userId) {
  return messages.filter(
    (message) =>
      (message.senderId === userId ||
        message.receiverId === userId) &&
      !(message.hiddenFor || []).includes(userId)
  );
}

function emitPresence(userId, online) {
  io.emit("presence", {
    userId,
    online,
    lastSeen: lastSeen[userId] || null,
  });
}

function updateStatus(messageIds, status) {
  const ids = [];

  messages = messages.map((message) => {
    if (
      messageIds.includes(message.id) &&
      message.status !== status
    ) {
      ids.push(message.id);
      return { ...message, status };
    }

    return message;
  });

  if (ids.length) {
    const affected = messages.filter((m) => ids.includes(m.id));

    const senders = [...new Set(affected.map((m) => m.senderId))];

    senders.forEach((senderId) => {
      io.to(`user:${senderId}`).emit("status_update", {
        ids,
        status,
      });
    });
  }
}

// Basic health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "UDTConnect server running",
  });
});

// Socket events
io.on("connection", (socket) => {
  let currentUser = null;

  socket.on("join", (userId) => {
    if (!USERS.includes(userId)) return;

    currentUser = userId;

    socket.join(`user:${userId}`);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    const sockets = userSockets.get(userId);
    const wasOffline = sockets.size === 0;

    sockets.add(socket.id);

    if (wasOffline) {
      emitPresence(userId, true);
    }

    socket.emit("initial_data", {
      messages: getUserMessages(userId),
      online: getOnlineUsers(),
      lastSeen,
    });

    // Messages delivered when recipient comes online
    const waiting = messages
      .filter(
        (message) =>
          message.receiverId === userId &&
          message.status === "sent" &&
          !(message.hiddenFor || []).includes(userId)
      )
      .map((message) => message.id);

    updateStatus(waiting, "delivered");
  });

  socket.on("send_message", (data, callback) => {
    if (!currentUser) {
      return callback?.({
        ok: false,
        message: "Please login first.",
      });
    }

    if (
      !data ||
      !data.id ||
      !USERS.includes(data.receiverId) ||
      data.receiverId === currentUser
    ) {
      return callback?.({
        ok: false,
        message: "Invalid message details.",
      });
    }

    if (
      !data.text?.trim() &&
      !data.file
    ) {
      return callback?.({
        ok: false,
        message: "Message is empty.",
      });
    }

    if (messages.some((m) => m.id === data.id)) {
      return callback?.({
        ok: false,
        message: "Duplicate message.",
      });
    }

    const receiverOnline =
      (userSockets.get(data.receiverId)?.size || 0) > 0;

    const message = {
      id: data.id,
      senderId: currentUser,
      receiverId: data.receiverId,
      text: data.text || "",
      file: data.file || null,
      time: new Date().toISOString(),
      status: receiverOnline ? "delivered" : "sent",
      deleted: false,
      hiddenFor: [],
    };

    messages.push(message);

    // Sender gets confirmed message
    io.to(`user:${currentUser}`).emit("message_update", message);

    // Receiver gets the message
    io.to(`user:${data.receiverId}`).emit("message_update", message);

    callback?.({
      ok: true,
      message,
    });
  });

  // Mark messages as read
  socket.on("mark_read", ({ senderId } = {}) => {
    if (!currentUser || !USERS.includes(senderId)) return;

    const ids = messages
      .filter(
        (message) =>
          message.senderId === senderId &&
          message.receiverId === currentUser &&
          message.status !== "read" &&
          !(message.hiddenFor || []).includes(currentUser)
      )
      .map((message) => message.id);

    updateStatus(ids, "read");
  });

  // Delete for me / everyone
  socket.on("delete_message", ({ id, scope } = {}, callback) => {
    if (!currentUser || !id) {
      return callback?.({
        ok: false,
        message: "Invalid delete request.",
      });
    }

    const message = messages.find((m) => m.id === id);

    if (!message) {
      return callback?.({
        ok: false,
        message: "Message not found.",
      });
    }

    const isParticipant =
      message.senderId === currentUser ||
      message.receiverId === currentUser;

    if (!isParticipant) {
      return callback?.({
        ok: false,
        message: "You cannot delete this message.",
      });
    }

    if (scope === "me") {
      if (!message.hiddenFor) message.hiddenFor = [];

      if (!message.hiddenFor.includes(currentUser)) {
        message.hiddenFor.push(currentUser);
      }

      io.to(`user:${currentUser}`).emit("message_deleted", {
        id,
        scope: "me",
      });

      return callback?.({ ok: true });
    }

    if (scope === "everyone") {
      if (message.senderId !== currentUser) {
        return callback?.({
          ok: false,
          message: "Only sender can delete for everyone.",
        });
      }

      message.deleted = true;
      message.text = "";
      message.file = null;

      io.to(`user:${message.senderId}`).emit("message_deleted", {
        id,
        scope: "everyone",
      });

      io.to(`user:${message.receiverId}`).emit("message_deleted", {
        id,
        scope: "everyone",
      });

      return callback?.({ ok: true });
    }

    callback?.({
      ok: false,
      message: "Invalid delete option.",
    });
  });

  socket.on("disconnect", () => {
    if (!currentUser) return;

    const sockets = userSockets.get(currentUser);

    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        userSockets.delete(currentUser);

        lastSeen[currentUser] = new Date().toISOString();

        emitPresence(currentUser, false);
      }
    }
  });
});

// Serve React production build
const frontendPath = path.join(__dirname, "../frontend/dist");

if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      return next();
    }

    res.sendFile(path.join(frontendPath, "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UDTConnect server running on port ${PORT}`);
});

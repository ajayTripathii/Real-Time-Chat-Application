
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "12mb" }));

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  maxHttpBufferSize: 12e6,
});

const USERS = [
  { id: "ryan", name: "Ryan Rickelton", initials: "RR" },
  { id: "jasprit", name: "Jasprit Bumrah", initials: "JB" },
  { id: "rohit", name: "Rohit Sharma", initials: "RS" },
  { id: "sherphan", name: "Sherphan Rutherford", initials: "SR" },
  { id: "tilak", name: "Tilak Verma", initials: "TV" },
];

let messages = [];
const userSockets = new Map();
const lastSeen = {};
const calls = new Map();
const missedCalls = new Map();

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "chat-data.json");

function loadData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      messages = saved.messages || [];

      Object.entries(saved.missedCalls || {}).forEach(([id, list]) => {
        missedCalls.set(id, list);
      });

      Object.assign(lastSeen, saved.lastSeen || {});
    }

    console.log("Chat and call history loaded.");
  } catch (error) {
    console.error("Data load error:", error);
  }
}

function saveData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const missed = Object.fromEntries(missedCalls.entries());

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ messages, missedCalls: missed, lastSeen }, null, 2)
    );
  } catch (error) {
    console.error("Data save error:", error);
  }
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidUser(id) {
  return USERS.some((user) => user.id === id);
}

function getOnlineUsers() {
  return [...userSockets.keys()];
}

function getUserMessages(userId) {
  return messages.filter(
    (message) =>
      (message.senderId === userId || message.receiverId === userId) &&
      !message.deletedFor?.includes(userId)
  );
}

function emitPresence() {
  USERS.forEach((user) => {
    io.emit("presence", {
      userId: user.id,
      online: userSockets.has(user.id),
      lastSeen: lastSeen[user.id] || null,
    });
  });
}

function updateMessageStatus(message, status) {
  if (!message || message.status === "read") return;
  if (message.status === "delivered" && status === "sent") return;

  message.status = status;

  const payload = { ids: [message.id], status };

  io.to(message.senderId).emit("status_update", payload);
  io.to(message.receiverId).emit("status_update", payload);
  io.to(message.senderId).emit("message_update", message);
  io.to(message.receiverId).emit("message_update", message);
}

function addMissedCall(userId, callData) {
  if (!missedCalls.has(userId)) missedCalls.set(userId, []);

  const list = missedCalls.get(userId);
  if (!list.some((item) => item.callId === callData.callId)) {
    list.push(callData);
    missedCalls.set(userId, list);
    saveData();
  }
}

function getCallPeer(call, userId) {
  return call.callerId === userId ? call.receiverId : call.callerId;
}

function finishCall(callId, reason = "ended", endedBy = null) {
  const call = calls.get(callId);
  if (!call) return;

  const peerId = endedBy ? getCallPeer(call, endedBy) : null;

  if (!call.connected && reason !== "rejected") {
    const missedUser = call.callerId;
    const missedPayload = {
      callId: call.callId,
      callerId: call.callerId,
      callType: call.callType,
      time: call.time,
    };

    if (missedUser !== endedBy) addMissedCall(missedUser, missedPayload);
  }

  io.to(call.callerId).emit("call_ended", {
    callId,
    reason,
  });

  io.to(call.receiverId).emit("call_ended", {
    callId,
    reason,
  });

  if (peerId) {
    io.to(peerId).emit("call_ended", {
      callId,
      reason,
    });
  }

  calls.delete(callId);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "UDTConnect server running" });
});

app.get("/api/users", (req, res) => {
  res.json(USERS);
});

app.get("/api/messages", (req, res) => {
  const { user1, user2 } = req.query;

  if (!user1 || !user2) {
    return res.status(400).json({ error: "user1 and user2 are required" });
  }

  const result = messages.filter(
    (message) =>
      !message.deletedFor?.includes(user1) &&
      (
        (message.senderId === user1 && message.receiverId === user2) ||
        (message.senderId === user2 && message.receiverId === user1)
      )
  );

  res.json(result);
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join", (userId) => {
    if (!isValidUser(userId)) return;

    socket.userId = userId;
    socket.join(userId);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId).add(socket.id);

    socket.emit("initial_data", {
      online: getOnlineUsers(),
      lastSeen,
      messages: getUserMessages(userId),
    });

    emitPresence();

    messages.forEach((message) => {
      if (message.receiverId === userId && message.status === "sent") {
        updateMessageStatus(message, "delivered");
      }
    });

    // Deliver queued offline missed calls.
    const queuedCalls = missedCalls.get(userId) || [];

    queuedCalls.forEach((item) => {
      socket.emit("missed_call", item);
    });

    if (queuedCalls.length) {
      missedCalls.delete(userId);
      saveData();
    }

    console.log(userId, "joined");
  });

  // ---------------- MESSAGES ----------------

  socket.on("send_message", (data, callback) => {
    if (
      !data ||
      !data.senderId ||
      !data.receiverId ||
      socket.userId !== data.senderId ||
      !isValidUser(data.receiverId)
    ) {
      callback?.({ ok: false, message: "Invalid message data" });
      return;
    }

    const existing = messages.find((m) => m.id === data.id);

    if (existing) {
      callback?.({ ok: true, message: existing });
      return;
    }

    const message = {
      id: data.id || newId(),
      senderId: data.senderId,
      receiverId: data.receiverId,
      text: data.text || "",
      file: data.file || null,
      time: data.time || new Date().toISOString(),
      status: "sent",
      deleted: false,
      deletedFor: [],
    };

    messages.push(message);

    if (userSockets.has(message.receiverId)) {
      message.status = "delivered";
    }

    io.to(message.senderId).emit("message_update", message);
    io.to(message.receiverId).emit("message_update", message);

    saveData();
    callback?.({ ok: true, message });
  });

  socket.on("mark_read", (data) => {
    if (!data?.senderId || !socket.userId) return;

    const receiverId = socket.userId;
    const senderId = data.senderId;

    const readMessages = messages.filter(
      (message) =>
        message.senderId === senderId &&
        message.receiverId === receiverId &&
        message.status !== "read" &&
        !message.deleted
    );

    if (!readMessages.length) return;

    readMessages.forEach((message) => {
      message.status = "read";
    });

    const payload = {
      ids: readMessages.map((message) => message.id),
      status: "read",
    };

    io.to(senderId).emit("status_update", payload);
    io.to(receiverId).emit("status_update", payload);
    saveData();
  });

  socket.on("delete_message", (data, callback) => {
    if (!data?.id || !socket.userId) {
      callback?.({ ok: false, message: "Invalid delete request" });
      return;
    }

    const message = messages.find((m) => m.id === data.id);

    if (!message) {
      callback?.({ ok: false, message: "Message not found" });
      return;
    }

    const userId = socket.userId;

    if (data.scope === "everyone") {
      if (message.senderId !== userId) {
        callback?.({
          ok: false,
          message: "Only the sender can delete for everyone",
        });
        return;
      }

      message.deleted = true;
      message.text = "";
      message.file = null;

      const payload = { id: message.id, scope: "everyone" };

      io.to(message.senderId).emit("message_deleted", payload);
      io.to(message.receiverId).emit("message_deleted", payload);
    } else {
      if (!message.deletedFor.includes(userId)) {
        message.deletedFor.push(userId);
      }

      socket.emit("message_deleted", {
        id: message.id,
        scope: "me",
      });
    }

    saveData();
    callback?.({ ok: true });
  });

  // ---------------- AUDIO / VIDEO CALLS ----------------

  socket.on("call_user", (data = {}, callback) => {
    const callerId = socket.userId;
    const receiverId = data.to;
    const callType = data.callType === "video" ? "video" : "audio";

    if (
      !callerId ||
      !receiverId ||
      callerId === receiverId ||
      !isValidUser(receiverId)
    ) {
      callback?.({ ok: false, message: "Invalid call request" });
      return;
    }

    const callId = data.callId || newId();

    const call = {
      callId,
      callerId,
      receiverId,
      callType,
      time: new Date().toISOString(),
      connected: false,
    };

    // Offline recipient: save missed call for their next login.
    if (!userSockets.has(receiverId)) {
      addMissedCall(receiverId, {
        callId,
        callerId,
        callType,
        time: call.time,
      });

      callback?.({
        ok: false,
        offline: true,
        callId,
        message: "User is offline. Missed call saved.",
      });

      return;
    }

    calls.set(callId, call);

    io.to(receiverId).emit("incoming_call", {
      callId,
      from: callerId,
      callerId,
      callType,
      type: callType,
      callerName: USERS.find((u) => u.id === callerId)?.name || callerId,
    });

    callback?.({ ok: true, callId });
    console.log("Call ringing:", callerId, "->", receiverId);
  });

  socket.on("accept_call", (data = {}, callback) => {
    const call = calls.get(data.callId);

    if (!call || socket.userId !== call.receiverId) {
      callback?.({ ok: false, message: "Call not found" });
      return;
    }

    call.accepted = true;

    io.to(call.callerId).emit("call_accepted", {
      callId: call.callId,
    });

    callback?.({ ok: true, callId: call.callId });
  });

  socket.on("reject_call", (data = {}, callback) => {
    const call = calls.get(data.callId);

    if (!call || socket.userId !== call.receiverId) {
      callback?.({ ok: false, message: "Call not found" });
      return;
    }

    io.to(call.callerId).emit("call_rejected", {
      callId: call.callId,
      reason: "rejected",
    });

    io.to(call.callerId).emit("call_ended", {
      callId: call.callId,
      reason: "rejected",
    });

    io.to(call.receiverId).emit("call_ended", {
      callId: call.callId,
      reason: "rejected",
    });

    calls.delete(call.callId);
    callback?.({ ok: true });
  });

  socket.on("end_call", (data = {}, callback) => {
    const call = calls.get(data.callId);

    if (!call || ![call.callerId, call.receiverId].includes(socket.userId)) {
      callback?.({ ok: false, message: "Call not found" });
      return;
    }

    finishCall(call.callId, "ended", socket.userId);
    callback?.({ ok: true });
  });

  socket.on("webrtc_offer", (data = {}) => {
    const call = calls.get(data.callId);
    if (!call || !data.offer) return;

    const peerId = getCallPeer(call, socket.userId);
    if (!peerId) return;

    io.to(peerId).emit("webrtc_offer", {
      callId: data.callId,
      offer: data.offer,
    });
  });

  socket.on("webrtc_answer", (data = {}) => {
    const call = calls.get(data.callId);
    if (!call || !data.answer) return;

    call.connected = true;

    const peerId = getCallPeer(call, socket.userId);
    if (!peerId) return;

    io.to(peerId).emit("webrtc_answer", {
      callId: data.callId,
      answer: data.answer,
    });
  });

  socket.on("ice_candidate", (data = {}) => {
    const call = calls.get(data.callId);
    if (!call || !data.candidate) return;

    const peerId = getCallPeer(call, socket.userId);
    if (!peerId) return;

    io.to(peerId).emit("ice_candidate", {
      callId: data.callId,
      candidate: data.candidate,
    });
  });

  // ---------------- DISCONNECT ----------------

  socket.on("disconnect", () => {
    const userId = socket.userId;
    if (!userId || !userSockets.has(userId)) return;

    const sockets = userSockets.get(userId);
    sockets.delete(socket.id);

    if (sockets.size === 0) {
      userSockets.delete(userId);
      lastSeen[userId] = new Date().toISOString();

      // End calls involving the disconnected user.
      for (const [callId, call] of calls.entries()) {
        if (call.callerId === userId || call.receiverId === userId) {
          const peerId = getCallPeer(call, userId);

          if (!call.connected && call.callerId === userId) {
            addMissedCall(call.receiverId, {
              callId,
              callerId: call.callerId,
              callType: call.callType,
              time: call.time,
            });
          }

          io.to(peerId).emit("call_ended", {
            callId,
            reason: "disconnected",
          });

          calls.delete(callId);
        }
      }
    }

    emitPresence();
    saveData();

    console.log("Disconnected:", userId);
  });
});

// ---------------- FRONTEND ----------------

const frontendDist = path.join(__dirname, "../frontend/dist");

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/socket.io/")
    ) {
      return next();
    }

    res.sendFile(path.join(frontendDist, "index.html"));
  });

  console.log("React frontend found:", frontendDist);
} else {
  app.get("/", (req, res) => {
    res.send("UDTConnect backend is running. Frontend build not found.");
  });
}

loadData();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UDTConnect running on port ${PORT}`);
});

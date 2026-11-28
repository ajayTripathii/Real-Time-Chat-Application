
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

// Active WebRTC calls
const activeCalls = new Map();

// =====================================
// HELPER FUNCTIONS
// =====================================

function getOnlineUsers() {
  return [...userSockets.keys()];
}

function getUserMessages(userId) {
  return messages.filter(
    (message) =>
      (message.senderId === userId ||
        message.receiverId === userId) &&
      !message.deletedFor?.includes(userId)
  );
}

function emitPresence() {
  io.emit("presence", {
    online: false,
  });

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

  if (message.status === "delivered" && status === "sent") {
    return;
  }

  message.status = status;

  const payload = {
    ids: [message.id],
    status,
  };

  io.to(message.senderId).emit("status_update", payload);
  io.to(message.receiverId).emit("status_update", payload);

  io.to(message.senderId).emit("message_update", message);
  io.to(message.receiverId).emit("message_update", message);
}

// Get valid call
function getCall(callId, userId) {
  const call = activeCalls.get(callId);

  if (!call) return null;

  if (
    call.callerId !== userId &&
    call.receiverId !== userId
  ) {
    return null;
  }

  return call;
}

// End active call
function endActiveCall(callId, endedBy) {
  const call = activeCalls.get(callId);

  if (!call) return;

  const otherUser =
    call.callerId === endedBy
      ? call.receiverId
      : call.callerId;

  io.to(otherUser).emit("call_ended", {
    callId,
    endedBy,
  });

  activeCalls.delete(callId);
}

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "UDTConnect server running",
  });
});

// =====================================
// USERS API
// =====================================

app.get("/api/users", (req, res) => {
  res.json(USERS);
});

// =====================================
// MESSAGES API
// =====================================

app.get("/api/messages", (req, res) => {
  const { user1, user2 } = req.query;

  if (!user1 || !user2) {
    return res.status(400).json({
      error: "user1 and user2 are required",
    });
  }

  const result = messages.filter(
    (message) =>
      !message.deletedFor?.includes(user1) &&
      (
        (message.senderId === user1 &&
          message.receiverId === user2) ||
        (message.senderId === user2 &&
          message.receiverId === user1)
      )
  );

  res.json(result);
});

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // =====================================
  // JOIN USER
  // =====================================

  socket.on("join", (userId) => {
    if (!USERS.some((user) => user.id === userId)) {
      return;
    }

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
      if (
        message.receiverId === userId &&
        message.status === "sent"
      ) {
        updateMessageStatus(message, "delivered");
      }
    });

    console.log(userId, "joined");
  });

  // =====================================
  // SEND MESSAGE
  // =====================================

  socket.on("send_message", (data, callback) => {
    if (!data || !data.senderId || !data.receiverId) {
      return callback?.({
        ok: false,
        message: "Invalid message data",
      });
    }

    if (socket.userId !== data.senderId) {
      return callback?.({
        ok: false,
        message: "Sender account mismatch",
      });
    }

    const existing = messages.find(
      (message) => message.id === data.id
    );

    if (existing) {
      return callback?.({
        ok: true,
        message: existing,
      });
    }

    const message = {
      id: data.id || `${Date.now()}-${Math.random()}`,
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

    callback?.({
      ok: true,
      message,
    });

    console.log("Message sent:", message.id);
  });

  // =====================================
  // MARK MESSAGE AS READ
  // =====================================

  socket.on("mark_read", (data) => {
    if (!data || !data.senderId || !socket.userId) return;

    const receiverId = socket.userId;
    const senderId = data.senderId;

    const readMessages = messages.filter(
      (message) =>
        message.senderId === senderId &&
        message.receiverId === receiverId &&
        message.status !== "read" &&
        !message.deleted
    );

    if (readMessages.length === 0) return;

    readMessages.forEach((message) => {
      message.status = "read";
    });

    const payload = {
      ids: readMessages.map((message) => message.id),
      status: "read",
    };

    io.to(senderId).emit("status_update", payload);
    io.to(receiverId).emit("status_update", payload);

    console.log("Messages read:", payload.ids.length);
  });

  // =====================================
  // DELETE MESSAGE
  // =====================================

  socket.on("delete_message", (data, callback) => {
    if (!data || !data.id || !socket.userId) {
      return callback?.({
        ok: false,
        message: "Invalid delete request",
      });
    }

    const message = messages.find(
      (item) => item.id === data.id
    );

    if (!message) {
      return callback?.({
        ok: false,
        message: "Message not found",
      });
    }

    const userId = socket.userId;

    if (data.scope === "everyone") {
      if (message.senderId !== userId) {
        return callback?.({
          ok: false,
          message: "Only sender can delete for everyone",
        });
      }

      message.deleted = true;
      message.text = "";
      message.file = null;

      const payload = {
        id: message.id,
        scope: "everyone",
      };

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

    callback?.({ ok: true });

    console.log("Message deleted:", message.id);
  });

  // =====================================
  // WEBRTC AUDIO / VIDEO CALLING
  // =====================================

  // START CALL
  socket.on("call_user", (data, callback) => {
    const callerId = socket.userId;
    const receiverId = data?.to;

    if (!callerId || !receiverId || callerId === receiverId) {
      return callback?.({
        ok: false,
        message: "Invalid call request",
      });
    }

    if (!USERS.some((user) => user.id === receiverId)) {
      return callback?.({
        ok: false,
        message: "User not found",
      });
    }

    if (!userSockets.has(receiverId)) {
      return callback?.({
        ok: false,
        message: "User is offline",
      });
    }

    const alreadyCalling = [...activeCalls.values()].some(
      (call) =>
        call.callerId === callerId ||
        call.receiverId === callerId ||
        call.callerId === receiverId ||
        call.receiverId === receiverId
    );

    if (alreadyCalling) {
      return callback?.({
        ok: false,
        message: "User is already in a call",
      });
    }

    const caller = USERS.find(
      (user) => user.id === callerId
    );

    const callId =
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const callType =
      data.callType === "audio" ? "audio" : "video";

    const call = {
      callId,
      callerId,
      receiverId,
      callType,
      status: "ringing",
      createdAt: new Date().toISOString(),
    };

    activeCalls.set(callId, call);

    io.to(receiverId).emit("incoming_call", {
      callId,
      from: callerId,
      callerName: caller?.name || callerId,
      callType,
    });

    callback?.({
      ok: true,
      callId,
      message: "Calling...",
    });

    console.log("Call started:", callerId, receiverId);
  });

  // ACCEPT CALL
  socket.on("accept_call", (data, callback) => {
    const call = activeCalls.get(data?.callId);

    if (
      !call ||
      call.receiverId !== socket.userId ||
      call.status !== "ringing"
    ) {
      return callback?.({
        ok: false,
        message: "Invalid or expired call",
      });
    }

    call.status = "accepted";

    io.to(call.callerId).emit("call_accepted", {
      callId: call.callId,
      from: socket.userId,
    });

    callback?.({ ok: true });

    console.log("Call accepted:", call.callId);
  });

  // REJECT CALL
  socket.on("reject_call", (data, callback) => {
    const call = activeCalls.get(data?.callId);

    if (
      !call ||
      call.receiverId !== socket.userId ||
      call.status !== "ringing"
    ) {
      return callback?.({
        ok: false,
        message: "Invalid call",
      });
    }

    io.to(call.callerId).emit("call_rejected", {
      callId: call.callId,
      from: socket.userId,
    });

    activeCalls.delete(call.callId);

    callback?.({ ok: true });

    console.log("Call rejected:", call.callId);
  });

  // WEBRTC OFFER
  socket.on("webrtc_offer", (data) => {
    const call = getCall(data?.callId, socket.userId);

    if (
      !call ||
      call.callerId !== socket.userId ||
      call.status !== "accepted" ||
      !data.offer
    ) return;

    io.to(call.receiverId).emit("webrtc_offer", {
      callId: call.callId,
      offer: data.offer,
      from: socket.userId,
    });
  });

  // WEBRTC ANSWER
  socket.on("webrtc_answer", (data) => {
    const call = getCall(data?.callId, socket.userId);

    if (
      !call ||
      call.receiverId !== socket.userId ||
      call.status !== "accepted" ||
      !data.answer
    ) return;

    io.to(call.callerId).emit("webrtc_answer", {
      callId: call.callId,
      answer: data.answer,
      from: socket.userId,
    });
  });

  // ICE CANDIDATE
  socket.on("ice_candidate", (data) => {
    const call = getCall(data?.callId, socket.userId);

    if (
      !call ||
      call.status !== "accepted" ||
      !data.candidate
    ) return;

    const otherUser =
      call.callerId === socket.userId
        ? call.receiverId
        : call.callerId;

    io.to(otherUser).emit("ice_candidate", {
      callId: call.callId,
      candidate: data.candidate,
      from: socket.userId,
    });
  });

  // END CALL
  socket.on("end_call", (data, callback) => {
    const call = getCall(data?.callId, socket.userId);

    if (!call) {
      return callback?.({
        ok: false,
        message: "Call not found",
      });
    }

    endActiveCall(data.callId, socket.userId);

    callback?.({ ok: true });

    console.log("Call ended:", data.callId);
  });

  // =====================================
  // DISCONNECT
  // =====================================

  socket.on("disconnect", () => {
    const userId = socket.userId;

    if (!userId) return;

    // End active calls
    for (const [callId, call] of activeCalls.entries()) {
      if (
        call.callerId === userId ||
        call.receiverId === userId
      ) {
        endActiveCall(callId, userId);
      }
    }

    if (!userSockets.has(userId)) return;

    const sockets = userSockets.get(userId);
    sockets.delete(socket.id);

    if (sockets.size === 0) {
      userSockets.delete(userId);
      lastSeen[userId] = new Date().toISOString();
    }

    emitPresence();

    console.log("Disconnected:", userId);
  });
});

// =====================================
// SERVE REACT FRONTEND
// =====================================

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
  console.log("Frontend dist folder not found:", frontendDist);

  app.get("/", (req, res) => {
    res.send(
      "UDTConnect backend is running. Frontend build not found."
    );
  });
}

// =====================================
// START SERVER
// =====================================

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UDTConnect running on port ${PORT}`);
});

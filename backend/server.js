
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

  if (message.status === "delivered" && status === "sent") return;

  message.status = status;

  const senderSockets = io.to(message.senderId);
  const receiverSockets = io.to(message.receiverId);

  const payload = {
    ids: [message.id],
    status,
  };

  senderSockets.emit("status_update", payload);
  receiverSockets.emit("status_update", payload);

  senderSockets.emit("message_update", message);
  receiverSockets.emit("message_update", message);
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "UDTConnect server running",
  });
});

// Users
app.get("/api/users", (req, res) => {
  res.json(USERS);
});

// Messages API
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
        (message.senderId === user1 && message.receiverId === user2) ||
        (message.senderId === user2 && message.receiverId === user1)
      )
  );

  res.json(result);
});

// Socket connection
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Join user account
  socket.on("join", (userId) => {
    if (!userId) return;

    socket.userId = userId;
    socket.join(userId);

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId).add(socket.id);

    // Send initial data in the format expected by App.jsx
    socket.emit("initial_data", {
      online: getOnlineUsers(),
      lastSeen,
      messages: getUserMessages(userId),
    });

    emitPresence();

    // Mark pending messages as delivered when receiver joins
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

  // Send message
  socket.on("send_message", (data, callback) => {
    if (!data || !data.senderId || !data.receiverId) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          message: "Invalid message data",
        });
      }
      return;
    }

    if (socket.userId !== data.senderId) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          message: "Sender account mismatch",
        });
      }
      return;
    }

    // Avoid duplicate messages during reconnection
    const existing = messages.find((m) => m.id === data.id);

    if (existing) {
      if (typeof callback === "function") {
        callback({
          ok: true,
          message: existing,
        });
      }
      return;
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

    // Receiver online = delivered
    if (userSockets.has(message.receiverId)) {
      message.status = "delivered";
    }

    // Send update to both users
    io.to(message.senderId).emit("message_update", message);
    io.to(message.receiverId).emit("message_update", message);

    // Send acknowledgement to frontend
    if (typeof callback === "function") {
      callback({
        ok: true,
        message,
      });
    }

    console.log("Message sent:", message.id, message.status);
  });

  // Mark messages as read
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

  // Delete message
  socket.on("delete_message", (data, callback) => {
    if (!data || !data.id || !socket.userId) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          message: "Invalid delete request",
        });
      }
      return;
    }

    const message = messages.find((m) => m.id === data.id);

    if (!message) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          message: "Message not found",
        });
      }
      return;
    }

    const userId = socket.userId;

    if (data.scope === "everyone") {
      if (message.senderId !== userId) {
        if (typeof callback === "function") {
          callback({
            ok: false,
            message: "Only the sender can delete for everyone",
          });
        }
        return;
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

    if (typeof callback === "function") {
      callback({ ok: true });
    }

    console.log("Message deleted:", message.id, data.scope);
  });

  // Disconnect
  socket.on("disconnect", () => {
    const userId = socket.userId;

    if (!userId || !userSockets.has(userId)) return;

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

// Serve React frontend
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
    res.send("UDTConnect backend is running. Frontend build not found.");
  });
}

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`UDTConnect running on port ${PORT}`);
});

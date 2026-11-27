
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

// Demo users
const USERS = [
  { id: "ryan", name: "Ryan" },
  { id: "jasprit", name: "Jasprit" },
  { id: "rohit", name: "Rohit" },
  { id: "sherphan", name: "Sherphan" },
  { id: "tilak", name: "Tilak" },
];

let messages = [];
const userSockets = new Map();
const lastSeen = {};

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "UDTConnect server running",
  });
});

// Users API
app.get("/api/users", (req, res) => {
  res.json(USERS);
});

// Online users
function getOnlineUsers() {
  return [...userSockets.keys()];
}

// Presence update
function emitPresence() {
  io.emit("presence_update", {
    onlineUsers: getOnlineUsers(),
    lastSeen,
  });
}

// Message status update
function updateStatus(messageId, status) {
  const message = messages.find((m) => m.id === messageId);

  if (message) {
    message.status = status;
    io.emit("message_status", {
      messageId,
      status,
    });
  }
}

// Get messages
app.get("/api/messages", (req, res) => {
  const { user1, user2 } = req.query;

  if (!user1 || !user2) {
    return res.status(400).json({
      error: "user1 and user2 are required",
    });
  }

  const chatMessages = messages.filter(
    (m) =>
      (m.senderId === user1 && m.receiverId === user2) ||
      (m.senderId === user2 && m.receiverId === user1)
  );

  res.json(chatMessages);
});

// Socket connection
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join", (userId) => {
    if (!userId) return;

    socket.userId = userId;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId).add(socket.id);

    socket.join(userId);

    emitPresence();

    // Notify sender when receiver comes online
    messages.forEach((message) => {
      if (
        message.receiverId === userId &&
        message.status === "sent"
      ) {
        updateStatus(message.id, "delivered");
      }
    });

    console.log(userId, "joined");
  });

  // Send message
  socket.on("send_message", (data) => {
    if (!data || !data.senderId || !data.receiverId) return;

    const message = {
      id: data.id || `${Date.now()}-${Math.random()}`,
      senderId: data.senderId,
      receiverId: data.receiverId,
      text: data.text || "",
      file: data.file || null,
      fileName: data.fileName || "",
      fileType: data.fileType || "",
      timestamp: data.timestamp || new Date().toISOString(),
      status: "sent",
      deletedFor: [],
      deletedForEveryone: false,
    };

    messages.push(message);

    // Sender receives message confirmation
    io.to(data.senderId).emit("receive_message", message);

    // Receiver receives message
    io.to(data.receiverId).emit("receive_message", message);

    // Delivered status
    if (userSockets.has(data.receiverId)) {
      updateStatus(message.id, "delivered");
    }
  });

  // Read messages
  socket.on("mark_read", ({ senderId, receiverId }) => {
    messages.forEach((message) => {
      if (
        message.senderId === senderId &&
        message.receiverId === receiverId &&
        message.status !== "read"
      ) {
        updateStatus(message.id, "read");
      }
    });

    io.to(senderId).emit("messages_read", {
      senderId,
      receiverId,
    });
  });

  // Delete message
  socket.on("delete_message", ({ messageId, userId, deleteFor }) => {
    const message = messages.find((m) => m.id === messageId);

    if (!message) return;

    if (deleteFor === "everyone") {
      message.deletedForEveryone = true;
      message.text = "";
      message.file = null;

      io.emit("message_deleted", {
        messageId,
        deleteFor: "everyone",
      });
    } else {
      if (!message.deletedFor.includes(userId)) {
        message.deletedFor.push(userId);
      }

      io.to(userId).emit("message_deleted", {
        messageId,
        deleteFor: "me",
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const userId = socket.userId;

    if (userId && userSockets.has(userId)) {
      userSockets.get(userId).delete(socket.id);

      if (userSockets.get(userId).size === 0) {
        userSockets.delete(userId);
        lastSeen[userId] = new Date().toISOString();
      }

      emitPresence();
    }

    console.log("Socket disconnected:", socket.id);
  });
});

// Serve React frontend
const frontendDist = path.join(__dirname, "../frontend/dist");

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
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
  console.log(`UDTConnect server running on port ${PORT}`);
});

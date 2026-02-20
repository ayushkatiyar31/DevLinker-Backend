const socket = require("socket.io");
const crypto = require("crypto");
const { Chat } = require("../models/chat");
const ConnectionRequest = require("../models/connectionRequest");

const getSecretRoomId = (userId, targetUserId) => {
  return crypto
    .createHash("sha256")
    .update([userId, targetUserId].sort().join("$"))
    .digest("hex");
};

const getAllowedOrigins = () => {
  const envList = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const hardcoded = [
    "https://dev-linker-frontend.vercel.app",
    "https://devlinker-frontend.vercel.app",
  ];

  return new Set([...hardcoded, ...envList]);
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin.startsWith("http://localhost:")) return true;
  if (origin.startsWith("http://127.0.0.1:")) return true;
  const allowed = getAllowedOrigins();
  return allowed.has(origin);
};

const getIo = () => global.__devlinker_io;

const initializeSocket = (server) => {
  const io = socket(server, {
    cors: {
      origin: (origin, callback) => {
        return callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  global.__devlinker_io = io;

  io.on("connection", (socket) => {
    socket.on("joinChat", ({ firstName, userId, targetUserId }) => {
      const roomId = getSecretRoomId(userId, targetUserId);
      console.log(firstName + " joined Room : " + roomId);
      socket.join(roomId);
    });

    socket.on(
      "sendMessage",
      async ({ firstName, lastName, userId, targetUserId, text }) => {
        // Save messages to the database
        try {
          const roomId = getSecretRoomId(userId, targetUserId);
          console.log(firstName + " " + text);

          // Only allow chatting between accepted connections
          const accepted = await ConnectionRequest.findOne({
            $or: [
              { fromUserId: userId, toUserId: targetUserId, status: "accepted" },
              { fromUserId: targetUserId, toUserId: userId, status: "accepted" },
            ],
          }).select("_id");

          if (!accepted) {
            return;
          }

          let chat = await Chat.findOne({
            participants: { $all: [userId, targetUserId] },
          });

          if (!chat) {
            chat = new Chat({
              participants: [userId, targetUserId],
              messages: [],
            });
          }

          chat.messages.push({
            senderId: userId,
            text,
          });

          await chat.save();

          const last = chat.messages[chat.messages.length - 1];
          io.to(roomId).emit("messageReceived", {
            chatId: String(chat._id),
            senderId: String(userId),
            targetUserId: String(targetUserId),
            message: {
              _id: String(last?._id),
              senderId: String(userId),
              text: last?.text ?? "",
              createdAt: last?.createdAt ?? new Date().toISOString(),
            },
          });
        } catch (err) {
          console.log(err);
        }
      }
    );

    socket.on("disconnect", () => {});
  });

  return io;
};

module.exports = { initializeSocket, getSecretRoomId, getIo };

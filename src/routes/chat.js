const express = require("express");
const { userAuth } = require("../middlewares/auth");
const { checkProfileComplete } = require("../middlewares/checkProfileComplete");
const { Chat } = require("../models/chat");
const ConnectionRequest = require("../models/connectionRequest");
const { getIo, getSecretRoomId } = require("../utils/socket");

const chatRouter = express.Router();

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium isProfileComplete";

async function ensureCanChat(userId, targetUserId) {
  const accepted = await ConnectionRequest.findOne({
    $or: [
      { fromUserId: userId, toUserId: targetUserId, status: "accepted" },
      { fromUserId: targetUserId, toUserId: userId, status: "accepted" },
    ],
  }).select("_id");

  return Boolean(accepted);
}

// List chats for the logged-in user
chatRouter.get("/chats", userAuth, checkProfileComplete, async (req, res) => {
  const userId = req.user._id;

  try {
    const chats = await Chat.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .populate({ path: "participants", select: USER_SAFE_DATA });

    const data = chats.map((chat) => {
      const other = (chat.participants || []).find(
        (p) => p?._id?.toString() !== userId.toString()
      );

      const last = Array.isArray(chat.messages) && chat.messages.length > 0
        ? chat.messages[chat.messages.length - 1]
        : null;

      return {
        id: chat._id,
        targetUser: other || null,
        lastMessage: last?.text || "",
        lastMessageSenderId: last?.senderId || null,
        lastMessageTime: last?.createdAt || chat.updatedAt || chat.createdAt,
      };
    });

    return res.json({ data });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Failed to load chats" });
  }
});

// Fetch (or create) a chat with a target user and include messages
chatRouter.get("/with/:targetUserId", userAuth, checkProfileComplete, async (req, res) => {
  const { targetUserId } = req.params;
  const userId = req.user._id;

  try {
    const allowed = await ensureCanChat(userId, targetUserId);
    if (!allowed) {
      return res.status(403).json({ message: "You can only chat with your connections" });
    }

    let chat = await Chat.findOne({
      participants: { $all: [userId, targetUserId] },
    })
      .populate({ path: "participants", select: USER_SAFE_DATA })
      .populate({ path: "messages.senderId", select: USER_SAFE_DATA });

    if (!chat) {
      chat = new Chat({ participants: [userId, targetUserId], messages: [] });
      await chat.save();
      chat = await Chat.findById(chat._id)
        .populate({ path: "participants", select: USER_SAFE_DATA })
        .populate({ path: "messages.senderId", select: USER_SAFE_DATA });
    }

    return res.json({ data: chat });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Failed to load chat" });
  }
});

// Send a message to a user (HTTP fallback; socket can still be used)
chatRouter.post("/with/:targetUserId/message", userAuth, checkProfileComplete, async (req, res) => {
  const { targetUserId } = req.params;
  const userId = req.user._id;
  const { text } = req.body || {};

  try {
    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const allowed = await ensureCanChat(userId, targetUserId);
    if (!allowed) {
      return res.status(403).json({ message: "You can only chat with your connections" });
    }

    let chat = await Chat.findOne({ participants: { $all: [userId, targetUserId] } });
    if (!chat) {
      chat = new Chat({ participants: [userId, targetUserId], messages: [] });
    }

    chat.messages.push({ senderId: userId, text: String(text) });
    await chat.save();

    const last = chat.messages[chat.messages.length - 1];

    const io = getIo();
    if (io) {
      const roomId = getSecretRoomId(userId, targetUserId);
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
    }

    return res.json({
      data: {
        chatId: chat._id,
        message: last,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Failed to send message" });
  }
});

// Backward-compatible route (older frontend)
chatRouter.get("/chat/:targetUserId", userAuth, checkProfileComplete, async (req, res) => {
  try {
    req.params.targetUserId = req.params.targetUserId;
    // Delegate to the new handler behavior
    const { targetUserId } = req.params;
    const userId = req.user._id;

    const allowed = await ensureCanChat(userId, targetUserId);
    if (!allowed) {
      return res.status(403).json({ message: "You can only chat with your connections" });
    }

    let chat = await Chat.findOne({ participants: { $all: [userId, targetUserId] } })
      .populate({ path: "participants", select: USER_SAFE_DATA })
      .populate({ path: "messages.senderId", select: USER_SAFE_DATA });

    if (!chat) {
      chat = new Chat({ participants: [userId, targetUserId], messages: [] });
      await chat.save();
      chat = await Chat.findById(chat._id)
        .populate({ path: "participants", select: USER_SAFE_DATA })
        .populate({ path: "messages.senderId", select: USER_SAFE_DATA });
    }

    return res.json({ data: chat });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Failed to load chat" });
  }
});

module.exports = chatRouter;

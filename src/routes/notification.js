const express = require("express");
const notificationRouter = express.Router();

const { userAuth } = require("../middlewares/auth");
const { checkProfileComplete } = require("../middlewares/checkProfileComplete");
const Notification = require("../models/notification");
const mongoose = require("mongoose");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

notificationRouter.get("/", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const user = req.user;

    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);
    const unreadOnly = String(req.query.unreadOnly || "false").toLowerCase() === "true";

    const filter = { userId: user._id };
    if (unreadOnly) filter.is_read = false;

    const items = await Notification.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    const data = items.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      description: n.description,
      is_read: Boolean(n.is_read),
      created_at: n.created_at,
      metadata: n.metadata || {},
    }));

    res.json({ message: "Notifications fetched", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch notifications" });
  }
});

notificationRouter.post(
  "/mark-all-read",
  userAuth,
  checkProfileComplete,
  async (req, res) => {
    try {
      const user = req.user;
      await Notification.updateMany({ userId: user._id, is_read: false }, { $set: { is_read: true } });
      res.json({ message: "All notifications marked as read" });
    } catch (err) {
      res.status(400).json({ message: err?.message || "Failed to update notifications" });
    }
  }
);

notificationRouter.post(
  "/:notificationId/read",
  userAuth,
  checkProfileComplete,
  async (req, res) => {
    try {
      const user = req.user;
      const { notificationId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return res.status(400).json({ message: "Invalid notificationId" });
      }

      const updated = await Notification.findOneAndUpdate(
        { _id: notificationId, userId: user._id },
        { $set: { is_read: true } },
        { new: true }
      ).lean();

      if (!updated) {
        return res.status(404).json({ message: "Notification not found" });
      }

      res.json({
        message: "Notification marked as read",
        data: {
          id: String(updated._id),
          is_read: Boolean(updated.is_read),
        },
      });
    } catch (err) {
      res.status(400).json({ message: err?.message || "Failed to update notification" });
    }
  }
);

module.exports = notificationRouter;

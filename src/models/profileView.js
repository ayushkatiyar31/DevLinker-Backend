const mongoose = require("mongoose");

const profileViewSchema = new mongoose.Schema(
  {
    viewedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    viewerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

profileViewSchema.index({ viewedUserId: 1, viewerUserId: 1, viewedAt: -1 });

module.exports = mongoose.model("ProfileView", profileViewSchema);

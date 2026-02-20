const mongoose = require("mongoose");

const projectEventSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    kind: {
      type: String,
      required: true,
      trim: true,
      enum: ["view", "vote", "interest", "comment", "reply", "like_comment", "like_reply"],
      index: true,
    },
    action: {
      type: String,
      trim: true,
      default: "",
      // Examples: add/remove, up/down/clear
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model("ProjectEvent", projectEventSchema);

const mongoose = require("mongoose");

const discussionCommentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DiscussionPost",
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000,
    },
    reports: {
      type: [
        {
          reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          reason: { type: String, trim: true, maxlength: 500 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      select: false,
    },
  },
  { timestamps: true }
);

discussionCommentSchema.index({ postId: 1, createdAt: -1 });

module.exports = mongoose.model("DiscussionComment", discussionCommentSchema);

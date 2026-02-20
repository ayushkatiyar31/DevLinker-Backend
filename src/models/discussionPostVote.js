const mongoose = require("mongoose");

const discussionPostVoteSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DiscussionPost",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

discussionPostVoteSchema.index({ postId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("DiscussionPostVote", discussionPostVoteSchema);

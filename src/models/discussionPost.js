const mongoose = require("mongoose");

const discussionLinkSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    title: { type: String, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 1000 },
    imageUrl: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

const discussionFileSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    originalName: { type: String, required: true, trim: true, maxlength: 260 },
    mimeType: { type: String, trim: true, maxlength: 120 },
    size: { type: Number, min: 0 },
  },
  { _id: false }
);

const discussionPostSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20000,
    },
    category: {
      type: String,
      trim: true,
      enum: ["General", "Questions", "News", "Help"],
      default: "General",
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    links: {
      type: [discussionLinkSchema],
      default: [],
    },
    images: {
      type: [discussionFileSchema],
      default: [],
    },
    attachments: {
      type: [discussionFileSchema],
      default: [],
    },
    voteCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
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
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

discussionPostSchema.index({ createdAt: -1 });
discussionPostSchema.index({ title: "text", content: "text" });

module.exports = mongoose.model("DiscussionPost", discussionPostSchema);

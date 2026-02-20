const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "pdf", "link"],
      required: true,
    },
    url: { type: String, required: true, trim: true },
    title: { type: String, trim: true },
  },
  { _id: false }
);

const gigSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    category: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    fullDescription: { type: String, trim: true },
    skills: { type: [String], default: [] },

    budgetType: { type: String, enum: ["fixed", "hourly"], default: "fixed" },
    budgetMin: { type: Number, default: 0 },
    budgetMax: { type: Number, default: 0 },

    deadline: { type: Date },
    duration: { type: String, trim: true },

    attachments: { type: [attachmentSchema], default: [] },
    contactPreference: {
      type: String,
      enum: ["platform", "email", "any"],
      default: "platform",
    },
    visibility: {
      type: String,
      enum: ["public", "community"],
      default: "public",
    },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["open", "in_progress", "completed"],
      default: "open",
    },

    views: { type: Number, default: 0 },
    viewedBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    viewedByGuests: { type: [String], default: [] },

    upvotes: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    downvotes: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gig", gigSchema);

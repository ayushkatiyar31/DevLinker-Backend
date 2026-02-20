const mongoose = require("mongoose");

const gigApplicationSchema = new mongoose.Schema(
  {
    gig: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gig",
      required: true,
      index: true,
    },
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    proposal: { type: String, required: true, trim: true, maxlength: 5000 },
    expectedDelivery: { type: String, required: true, trim: true, maxlength: 100 },
    budgetQuote: { type: Number, required: true },
    attachments: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

// prevent multiple applications per gig per user
gigApplicationSchema.index({ gig: 1, applicant: 1 }, { unique: true });

module.exports = mongoose.model("GigApplication", gigApplicationSchema);

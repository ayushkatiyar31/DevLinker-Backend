const mongoose = require("mongoose");
const validator = require("validator");

const urlValidator = {
  validator: (value) => {
    if (value === undefined || value === null || value === "") return true;
    return validator.isURL(String(value), { require_protocol: true });
  },
  message: "Invalid URL",
};

const projectMediaVideoSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, validate: urlValidator },
    title: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const projectMediaLinkSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 120 },
    url: { type: String, trim: true, validate: urlValidator },
    type: {
      type: String,
      trim: true,
      enum: ["github", "demo", "docs", "figma", "other"],
      default: "other",
    },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 800 },

    // Used by ProjectDetail mock; store markdown or long-form content.
    fullDescription: { type: String, trim: true, maxlength: 15000 },

    techStack: { type: [String], default: [] },
    lookingFor: { type: [String], default: [] },
    teamSize: { type: String, trim: true, maxlength: 60 },

    category: { type: String, trim: true, default: "Other", index: true },
    status: {
      type: String,
      trim: true,
      enum: ["active", "closed", "archived"],
      default: "active",
      index: true,
    },

    media: {
      images: {
        type: [String],
        default: [],
        validate: {
          validator: (arr) =>
            Array.isArray(arr) &&
            arr.every((v) => validator.isURL(String(v), { require_protocol: true })),
          message: "Invalid image URL",
        },
      },
      videos: { type: [projectMediaVideoSchema], default: [] },
      links: { type: [projectMediaLinkSchema], default: [] },
    },

    upvotes: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    downvotes: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },

    views: { type: Number, default: 0 },
    viewedBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },

    // Anonymous unique viewers (cookie-based). This enables de-duping views
    // even when the visitor is not authenticated.
    viewedByGuests: { type: [String], default: [] },

    interestedUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

projectSchema.virtual("id").get(function () {
  return this._id?.toString();
});

projectSchema.virtual("interestedCount").get(function () {
  return Array.isArray(this.interestedUserIds) ? this.interestedUserIds.length : 0;
});

module.exports = mongoose.model("Project", projectSchema);

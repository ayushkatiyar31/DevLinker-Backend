const Gig = require("../models/gig");
const GigApplication = require("../models/gigApplication");
const GigComment = require("../models/gigComment");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium isProfileComplete";

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeStringArray = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => normalizeString(v)).filter(Boolean);
  }
  const str = normalizeString(value);
  if (!str) return [];
  if (str.includes(",")) {
    return str
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [str];
};

const parseNumber = (value, fallback = 0) => {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return num;
};

const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const toOwnerUi = (user) => {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.fullName,
    avatar_url: user.photoUrl,
    is_premium: Boolean(user.isPremium),
    role: user.role || "",
    location: user.location || "",
  };
};

const mapGigToUi = async (gig, { includeApplicationsCount = true } = {}) => {
  if (!gig) return null;

  const upvotesSet = new Set((gig.upvotes || []).map((id) => String(id)));
  const downvotesSet = new Set((gig.downvotes || []).map((id) => String(id)));

  let applicationsCount = 0;
  if (includeApplicationsCount) {
    applicationsCount = await GigApplication.countDocuments({ gig: gig._id });
  }

  return {
    id: String(gig._id),
    title: gig.title,
    category: gig.category,
    description: gig.description,
    fullDescription: gig.fullDescription || "",
    skills: gig.skills || [],
    budgetType: gig.budgetType,
    budgetMin: gig.budgetMin,
    budgetMax: gig.budgetMax,
    deadline: gig.deadline ? new Date(gig.deadline).toISOString() : null,
    duration: gig.duration || "",
    attachments: gig.attachments || [],
    contactPreference: gig.contactPreference,
    visibility: gig.visibility,
    owner: toOwnerUi(gig.owner),
    status: gig.status,
    createdAt: gig.createdAt ? new Date(gig.createdAt).toISOString() : null,
    views: gig.views || 0,
    upvotes: Array.from(upvotesSet),
    downvotes: Array.from(downvotesSet),
    applicationsCount,
  };
};

const getOrSetGuestViewerId = (req, res) => {
  const existing = req.cookies?.viewerId;
  if (existing && typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }

  const generated =
    (global.crypto?.randomUUID ? global.crypto.randomUUID() : null) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 1 year
  res.cookie("viewerId", generated, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  return generated;
};

const ensureOwner = (gig, userId) => {
  if (!gig) return false;
  return String(gig.owner?._id || gig.owner) === String(userId);
};

// GET /api/v1/gig
const listGigs = async (req, res) => {
  try {
    const search = normalizeString(req.query.search);
    const category = normalizeString(req.query.category);
    const sortBy = normalizeString(req.query.sortBy) || "latest";

    const min = parseNumber(req.query.budgetMin, null);
    const max = parseNumber(req.query.budgetMax, null);

    const skills = normalizeStringArray(req.query.skills);

    const filter = {};
    if (category && category !== "All") {
      filter.category = category;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { skills: { $in: [new RegExp(search, "i")] } },
      ];
    }

    if (skills.length > 0) {
      filter.skills = { $in: skills };
    }

    if (min !== null || max !== null) {
      filter.$and = filter.$and || [];
      if (min !== null) filter.$and.push({ budgetMin: { $gte: min } });
      if (max !== null) filter.$and.push({ budgetMax: { $lte: max } });
    }

    let query = Gig.find(filter).populate("owner", USER_SAFE_DATA);

    switch (sortBy) {
      case "oldest":
        query = query.sort({ createdAt: 1 });
        break;
      case "budget_high":
        query = query.sort({ budgetMax: -1 });
        break;
      case "budget_low":
        query = query.sort({ budgetMin: 1 });
        break;
      case "views":
        query = query.sort({ views: -1 });
        break;
      case "latest":
      default:
        query = query.sort({ createdAt: -1 });
        break;
    }

    const gigs = await query;

    const data = [];
    for (const gig of gigs) {
      data.push(await mapGigToUi(gig));
    }

    res.json({ message: "Gigs fetched successfully", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to list gigs" });
  }
};

// POST /api/v1/gig
const createGig = async (req, res) => {
  try {
    const user = req.user;
    const body = req.body || {};

    const title = normalizeString(body.title);
    const category = normalizeString(body.category);
    const description = normalizeString(body.description);

    if (!title || !category || !description) {
      return res.status(400).json({ message: "title, category, description are required" });
    }

    const gig = new Gig({
      title,
      category,
      description,
      fullDescription: normalizeString(body.fullDescription),
      skills: normalizeStringArray(body.skills),
      budgetType: normalizeString(body.budgetType) || "fixed",
      budgetMin: parseNumber(body.budgetMin, 0),
      budgetMax: parseNumber(body.budgetMax, 0),
      deadline: parseDate(body.deadline) || undefined,
      duration: normalizeString(body.duration),
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      contactPreference: normalizeString(body.contactPreference) || "platform",
      visibility: normalizeString(body.visibility) || "public",
      owner: user._id,
      status: "open",
    });

    const saved = await gig.save();
    const populated = await Gig.findById(saved._id).populate("owner", USER_SAFE_DATA);

    res.json({ message: "Gig created", data: await mapGigToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to create gig" });
  }
};

// GET /api/v1/gig/:gigId
const getGigById = async (req, res) => {
  try {
    const { gigId } = req.params;

    const gig = await Gig.findById(gigId).populate("owner", USER_SAFE_DATA);
    if (!gig) {
      return res.status(404).json({ message: "Gig not found" });
    }

    const viewerUserId = req.user?._id;

    // Unique views
    if (viewerUserId) {
      const already = (gig.viewedBy || []).some((id) => String(id) === String(viewerUserId));
      if (!already) {
        gig.views = (gig.views || 0) + 1;
        gig.viewedBy = [...(gig.viewedBy || []), viewerUserId];
        await gig.save();
      }
    } else {
      const viewerId = getOrSetGuestViewerId(req, res);
      const already = (gig.viewedByGuests || []).includes(viewerId);
      if (!already) {
        gig.views = (gig.views || 0) + 1;
        gig.viewedByGuests = [...(gig.viewedByGuests || []), viewerId];
        await gig.save();
      }
    }

    const fresh = await Gig.findById(gig._id).populate("owner", USER_SAFE_DATA);
    res.json({ message: "Gig fetched", data: await mapGigToUi(fresh) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch gig" });
  }
};

// PATCH /api/v1/gig/:gigId
const updateGig = async (req, res) => {
  try {
    const { gigId } = req.params;
    const gig = await Gig.findById(gigId).populate("owner", USER_SAFE_DATA);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    if (!ensureOwner(gig, req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const body = req.body || {};

    const updatable = {
      title: body.title,
      category: body.category,
      description: body.description,
      fullDescription: body.fullDescription,
      skills: body.skills,
      budgetType: body.budgetType,
      budgetMin: body.budgetMin,
      budgetMax: body.budgetMax,
      deadline: body.deadline,
      duration: body.duration,
      attachments: body.attachments,
      contactPreference: body.contactPreference,
      visibility: body.visibility,
      status: body.status,
    };

    if (updatable.title !== undefined) gig.title = normalizeString(updatable.title);
    if (updatable.category !== undefined) gig.category = normalizeString(updatable.category);
    if (updatable.description !== undefined) gig.description = normalizeString(updatable.description);
    if (updatable.fullDescription !== undefined) gig.fullDescription = normalizeString(updatable.fullDescription);
    if (updatable.skills !== undefined) gig.skills = normalizeStringArray(updatable.skills);
    if (updatable.budgetType !== undefined) gig.budgetType = normalizeString(updatable.budgetType) || gig.budgetType;
    if (updatable.budgetMin !== undefined) gig.budgetMin = parseNumber(updatable.budgetMin, gig.budgetMin);
    if (updatable.budgetMax !== undefined) gig.budgetMax = parseNumber(updatable.budgetMax, gig.budgetMax);
    if (updatable.deadline !== undefined) {
      gig.deadline = parseDate(updatable.deadline) || undefined;
    }
    if (updatable.duration !== undefined) gig.duration = normalizeString(updatable.duration);
    if (updatable.attachments !== undefined) gig.attachments = Array.isArray(updatable.attachments) ? updatable.attachments : [];
    if (updatable.contactPreference !== undefined) gig.contactPreference = normalizeString(updatable.contactPreference) || gig.contactPreference;
    if (updatable.visibility !== undefined) gig.visibility = normalizeString(updatable.visibility) || gig.visibility;
    if (updatable.status !== undefined) gig.status = normalizeString(updatable.status) || gig.status;

    await gig.save();

    const fresh = await Gig.findById(gig._id).populate("owner", USER_SAFE_DATA);
    res.json({ message: "Gig updated", data: await mapGigToUi(fresh) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to update gig" });
  }
};

// DELETE /api/v1/gig/:gigId
const deleteGig = async (req, res) => {
  try {
    const { gigId } = req.params;
    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    if (!ensureOwner(gig, req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await GigApplication.deleteMany({ gig: gig._id });
    await GigComment.deleteMany({ gig: gig._id });
    await gig.deleteOne();

    res.json({ message: "Gig deleted" });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to delete gig" });
  }
};

// POST /api/v1/gig/:gigId/vote
const voteGig = async (req, res) => {
  try {
    const { gigId } = req.params;
    const direction = normalizeString(req.body?.direction);

    if (!direction || (direction !== "up" && direction !== "down")) {
      return res.status(400).json({ message: "direction must be 'up' or 'down'" });
    }

    const gig = await Gig.findById(gigId).populate("owner", USER_SAFE_DATA);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    const userId = req.user._id;

    const userIdStr = String(userId);
    const hadUpvote = (gig.upvotes || []).some((id) => String(id) === userIdStr);
    const hadDownvote = (gig.downvotes || []).some((id) => String(id) === userIdStr);

    // Remove existing vote first
    gig.upvotes = (gig.upvotes || []).filter((id) => String(id) !== userIdStr);
    gig.downvotes = (gig.downvotes || []).filter((id) => String(id) !== userIdStr);

    // Toggle off if clicking same direction again
    if (direction === "up" && !hadUpvote) gig.upvotes.push(userId);
    if (direction === "down" && !hadDownvote) gig.downvotes.push(userId);

    await gig.save();

    const fresh = await Gig.findById(gig._id).populate("owner", USER_SAFE_DATA);
    res.json({ message: "Vote recorded", data: await mapGigToUi(fresh) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to vote" });
  }
};

// POST /api/v1/gig/:gigId/apply
const applyToGig = async (req, res) => {
  try {
    const { gigId } = req.params;
    const proposal = normalizeString(req.body?.proposal);
    const expectedDelivery = normalizeString(req.body?.expectedDelivery);
    const budgetQuote = parseNumber(req.body?.budgetQuote, NaN);

    if (!proposal || !expectedDelivery || Number.isNaN(budgetQuote)) {
      return res.status(400).json({ message: "proposal, expectedDelivery, budgetQuote are required" });
    }

    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    const application = new GigApplication({
      gig: gig._id,
      applicant: req.user._id,
      proposal,
      expectedDelivery,
      budgetQuote,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      status: "pending",
    });

    const saved = await application.save();

    const populated = await GigApplication.findById(saved._id)
      .populate("gig")
      .populate("applicant", USER_SAFE_DATA);

    res.json({ message: "Application submitted", data: populated });
  } catch (err) {
    // Handle unique constraint duplicate
    const msg = err?.message || "Failed to apply";
    if (msg.includes("duplicate key")) {
      return res.status(409).json({ message: "You already applied to this gig" });
    }
    res.status(400).json({ message: msg });
  }
};

// GET /api/v1/gig/:gigId/my-application
const getMyGigApplication = async (req, res) => {
  try {
    const { gigId } = req.params;

    const application = await GigApplication.findOne({
      gig: gigId,
      applicant: req.user._id,
    })
      .sort({ createdAt: -1 })
      .populate("gig")
      .populate("applicant", USER_SAFE_DATA);

    if (!application) {
      return res.status(404).json({ message: "No application found" });
    }

    res.json({
      message: "Application fetched",
      data: {
        id: String(application._id),
        status: application.status,
        createdAt: application.createdAt ? new Date(application.createdAt).toISOString() : null,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch application" });
  }
};

// GET /api/v1/gig/:gigId/comments
const listGigComments = async (req, res) => {
  try {
    const { gigId } = req.params;
    const comments = await GigComment.find({ gig: gigId })
      .sort({ createdAt: -1 })
      .populate("user", USER_SAFE_DATA)
      .populate("replies.user", USER_SAFE_DATA);

    const data = comments.map((c) => ({
      id: String(c._id),
      gigId: String(c.gig),
      user: toOwnerUi(c.user),
      content: c.content,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      likes: (c.likes || []).map((id) => String(id)),
      replies: (c.replies || []).map((r) => ({
        id: String(r._id),
        user: toOwnerUi(r.user),
        content: r.content,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })),
    }));

    res.json({ message: "Comments fetched", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch comments" });
  }
};

// POST /api/v1/gig/:gigId/comments
const addGigComment = async (req, res) => {
  try {
    const { gigId } = req.params;
    const content = normalizeString(req.body?.content);
    if (!content) return res.status(400).json({ message: "content is required" });

    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    const comment = new GigComment({
      gig: gig._id,
      user: req.user._id,
      content,
    });

    const saved = await comment.save();
    const populated = await GigComment.findById(saved._id)
      .populate("user", USER_SAFE_DATA)
      .populate("replies.user", USER_SAFE_DATA);

    res.json({ message: "Comment added", data: {
      id: String(populated._id),
      gigId: String(populated.gig),
      user: toOwnerUi(populated.user),
      content: populated.content,
      createdAt: populated.createdAt ? new Date(populated.createdAt).toISOString() : null,
      likes: (populated.likes || []).map((id) => String(id)),
      replies: [],
    }});
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to add comment" });
  }
};

// POST /api/v1/gig/:gigId/comments/:commentId/like
const toggleGigCommentLike = async (req, res) => {
  try {
    const { gigId, commentId } = req.params;
    const comment = await GigComment.findOne({ _id: commentId, gig: gigId });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const userId = String(req.user._id);
    const likes = (comment.likes || []).map((id) => String(id));

    if (likes.includes(userId)) {
      comment.likes = (comment.likes || []).filter((id) => String(id) !== userId);
    } else {
      comment.likes = [...(comment.likes || []), req.user._id];
    }

    await comment.save();

    res.json({ message: "Like updated", data: { id: String(comment._id), likes: (comment.likes || []).map((id) => String(id)) } });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to like comment" });
  }
};

// POST /api/v1/gig/:gigId/comments/:commentId/reply
const addGigCommentReply = async (req, res) => {
  try {
    const { gigId, commentId } = req.params;
    const content = normalizeString(req.body?.content);
    if (!content) return res.status(400).json({ message: "content is required" });

    const comment = await GigComment.findOne({ _id: commentId, gig: gigId });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.replies = comment.replies || [];
    comment.replies.push({ user: req.user._id, content });

    await comment.save();

    const fresh = await GigComment.findById(comment._id)
      .populate("user", USER_SAFE_DATA)
      .populate("replies.user", USER_SAFE_DATA);

    const lastReply = fresh.replies[fresh.replies.length - 1];

    res.json({
      message: "Reply added",
      data: {
        commentId: String(fresh._id),
        reply: {
          id: String(lastReply._id),
          user: toOwnerUi(lastReply.user),
          content: lastReply.content,
          createdAt: lastReply.createdAt ? new Date(lastReply.createdAt).toISOString() : null,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to reply" });
  }
};

module.exports = {
  listGigs,
  createGig,
  getGigById,
  updateGig,
  deleteGig,
  voteGig,
  applyToGig,
  getMyGigApplication,
  listGigComments,
  addGigComment,
  toggleGigCommentLike,
  addGigCommentReply,
  mapGigToUi,
};

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const { userAuth, optionalAuth } = require("../middlewares/auth");
const DiscussionPost = require("../models/discussionPost");
const DiscussionComment = require("../models/discussionComment");
const DiscussionPostVote = require("../models/discussionPostVote");

let rateLimit;
try {
  // Optional dependency: if missing, rate limiting is disabled.
  // (Add it via: npm i express-rate-limit)
  rateLimit = require("express-rate-limit");
} catch {
  rateLimit = null;
}

let multer;
try {
  // Required for uploads.
  // (Add it via: npm i multer)
  multer = require("multer");
} catch {
  multer = null;
}

const postsRouter = express.Router();

const USER_SAFE_DATA = "fullName photoUrl role isPremium";

const createRateLimiter = (options) => {
  if (!rateLimit) return (_req, _res, next) => next();
  return rateLimit(options);
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildQueryRegex = (q) => {
  const raw = normalizeString(q);
  if (!raw) return null;

  const tokens = raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return new RegExp(escapeRegex(tokens[0]), "i");
  return new RegExp(tokens.map(escapeRegex).join("|"), "i");
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const toUserUi = (user) => {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.fullName,
    avatar_url: user.photoUrl,
    role: user.role || "",
    is_premium: Boolean(user.isPremium),
  };
};

const toFileUi = (f) => {
  if (!f) return null;
  return {
    url: f.url,
    originalName: f.originalName,
    mimeType: f.mimeType,
    size: f.size,
  };
};

const toLinkUi = (l) => {
  if (!l) return null;
  return {
    url: l.url,
    title: l.title || "",
    description: l.description || "",
    imageUrl: l.imageUrl || "",
  };
};

const toPostUi = (post, { commentsCount = 0, viewerVote = 0 } = {}) => {
  if (!post) return null;
  return {
    id: String(post._id),
    title: post.title,
    content: post.content,
    category: post.category || "General",
    tags: Array.isArray(post.tags) ? post.tags : [],
    links: Array.isArray(post.links) ? post.links.map(toLinkUi).filter(Boolean) : [],
    images: Array.isArray(post.images) ? post.images.map(toFileUi).filter(Boolean) : [],
    attachments: Array.isArray(post.attachments) ? post.attachments.map(toFileUi).filter(Boolean) : [],
    voteCount: typeof post.voteCount === "number" ? post.voteCount : 0,
    viewerVote,
    author: toUserUi(post.author),
    createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : null,
    updatedAt: post.updatedAt ? new Date(post.updatedAt).toISOString() : null,
    commentsCount,
  };
};

const toCommentUi = (comment) => {
  if (!comment) return null;
  return {
    id: String(comment._id),
    content: comment.content,
    author: toUserUi(comment.author),
    createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
  };
};

const isAdmin = (user) => {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin";
};

const parseLinksInput = (raw) => {
  if (raw === undefined) return null;

  const toLink = (value) => {
    if (!value) return null;
    if (typeof value === "string") {
      const url = normalizeString(value);
      if (!url) return null;
      return { url };
    }

    const url = normalizeString(value.url);
    if (!url) return null;
    const title = normalizeString(value.title);
    const description = normalizeString(value.description);
    const imageUrl = normalizeString(value.imageUrl);
    return {
      url,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
  };

  // Accept: array of {url} or array of urls
  if (Array.isArray(raw)) {
    return raw.map(toLink).filter(Boolean).slice(0, 5);
  }

  // Accept: JSON string OR newline-separated urls
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];

    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(toLink).filter(Boolean).slice(0, 5);
      } catch {
        // fallthrough
      }
    }

    return s
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((url) => ({ url }));
  }

  // Unknown type -> treat as clear
  return [];
};

const parseStringArrayInput = (raw, { max = 50 } = {}) => {
  if (raw === undefined) return null;

  const norm = (v) => {
    const s = normalizeString(v);
    return s ? s : null;
  };

  if (Array.isArray(raw)) return raw.map(norm).filter(Boolean).slice(0, max);

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(norm).filter(Boolean).slice(0, max);
      } catch {
        // fallthrough
      }
    }
    return s
      .split(/\r?\n|,/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, max);
  }

  return [];
};

const deleteUploadByUrl = async (url) => {
  const u = normalizeString(url);
  if (!u) return;

  const isImage = u.startsWith("/uploads/discuss/images/");
  const isFile = u.startsWith("/uploads/discuss/files/");
  if (!isImage && !isFile) return;

  const base = path.basename(u);
  const diskPath = isImage
    ? path.join(process.cwd(), "uploads", "discuss", "images", base)
    : path.join(process.cwd(), "uploads", "discuss", "files", base);

  try {
    await fs.promises.unlink(diskPath);
  } catch {
    // ignore
  }
};

const upload = (() => {
  if (!multer) return null;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const isImage = file.mimetype?.startsWith("image/");
      const folder = isImage ? "images" : "files";
      const dir = path.join(process.cwd(), "uploads", "discuss", folder);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore
      }
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safeBase = String(file.originalname || "file")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 80);
      const ext = path.extname(safeBase);
      const base = ext ? safeBase.slice(0, -ext.length) : safeBase;
      cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${base}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      files: 8,
      fileSize: 10 * 1024 * 1024, // 10MB each
    },
  });
})();

const postLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const voteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const commentLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

postsRouter.get("/", optionalAuth, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    let limit = parsePositiveInt(req.query.limit, 10);
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const sort = normalizeString(req.query.sort).toLowerCase() || "new";
    const category = normalizeString(req.query.category);
    const q = normalizeString(req.query.q);
    const authorId = normalizeString(req.query.authorId);

    const filter = {};
    if (category) filter.category = category;
    if (authorId && mongoose.Types.ObjectId.isValid(authorId)) {
      filter.author = new mongoose.Types.ObjectId(authorId);
    }

    const sortSpec = sort === "top" ? { voteCount: -1, createdAt: -1 } : { createdAt: -1 };

    let posts;
    const re = buildQueryRegex(q);
    if (re) {
      // Title matches should always show up first.
      // Order: [title contains q] then [content contains q]
      const target = limit + 1;

      const titleFilter = { ...filter, title: re };
      const titleCount = await DiscussionPost.countDocuments(titleFilter);
      const skipTitle = Math.min(skip, titleCount);
      const skipOther = Math.max(0, skip - titleCount);

      const titlePosts = await DiscussionPost.find(titleFilter)
        .sort(sortSpec)
        .skip(skipTitle)
        .limit(target)
        .populate("author", USER_SAFE_DATA);

      const need = target - titlePosts.length;
      let otherPosts = [];
      if (need > 0) {
        otherPosts = await DiscussionPost.find({
          ...filter,
          title: { $not: re },
          content: re,
        })
          .sort(sortSpec)
          .skip(skipOther)
          .limit(need)
          .populate("author", USER_SAFE_DATA);
      }

      posts = [...titlePosts, ...otherPosts];
    } else {
      posts = await DiscussionPost.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit + 1)
        .populate("author", USER_SAFE_DATA);
    }

    const hasMore = posts.length > limit;
    const sliced = hasMore ? posts.slice(0, limit) : posts;

    const postIds = sliced.map((p) => p._id);

    const commentCounts = await DiscussionComment.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $group: { _id: "$postId", count: { $sum: 1 } } },
    ]);
    const countByPostId = new Map(commentCounts.map((r) => [String(r._id), r.count]));

    const viewerId = req.user?._id;
    let viewerVotesByPostId = new Map();
    if (viewerId && postIds.length > 0) {
      const votes = await DiscussionPostVote.find({ postId: { $in: postIds }, userId: viewerId }).select("postId");
      viewerVotesByPostId = new Map(votes.map((v) => [String(v.postId), 1]));
    }

    const data = sliced.map((p) =>
      toPostUi(p, {
        commentsCount: countByPostId.get(String(p._id)) || 0,
        viewerVote: viewerVotesByPostId.get(String(p._id)) || 0,
      })
    );

    return res.json({ data, page, limit, hasMore });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// GET /api/v1/posts/search?q=
postsRouter.get("/search", optionalAuth, async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    let limit = parsePositiveInt(req.query.limit, 10);
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const q = normalizeString(req.query.q);
    const re = buildQueryRegex(q);
    if (!re) {
      return res.json({ data: [], page, limit, hasMore: false });
    }

    // Search endpoint prioritizes title hits.
    const target = limit + 1;
    const titleFilter = { title: re };
    const titleCount = await DiscussionPost.countDocuments(titleFilter);
    const skipTitle = Math.min(skip, titleCount);
    const skipOther = Math.max(0, skip - titleCount);

    const titlePosts = await DiscussionPost.find(titleFilter)
      .sort({ createdAt: -1 })
      .skip(skipTitle)
      .limit(target)
      .populate("author", USER_SAFE_DATA);

    const need = target - titlePosts.length;
    let otherPosts = [];
    if (need > 0) {
      otherPosts = await DiscussionPost.find({ title: { $not: re }, content: re })
        .sort({ createdAt: -1 })
        .skip(skipOther)
        .limit(need)
        .populate("author", USER_SAFE_DATA);
    }

    const posts = [...titlePosts, ...otherPosts];

    const hasMore = posts.length > limit;
    const sliced = hasMore ? posts.slice(0, limit) : posts;

    const postIds = sliced.map((p) => p._id);
    const commentCounts = await DiscussionComment.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $group: { _id: "$postId", count: { $sum: 1 } } },
    ]);
    const countByPostId = new Map(commentCounts.map((r) => [String(r._id), r.count]));

    const viewerId = req.user?._id;
    let viewerVotesByPostId = new Map();
    if (viewerId && postIds.length > 0) {
      const votes = await DiscussionPostVote.find({ postId: { $in: postIds }, userId: viewerId }).select("postId");
      viewerVotesByPostId = new Map(votes.map((v) => [String(v.postId), 1]));
    }

    const data = sliced.map((p) =>
      toPostUi(p, {
        commentsCount: countByPostId.get(String(p._id)) || 0,
        viewerVote: viewerVotesByPostId.get(String(p._id)) || 0,
      })
    );

    return res.json({ data, page, limit, hasMore });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

postsRouter.post(
  "/",
  userAuth,
  postLimiter,
  (req, res, next) => {
    if (!upload) {
      return res.status(500).json({
        message: "Uploads not configured. Install multer in backend: npm i multer",
      });
    }

    const handler = upload.fields([
      { name: "images", maxCount: 5 },
      { name: "files", maxCount: 3 },
    ]);
    return handler(req, res, next);
  },
  async (req, res) => {
    try {
      const title = normalizeString(req.body?.title);
      const content = normalizeString(req.body?.content);
      const category = normalizeString(req.body?.category) || "General";

      if (!title || !content) {
        return res.status(400).json({ message: "title and content are required" });
      }

      const tagsRaw = req.body?.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map(normalizeString).filter(Boolean).slice(0, 10)
        : normalizeString(tagsRaw)
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10);

      let links = [];
      const linksRaw = req.body?.links;
      if (linksRaw) {
        try {
          const parsed = typeof linksRaw === "string" ? JSON.parse(linksRaw) : linksRaw;
          if (Array.isArray(parsed)) {
            links = parsed
              .map((l) => ({
                url: normalizeString(l?.url),
                title: normalizeString(l?.title),
                description: normalizeString(l?.description),
                imageUrl: normalizeString(l?.imageUrl),
              }))
              .filter((l) => Boolean(l.url))
              .slice(0, 5);
          }
        } catch {
          // ignore invalid links payload
        }
      }

      const images = (req.files?.images || []).map((f) => ({
        url: `/uploads/discuss/images/${path.basename(f.path)}`,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      }));

      const attachments = (req.files?.files || []).map((f) => ({
        url: `/uploads/discuss/files/${path.basename(f.path)}`,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      }));

      const created = await DiscussionPost.create({
        title,
        content,
        category,
        tags,
        links,
        images,
        attachments,
        author: req.user._id,
      });

      const post = await DiscussionPost.findById(created._id).populate("author", USER_SAFE_DATA);

      return res.json({ message: "Post created", data: toPostUi(post, { commentsCount: 0, viewerVote: 0 }) });
    } catch (err) {
      return res.status(400).json({ message: err?.message || "Request failed" });
    }
  }
);

// GET /api/v1/posts/:id
// Get single post with comments
postsRouter.get("/:id", optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const post = await DiscussionPost.findById(id).populate("author", USER_SAFE_DATA);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const comments = await DiscussionComment.find({ postId: id })
      .sort({ createdAt: 1 })
      .limit(500)
      .populate("author", USER_SAFE_DATA);

    let viewerVote = 0;
    if (req.user?._id) {
      const existing = await DiscussionPostVote.findOne({ postId: id, userId: req.user._id }).select("_id");
      viewerVote = existing ? 1 : 0;
    }

    return res.json({
      data: toPostUi(post, { commentsCount: comments.length, viewerVote }),
      comments: comments.map(toCommentUi),
    });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// PUT /api/v1/posts/:id
// Supports JSON updates OR multipart form-data for uploads/removals.
postsRouter.put(
  "/:id",
  userAuth,
  postLimiter,
  (req, res, next) => {
    if (!upload) return next();

    const ct = String(req.headers["content-type"] || "");
    if (!ct.toLowerCase().includes("multipart/form-data")) return next();

    const handler = upload.fields([
      { name: "images", maxCount: 5 },
      { name: "files", maxCount: 3 },
    ]);
    return handler(req, res, next);
  },
  async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const post = await DiscussionPost.findById(id).select("author images attachments");
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isOwner = String(post.author) === String(req.user._id);
    if (!isOwner) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const title = normalizeString(req.body?.title);
    const content = normalizeString(req.body?.content);
    const category = normalizeString(req.body?.category);
    const tagsRaw = req.body?.tags;

    const links = parseLinksInput(req.body?.links);

    const removeImages = parseStringArrayInput(req.body?.removeImages, { max: 20 });
    const removeAttachments = parseStringArrayInput(req.body?.removeAttachments, { max: 20 });

    const tags =
      tagsRaw === undefined
        ? null
        : Array.isArray(tagsRaw)
          ? tagsRaw.map(normalizeString).filter(Boolean).slice(0, 10)
          : normalizeString(tagsRaw)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 10);

    const updates = {};
    if (title) updates.title = title;
    if (content) updates.content = content;
    if (category) updates.category = category;
    if (tags !== null) updates.tags = tags;
    if (links !== null) updates.links = links;

    const toFile = (f, kind) => ({
      url: kind === "image" ? `/uploads/discuss/images/${path.basename(f.path)}` : `/uploads/discuss/files/${path.basename(f.path)}`,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
    });

    const newImages = (req.files?.images || []).map((f) => toFile(f, "image"));
    const newAttachments = (req.files?.files || []).map((f) => toFile(f, "file"));

    const removedImageSet = new Set((removeImages || []).map(String));
    const removedAttachmentSet = new Set((removeAttachments || []).map(String));

    if (removeImages !== null || newImages.length > 0) {
      const currentImages = Array.isArray(post.images) ? post.images : [];
      const kept = currentImages.filter((f) => !removedImageSet.has(String(f.url)));
      updates.images = [...kept, ...newImages].slice(0, 5);
    }

    if (removeAttachments !== null || newAttachments.length > 0) {
      const currentAttachments = Array.isArray(post.attachments) ? post.attachments : [];
      const kept = currentAttachments.filter((f) => !removedAttachmentSet.has(String(f.url)));
      updates.attachments = [...kept, ...newAttachments].slice(0, 3);
    }

    const updated = await DiscussionPost.findByIdAndUpdate(id, { $set: updates }, { new: true })
      .populate("author", USER_SAFE_DATA);

    // Best-effort delete removed files from disk
    if (removeImages && removeImages.length > 0) {
      await Promise.all(removeImages.map((u) => deleteUploadByUrl(u)));
    }
    if (removeAttachments && removeAttachments.length > 0) {
      await Promise.all(removeAttachments.map((u) => deleteUploadByUrl(u)));
    }

    return res.json({ message: "Post updated", data: toPostUi(updated) });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
  }
);

// DELETE /api/v1/posts/:id
postsRouter.delete("/:id", userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const post = await DiscussionPost.findById(id).select("author");
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isOwner = String(post.author) === String(req.user._id);
    if (!isOwner && !isAdmin(req.user)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await DiscussionPost.deleteOne({ _id: id });
    await DiscussionComment.deleteMany({ postId: id });
    await DiscussionPostVote.deleteMany({ postId: id });

    return res.json({ message: "Post deleted" });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// POST /api/v1/posts/:id/vote
// Upvote toggle
postsRouter.post("/:id/vote", userAuth, voteLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const post = await DiscussionPost.findById(id).select("_id voteCount");
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const existing = await DiscussionPostVote.findOne({ postId: id, userId: req.user._id }).select("_id");

    if (existing) {
      await DiscussionPostVote.deleteOne({ _id: existing._id });
      await DiscussionPost.updateOne({ _id: id, voteCount: { $gt: 0 } }, { $inc: { voteCount: -1 } });
      const updated = await DiscussionPost.findById(id).select("voteCount");
      return res.json({ message: "Vote removed", data: { voteCount: updated?.voteCount ?? 0, viewerVote: 0 } });
    }

    await DiscussionPostVote.create({ postId: id, userId: req.user._id });
    await DiscussionPost.updateOne({ _id: id }, { $inc: { voteCount: 1 } });
    const updated = await DiscussionPost.findById(id).select("voteCount");
    return res.json({ message: "Voted", data: { voteCount: updated?.voteCount ?? 0, viewerVote: 1 } });
  } catch (err) {
    // Duplicate unique index means already voted
    if (String(err?.code) === "11000") {
      return res.status(200).json({ message: "Already voted", data: { viewerVote: 1 } });
    }
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// POST /api/v1/posts/:id/comments
postsRouter.post("/:id/comments", userAuth, commentLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const content = normalizeString(req.body?.content);
    if (!content) {
      return res.status(400).json({ message: "content is required" });
    }

    const post = await DiscussionPost.findById(id).select("_id");
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const created = await DiscussionComment.create({ postId: id, content, author: req.user._id });
    const comment = await DiscussionComment.findById(created._id).populate("author", USER_SAFE_DATA);

    return res.json({ message: "Comment added", data: toCommentUi(comment) });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// POST /api/v1/posts/:id/report
postsRouter.post("/:id/report", userAuth, commentLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid post id" });
    }

    const reason = normalizeString(req.body?.reason);

    const post = await DiscussionPost.findById(id).select("_id");
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    await DiscussionPost.updateOne(
      { _id: id },
      {
        $push: {
          reports: {
            reporter: req.user._id,
            reason,
            createdAt: new Date(),
          },
        },
      }
    );

    return res.json({ message: "Reported" });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// POST /api/v1/posts/comments/:commentId/report
postsRouter.post("/comments/:commentId/report", userAuth, commentLimiter, async (req, res) => {
  try {
    const { commentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ message: "Invalid comment id" });
    }

    const reason = normalizeString(req.body?.reason);

    const comment = await DiscussionComment.findById(commentId).select("_id");
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    await DiscussionComment.updateOne(
      { _id: commentId },
      {
        $push: {
          reports: {
            reporter: req.user._id,
            reason,
            createdAt: new Date(),
          },
        },
      }
    );

    return res.json({ message: "Reported" });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

module.exports = postsRouter;

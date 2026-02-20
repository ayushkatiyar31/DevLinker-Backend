const mongoose = require("mongoose");
const Project = require("../models/project");
const ProjectComment = require("../models/projectComment");
const ProjectEvent = require("../models/projectEvent");

const safeLogEvent = async ({ ownerId, projectId, actorUserId, kind, action }) => {
  try {
    await ProjectEvent.create({
      ownerId,
      projectId,
      actorUserId: actorUserId || null,
      kind,
      action: action || "",
    });
  } catch {
    // analytics should never break core flows
  }
};

const USER_SAFE_DATA =
  "fullName photoUrl role isPremium";

const mapUserToUi = (u) => {
  if (!u) return null;
  return {
    id: u._id?.toString(),
    name: u.fullName,
    avatar_url: u.photoUrl,
    role: u.role,
    is_premium: Boolean(u.isPremium),
  };
};

const mapCommentToUi = (c) => {
  const obj = c?.toObject ? c.toObject({ virtuals: true }) : c;
  return {
    id: obj.id ?? obj._id?.toString(),
    projectId: obj.projectId?.toString(),
    userId: obj.userId?._id ? obj.userId._id.toString() : obj.userId?.toString(),
    user: obj.userId?._id ? mapUserToUi(obj.userId) : null,
    content: obj.content,
    createdAt: obj.createdAt,
    likes: (obj.likes ?? []).map((x) => x?.toString?.() ?? String(x)),
    replies: (obj.replies ?? []).map((r) => ({
      id: r._id?.toString(),
      userId: r.userId?._id ? r.userId._id.toString() : r.userId?.toString(),
      user: r.userId?._id ? mapUserToUi(r.userId) : null,
      content: r.content,
      createdAt: r.createdAt,
      likes: (r.likes ?? []).map((x) => x?.toString?.() ?? String(x)),
    })),
  };
};

exports.listComments = async (req, res) => {
  try {
    const { projectId } = req.params;
    const sort = String(req.query.sort || "top");

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const exists = await Project.exists({ _id: projectId });
    if (!exists) return res.status(404).json({ message: "Project not found" });

    // Note: likes is an array; sorting by it isn't meaningful without aggregation.
    // Keep it simple: "new" and "top" both default to newest-first.
    const sortSpec = { createdAt: -1 };

    const comments = await ProjectComment.find({ projectId })
      .sort(sortSpec)
      .populate("userId", USER_SAFE_DATA)
      .populate("replies.userId", USER_SAFE_DATA);

    res.json({ message: "Comments fetched successfully", data: comments.map(mapCommentToUi) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch comments" });
  }
};

exports.addComment = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;
    const { content } = req.body || {};

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId).select("ownerId");
    if (!project) return res.status(404).json({ message: "Project not found" });

    const text = String(content || "").trim();
    if (!text) return res.status(400).json({ message: "content is required" });

    const comment = await ProjectComment.create({
      projectId,
      userId: user._id,
      content: text,
    });

    const populated = await ProjectComment.findById(comment._id)
      .populate("userId", USER_SAFE_DATA)
      .populate("replies.userId", USER_SAFE_DATA);

    await safeLogEvent({
      ownerId: project.ownerId,
      projectId: project._id,
      actorUserId: user._id,
      kind: "comment",
      action: "add",
    });

    res.status(201).json({ message: "Comment added", data: mapCommentToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to add comment" });
  }
};

exports.addReply = async (req, res) => {
  try {
    const user = req.user;
    const { projectId, commentId } = req.params;
    const { content } = req.body || {};

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    if (!mongoose.isValidObjectId(commentId)) {
      return res.status(400).json({ message: "Invalid commentId" });
    }

    const text = String(content || "").trim();
    if (!text) return res.status(400).json({ message: "content is required" });

    const comment = await ProjectComment.findOne({ _id: commentId, projectId });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const project = await Project.findById(projectId).select("ownerId");
    if (!project) return res.status(404).json({ message: "Project not found" });

    comment.replies.push({ userId: user._id, content: text });
    await comment.save();

    const populated = await ProjectComment.findById(comment._id)
      .populate("userId", USER_SAFE_DATA)
      .populate("replies.userId", USER_SAFE_DATA);

    await safeLogEvent({
      ownerId: project.ownerId,
      projectId: project._id,
      actorUserId: user._id,
      kind: "reply",
      action: "add",
    });

    res.json({ message: "Reply added", data: mapCommentToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to add reply" });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const user = req.user;
    const { projectId, commentId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    if (!mongoose.isValidObjectId(commentId)) {
      return res.status(400).json({ message: "Invalid commentId" });
    }

    const comment = await ProjectComment.findOne({ _id: commentId, projectId });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const userId = user._id.toString();
    const idx = comment.likes.findIndex((id) => id.toString() === userId);
    const action = idx >= 0 ? "remove" : "add";
    if (idx >= 0) comment.likes.splice(idx, 1);
    else comment.likes.push(user._id);

    await comment.save();

    const populated = await ProjectComment.findById(comment._id)
      .populate("userId", USER_SAFE_DATA)
      .populate("replies.userId", USER_SAFE_DATA);

    const project = await Project.findById(projectId).select("ownerId");
    if (project) {
      await safeLogEvent({
        ownerId: project.ownerId,
        projectId: project._id,
        actorUserId: user._id,
        kind: "like_comment",
        action,
      });
    }

    res.json({ message: "Like updated", data: mapCommentToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to like" });
  }
};

exports.toggleReplyLike = async (req, res) => {
  try {
    const user = req.user;
    const { projectId, commentId, replyId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    if (!mongoose.isValidObjectId(commentId)) {
      return res.status(400).json({ message: "Invalid commentId" });
    }
    if (!mongoose.isValidObjectId(replyId)) {
      return res.status(400).json({ message: "Invalid replyId" });
    }

    const comment = await ProjectComment.findOne({ _id: commentId, projectId });
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const reply = comment.replies.id(replyId);
    if (!reply) return res.status(404).json({ message: "Reply not found" });

    const userId = user._id.toString();
    const idx = reply.likes.findIndex((id) => id.toString() === userId);
    const action = idx >= 0 ? "remove" : "add";
    if (idx >= 0) reply.likes.splice(idx, 1);
    else reply.likes.push(user._id);

    await comment.save();

    const populated = await ProjectComment.findById(comment._id)
      .populate("userId", USER_SAFE_DATA)
      .populate("replies.userId", USER_SAFE_DATA);

    const project = await Project.findById(projectId).select("ownerId");
    if (project) {
      await safeLogEvent({
        ownerId: project.ownerId,
        projectId: project._id,
        actorUserId: user._id,
        kind: "like_reply",
        action,
      });
    }

    res.json({ message: "Like updated", data: mapCommentToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to like" });
  }
};

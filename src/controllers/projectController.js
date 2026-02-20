const mongoose = require("mongoose");
const crypto = require("crypto");
const Project = require("../models/project");
const User = require("../models/user");
const ProjectEvent = require("../models/projectEvent");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium";

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

const mapOwnerToUi = (owner) => {
  if (!owner) return null;
  return {
    id: owner._id?.toString(),
    name: owner.fullName,
    avatar_url: owner.photoUrl,
    role: owner.role,
    bio: owner.bio ?? owner.about,
    skills: owner.skills,
    experience: owner.experience,
    location: owner.location,
    availability: owner.availability,
    github: owner.github,
    linkedin: owner.linkedin,
    portfolio: owner.portfolio,
    is_premium: Boolean(owner.isPremium),
  };
};

const mapProjectToUi = (projectDoc) => {
  const p = projectDoc?.toObject ? projectDoc.toObject({ virtuals: true }) : projectDoc;

  const upvoteIdsRaw = (p.upvotes ?? []).map((x) => x?.toString?.() ?? String(x));
  const downvoteIdsRaw = (p.downvotes ?? []).map((x) => x?.toString?.() ?? String(x));
  const upvoteIds = Array.from(new Set(upvoteIdsRaw));
  const downvoteIds = Array.from(new Set(downvoteIdsRaw));

  return {
    id: p.id ?? p._id?.toString(),
    title: p.title,
    description: p.description,
    fullDescription: p.fullDescription ?? p.description,
    techStack: Array.isArray(p.techStack) ? p.techStack : [],
    lookingFor: Array.isArray(p.lookingFor) ? p.lookingFor : [],
    teamSize: p.teamSize ?? "",
    category: p.category ?? "Other",
    status: p.status ?? "active",
    createdAt: p.createdAt,
    media: {
      images: p.media?.images ?? [],
      videos: p.media?.videos ?? [],
      links: p.media?.links ?? [],
    },
    upvotes: upvoteIds,
    downvotes: downvoteIds,
    upvotesCount: upvoteIds.length,
    downvotesCount: downvoteIds.length,
    netVotes:
      upvoteIds.length - downvoteIds.length,
    views: p.views ?? 0,
    viewedBy: (p.viewedBy ?? []).map((x) => x?.toString?.() ?? String(x)),
    interestedCount: p.interestedCount ?? (p.interestedUserIds?.length ?? 0),
    owner: mapOwnerToUi(p.ownerId),
  };
};

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

const getOrSetGuestViewerId = (req, res) => {
  const existing = req.cookies?.viewerId;
  if (existing && typeof existing === "string" && existing.trim()) return existing.trim();

  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  // Keep it long-lived so repeat visits from same browser don't count again.
  res.cookie("viewerId", id, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
  });
  return id;
};

const buildListFilter = ({ category, search }) => {
  const filter = {};

  const normalizedCategory = normalizeString(category);
  if (normalizedCategory && normalizedCategory.toLowerCase() !== "all") {
    filter.category = normalizedCategory;
  }

  const q = normalizeString(search);
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: "i" } },
      { description: { $regex: q, $options: "i" } },
      { techStack: { $elemMatch: { $regex: q, $options: "i" } } },
      { lookingFor: { $elemMatch: { $regex: q, $options: "i" } } },
    ];
  }

  return filter;
};

exports.listProjects = async (req, res) => {
  try {
    const page = Number.parseInt(String(req.query.page ?? "1"), 10) || 1;
    let limit = Number.parseInt(String(req.query.limit ?? "10"), 10) || 10;
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const filter = buildListFilter({
      category: req.query.category,
      search: req.query.search,
    });

    const projects = await Project.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("ownerId", USER_SAFE_DATA);

    res.json({
      message: "Projects fetched successfully",
      data: projects.map(mapProjectToUi),
      page,
      limit,
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch projects" });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId).populate("ownerId", USER_SAFE_DATA);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Increment views only once per unique viewer.
    // - Authenticated: unique by user id
    // - Anonymous: unique by a long-lived viewerId cookie
    const viewerUserId = req.user?._id;
    const guestViewerId = viewerUserId ? null : getOrSetGuestViewerId(req, res);

    let didCountView = false;
    if (viewerUserId) {
      const hasViewed = project.viewedBy.some((id) => id.toString() === viewerUserId.toString());
      if (!hasViewed) {
        project.viewedBy.push(viewerUserId);
        project.views = (project.views || 0) + 1;
        didCountView = true;
        await project.save();
      }
    } else if (guestViewerId) {
      const viewedByGuests = Array.isArray(project.viewedByGuests) ? project.viewedByGuests : [];
      const hasViewed = viewedByGuests.includes(guestViewerId);
      if (!hasViewed) {
        project.viewedByGuests = viewedByGuests.concat([guestViewerId]);
        project.views = (project.views || 0) + 1;
        didCountView = true;
        await project.save();
      }
    }

    if (didCountView) {
      await safeLogEvent({
        ownerId: project.ownerId?._id || project.ownerId,
        projectId: project._id,
        actorUserId: viewerUserId || null,
        kind: "view",
        action: "add",
      });
    }

    res.json({ message: "Project fetched successfully", data: mapProjectToUi(project) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch project" });
  }
};

exports.createProject = async (req, res) => {
  try {
    const user = req.user;
    if (!user?._id) return res.status(401).json({ message: "Please Login!" });

    const body = req.body || {};

    const title = normalizeString(body.title);
    const description = normalizeString(body.description);

    if (!title || !description) {
      return res.status(400).json({ message: "title and description are required" });
    }

    const techStack = normalizeStringArray(body.techStack);
    const lookingFor = normalizeStringArray(body.lookingFor);

    const media = {
      images: Array.isArray(body?.media?.images) ? body.media.images : Array.isArray(body.images) ? body.images : [],
      videos: Array.isArray(body?.media?.videos) ? body.media.videos : Array.isArray(body.videos) ? body.videos : [],
      links: Array.isArray(body?.media?.links) ? body.media.links : Array.isArray(body.links) ? body.links : [],
    };

    const project = await Project.create({
      ownerId: user._id,
      title,
      description,
      fullDescription: normalizeString(body.fullDescription) || description,
      techStack,
      lookingFor,
      teamSize: normalizeString(body.teamSize),
      category: normalizeString(body.category) || "Other",
      status: "active",
      media,
    });

    const populated = await Project.findById(project._id).populate("ownerId", USER_SAFE_DATA);

    res.status(201).json({ message: "Project created successfully", data: mapProjectToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to create project" });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (project.ownerId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You are not allowed to update this project" });
    }

    const body = req.body || {};

    if (body.title !== undefined) project.title = normalizeString(body.title);
    if (body.description !== undefined) project.description = normalizeString(body.description);
    if (body.fullDescription !== undefined) project.fullDescription = normalizeString(body.fullDescription);
    if (body.teamSize !== undefined) project.teamSize = normalizeString(body.teamSize);
    if (body.category !== undefined) project.category = normalizeString(body.category);
    if (body.status !== undefined) project.status = normalizeString(body.status);

    if (body.techStack !== undefined) project.techStack = normalizeStringArray(body.techStack);
    if (body.lookingFor !== undefined) project.lookingFor = normalizeStringArray(body.lookingFor);

    if (body.media !== undefined) {
      project.media = {
        images: Array.isArray(body.media?.images) ? body.media.images : project.media?.images ?? [],
        videos: Array.isArray(body.media?.videos) ? body.media.videos : project.media?.videos ?? [],
        links: Array.isArray(body.media?.links) ? body.media.links : project.media?.links ?? [],
      };
    }

    await project.save();

    const populated = await Project.findById(project._id).populate("ownerId", USER_SAFE_DATA);
    res.json({ message: "Project updated successfully", data: mapProjectToUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to update project" });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (project.ownerId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You are not allowed to delete this project" });
    }

    await Project.deleteOne({ _id: project._id });

    res.json({ message: "Project deleted successfully", data: { id: projectId } });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to delete project" });
  }
};

exports.toggleInterest = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId).populate("ownerId", USER_SAFE_DATA);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const userId = user._id.toString();
    const existingIndex = project.interestedUserIds.findIndex((id) => id.toString() === userId);

    let interested = false;
    let action = "";
    if (existingIndex >= 0) {
      project.interestedUserIds.splice(existingIndex, 1);
      interested = false;
      action = "remove";
    } else {
      project.interestedUserIds.push(user._id);
      interested = true;
      action = "add";
    }

    await project.save();

    await safeLogEvent({
      ownerId: project.ownerId?._id || project.ownerId,
      projectId: project._id,
      actorUserId: user._id,
      kind: "interest",
      action,
    });

    res.json({
      message: interested ? "Interest added" : "Interest removed",
      data: {
        project: mapProjectToUi(project),
        interested,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to update interest" });
  }
};

exports.voteProject = async (req, res) => {
  try {
    const user = req.user;
    const { projectId } = req.params;
    const { type } = req.body || {};

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId).populate("ownerId", USER_SAFE_DATA);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const userId = user._id.toString();
    project.upvotes = (project.upvotes || []).filter((id) => id.toString() !== userId);
    project.downvotes = (project.downvotes || []).filter((id) => id.toString() !== userId);

    let action = "";
    if (type === "up") {
      project.upvotes.push(user._id);
      action = "up";
    } else if (type === "down") {
      project.downvotes.push(user._id);
      action = "down";
    } else if (type === "clear" || !type) {
      // no-op, vote cleared
      action = "clear";
    } else {
      return res.status(400).json({ message: "type must be up, down, or clear" });
    }

    await project.save();

    await safeLogEvent({
      ownerId: project.ownerId?._id || project.ownerId,
      projectId: project._id,
      actorUserId: user._id,
      kind: "vote",
      action,
    });

    res.json({ message: "Vote updated", data: mapProjectToUi(project) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to vote" });
  }
};

exports.listProjectsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const projects = await Project.find({ ownerId: userId })
      .sort({ createdAt: -1 })
      .populate("ownerId", USER_SAFE_DATA);

    res.json({ message: "Projects fetched successfully", data: projects.map(mapProjectToUi) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch projects" });
  }
};

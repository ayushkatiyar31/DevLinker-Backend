const mongoose = require("mongoose");
const Project = require("../models/project");
const ProjectComment = require("../models/projectComment");
const ProjectEvent = require("../models/projectEvent");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium";

const startOfDayUtc = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const isoDateKey = (d) => {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const day = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getIsoWeekKey = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const buildEmptyDailySeries = (days) => {
  const today = startOfDayUtc(new Date());
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    series.push({
      date: isoDateKey(d),
      views: 0,
      votes: 0,
      interests: 0,
      comments: 0,
      likes: 0,
      interactions: 0,
    });
  }
  return series;
};

const mapProjectListItem = (p, interaction = {}) => {
  const upvotesCount = Array.isArray(p.upvotes) ? p.upvotes.length : 0;
  const downvotesCount = Array.isArray(p.downvotes) ? p.downvotes.length : 0;
  const interestsCount = Array.isArray(p.interestedUserIds) ? p.interestedUserIds.length : 0;

  return {
    id: String(p._id),
    ownerId: p.ownerId ? String(p.ownerId) : undefined,
    title: p.title,
    description: p.description,
    fullDescription: p.fullDescription,
    techStack: Array.isArray(p.techStack) ? p.techStack : [],
    lookingFor: Array.isArray(p.lookingFor) ? p.lookingFor : [],
    teamSize: p.teamSize,
    category: p.category,
    status: p.status,
    media: p.media,
    views: Number(p.views || 0),
    upvotesCount,
    downvotesCount,
    netVotes: upvotesCount - downvotesCount,
    interestsCount,
    interactions: {
      interactions: Number(interaction.interactions || 0),
      views: Number(interaction.views || 0),
      votes: Number(interaction.votes || 0),
      interests: Number(interaction.interests || 0),
      comments: Number(interaction.comments || 0),
      likes: Number(interaction.likes || 0),
    },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

const mapUserToUi = (u) => {
  if (!u) return null;
  const id = u._id?.toString?.() ?? String(u._id);
  return {
    id,
    name: u.fullName,
    avatar_url: u.photoUrl,
    role: u.role,
    is_premium: Boolean(u.isPremium),
  };
};

exports.listMyProjects = async (req, res) => {
  try {
    const user = req.user;
    const projects = await Project.find({ ownerId: user._id })
      .sort({ createdAt: -1 })
      .select(
        "ownerId title description fullDescription techStack lookingFor teamSize category status media views upvotes downvotes interestedUserIds createdAt updatedAt"
      )
      .lean();

    const projectIds = projects.map((p) => p._id);

    const eventAgg = projectIds.length
      ? await ProjectEvent.aggregate([
          {
            $match: {
              ownerId: user._id,
              projectId: { $in: projectIds },
            },
          },
          {
            $group: {
              _id: { projectId: "$projectId", kind: "$kind", action: "$action" },
              count: { $sum: 1 },
            },
          },
        ])
      : [];

    const interactionsByProjectId = new Map();
    for (const row of eventAgg) {
      const pid = row?._id?.projectId ? String(row._id.projectId) : null;
      if (!pid) continue;
      const kind = row?._id?.kind;
      const action = row?._id?.action;
      const count = Number(row?.count || 0);

      const agg = interactionsByProjectId.get(pid) || {
        interactions: 0,
        views: 0,
        votes: 0,
        interests: 0,
        comments: 0,
        likes: 0,
      };

      agg.interactions += count;

      if (kind === "view" && action === "add") agg.views += count;
      else if (kind === "vote" && (action === "up" || action === "down")) agg.votes += count;
      else if (kind === "interest" && action === "add") agg.interests += count;
      else if ((kind === "comment" || kind === "reply") && action === "add") agg.comments += count;
      else if ((kind === "like_comment" || kind === "like_reply") && action === "add") agg.likes += count;

      interactionsByProjectId.set(pid, agg);
    }

    const payload = projects.map((p) =>
      mapProjectListItem(p, interactionsByProjectId.get(String(p._id)))
    );

    res.json({ message: "My projects fetched successfully", data: payload });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch projects" });
  }
};

// Users who showed interest in my projects.
// NOTE: Interest timestamps are not stored (array of userIds), so we return current interested users.
exports.getMyProjectInterests = async (req, res) => {
  try {
    const user = req.user;

    const projects = await Project.find({ ownerId: user._id })
      .select("title interestedUserIds")
      .populate("interestedUserIds", USER_SAFE_DATA)
      .lean();

    const grouped = projects.map((p) => {
      const usersRaw = Array.isArray(p.interestedUserIds) ? p.interestedUserIds : [];
      const users = usersRaw
        .map(mapUserToUi)
        .filter((x) => x && String(x.id) !== String(user._id));

      return {
        project: { id: String(p._id), title: p.title || "Untitled" },
        users,
        count: users.length,
      };
    });

    // Unique people across all projects
    const unique = new Map();
    for (const g of grouped) {
      for (const u of g.users) {
        if (!unique.has(u.id)) unique.set(u.id, u);
      }
    }

    res.json({
      message: "Project interests fetched successfully",
      data: {
        projects: grouped,
        uniqueUsers: Array.from(unique.values()),
      },
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch interests" });
  }
};

exports.getMyProjectDashboard = async (req, res) => {
  try {
    const user = req.user;

    const days = Math.min(Math.max(Number.parseInt(String(req.query.days ?? "7"), 10) || 7, 1), 30);
    const weeks = Math.min(Math.max(Number.parseInt(String(req.query.weeks ?? "4"), 10) || 4, 1), 12);

    const now = new Date();
    const fromDaily = startOfDayUtc(new Date(now.getTime() - (days - 1) * 86400000));
    const fromWeekly = startOfDayUtc(new Date(now.getTime() - (weeks * 7 - 1) * 86400000));

    const myProjects = await Project.find({ ownerId: user._id })
      .select("title views upvotes downvotes interestedUserIds createdAt updatedAt")
      .lean();

    const projectIds = myProjects.map((p) => p._id);

    const totalsFromProjects = myProjects.reduce(
      (acc, p) => {
        acc.projects += 1;
        acc.views += p.views || 0;
        acc.upvotes += Array.isArray(p.upvotes) ? p.upvotes.length : 0;
        acc.downvotes += Array.isArray(p.downvotes) ? p.downvotes.length : 0;
        acc.interests += Array.isArray(p.interestedUserIds) ? p.interestedUserIds.length : 0;
        return acc;
      },
      { projects: 0, views: 0, upvotes: 0, downvotes: 0, interests: 0 }
    );

    const commentAgg = projectIds.length
      ? await ProjectComment.aggregate([
          { $match: { projectId: { $in: projectIds } } },
          {
            $group: {
              _id: null,
              comments: { $sum: 1 },
              replies: {
                $sum: {
                  $cond: [
                    { $isArray: "$replies" },
                    { $size: "$replies" },
                    0,
                  ],
                },
              },
            },
          },
        ])
      : [];

    const commentsTotal = commentAgg?.[0]?.comments ?? 0;
    const repliesTotal = commentAgg?.[0]?.replies ?? 0;

    const dailySeries = buildEmptyDailySeries(days);
    const dailyIndex = new Map(dailySeries.map((row, i) => [row.date, i]));

    // Aggregate events for daily chart.
    const dailyEvents = await ProjectEvent.aggregate([
      {
        $match: {
          ownerId: user._id,
          createdAt: { $gte: fromDaily, $lte: now },
        },
      },
      {
        $project: {
          kind: 1,
          action: 1,
          day: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
        },
      },
      {
        $group: {
          _id: { day: "$day", kind: "$kind", action: "$action" },
          count: { $sum: 1 },
        },
      },
    ]);

    for (const row of dailyEvents) {
      const day = row?._id?.day;
      const kind = row?._id?.kind;
      const action = row?._id?.action;
      const count = row?.count ?? 0;
      const idx = dailyIndex.get(day);
      if (idx === undefined) continue;

      const target = dailySeries[idx];
      if (kind === "view" && action === "add") target.views += count;
      else if (kind === "vote" && (action === "up" || action === "down")) target.votes += count;
      else if (kind === "interest" && action === "add") target.interests += count;
      else if (kind === "comment" && action === "add") target.comments += count;
      else if (kind === "reply" && action === "add") target.comments += count;
      else if ((kind === "like_comment" || kind === "like_reply") && action === "add") target.likes += count;
    }

    dailySeries.forEach((d) => {
      d.interactions = d.views + d.votes + d.interests + d.comments + d.likes;
    });

    // Weekly chart: re-bucket daily series into ISO weeks.
    const weeklyMap = new Map();
    for (const d of dailySeries.concat([])) {
      const [y, m, dd] = d.date.split("-").map((n) => Number(n));
      const dateObj = new Date(Date.UTC(y, m - 1, dd));
      const wk = getIsoWeekKey(dateObj);
      const prev = weeklyMap.get(wk) || {
        week: wk,
        views: 0,
        votes: 0,
        interests: 0,
        comments: 0,
        likes: 0,
        interactions: 0,
      };
      prev.views += d.views;
      prev.votes += d.votes;
      prev.interests += d.interests;
      prev.comments += d.comments;
      prev.likes += d.likes;
      prev.interactions += d.interactions;
      weeklyMap.set(wk, prev);
    }

    const weeklySeries = Array.from(weeklyMap.values()).sort((a, b) => a.week.localeCompare(b.week));

    // Top projects by engagement in the time window.
    const topProjectsAgg = await ProjectEvent.aggregate([
      {
        $match: {
          ownerId: user._id,
          createdAt: { $gte: fromWeekly, $lte: now },
        },
      },
      {
        $group: {
          _id: "$projectId",
          interactions: { $sum: 1 },
          views: {
            $sum: {
              $cond: [{ $eq: ["$kind", "view"] }, 1, 0],
            },
          },
          votes: {
            $sum: {
              $cond: [{ $eq: ["$kind", "vote"] }, 1, 0],
            },
          },
          comments: {
            $sum: {
              $cond: [{ $in: ["$kind", ["comment", "reply"]] }, 1, 0],
            },
          },
          interests: {
            $sum: {
              $cond: [{ $eq: ["$kind", "interest"] }, 1, 0],
            },
          },
        },
      },
      { $sort: { interactions: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: "projects",
          localField: "_id",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: { $toString: "$_id" },
          title: "$project.title",
          interactions: 1,
          views: 1,
          votes: 1,
          comments: 1,
          interests: 1,
        },
      },
    ]);

    const totals = {
      ...totalsFromProjects,
      netVotes: totalsFromProjects.upvotes - totalsFromProjects.downvotes,
      comments: commentsTotal,
      replies: repliesTotal,
      interactions: dailySeries.reduce((acc, r) => acc + (r.interactions || 0), 0),
    };

    res.json({
      message: "Project dashboard fetched successfully",
      data: {
        totals,
        daily: dailySeries,
        weekly: weeklySeries,
        topProjects: topProjectsAgg,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch dashboard" });
  }
};

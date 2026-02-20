const express = require("express");
const userRouter = express.Router();

const { userAuth } = require("../middlewares/auth");
const { checkProfileComplete } = require("../middlewares/checkProfileComplete");
const ConnectionRequest = require("../models/connectionRequest");
const User = require("../models/user");
const { Chat } = require("../models/chat");
const ProfileView = require("../models/profileView");
const mongoose = require("mongoose");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium isProfileComplete";

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const toShortDayLabel = (date) => {
  // Use a stable English weekday label for charts
  return new Date(date).toLocaleDateString("en-US", { weekday: "short" });
};

const toMonthLabel = (date) => {
  return new Date(date).toLocaleDateString("en-US", { month: "short" });
};

const safeNumber = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
};

const roundPercent = (num) => {
  const n = Number(num);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
};

const formatAvgResponseTime = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  const totalMinutes = Math.round(n / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

const toViewerUiProfile = (user) => {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.fullName,
    avatar_url: user.photoUrl,
    role: user.role || "",
    is_premium: Boolean(user.isPremium),
  };
};

const groupCountsByDay = (dates, daysBack) => {
  const today = startOfDay(new Date());
  const buckets = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    buckets.push({ key: startOfDay(day).toISOString(), label: toShortDayLabel(day), count: 0 });
  }

  const indexByKey = new Map(buckets.map((b, idx) => [b.key, idx]));
  for (const dt of dates) {
    const key = startOfDay(dt).toISOString();
    const idx = indexByKey.get(key);
    if (idx !== undefined) buckets[idx].count += 1;
  }

  return buckets;
};

const groupCountsByMonth = (dates, monthsBack) => {
  const now = new Date();
  const buckets = [];

  // Build monthsBack buckets, oldest -> newest
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({ key, label: toMonthLabel(d), count: 0 });
  }

  const indexByKey = new Map(buckets.map((b, idx) => [b.key, idx]));
  for (const dt of dates) {
    const d = new Date(dt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = indexByKey.get(key);
    if (idx !== undefined) buckets[idx].count += 1;
  }
  return buckets;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeSkills = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => normalizeString(v)).filter(Boolean);
  }
  // support comma-separated or single skill
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

// Get all the pending connection request for the loggedIn user
userRouter.get("/requests/received", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      toUserId: loggedInUser._id,
      status: "interested",
    }).populate("fromUserId", USER_SAFE_DATA);
    // }).populate("fromUserId", ["firstName", "lastName"]);

    res.json({
      message: "Data fetched successfully",
      data: connectionRequests,
    });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Request failed" });
  }
});

// Get all the sent (outgoing) connection requests by the logged-in user
userRouter.get("/requests/sent", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      fromUserId: loggedInUser._id,
      status: "interested",
    }).populate("toUserId", USER_SAFE_DATA);

    return res.json({
      message: "Data fetched successfully",
      data: connectionRequests,
    });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

userRouter.get("/connections", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequests = await ConnectionRequest.find({
      $or: [
        { toUserId: loggedInUser._id, status: "accepted" },
        { fromUserId: loggedInUser._id, status: "accepted" },
      ],
    })
      .populate("fromUserId", USER_SAFE_DATA)
      .populate("toUserId", USER_SAFE_DATA);

    console.log(connectionRequests);

    const data = connectionRequests.map((row) => {
      if (row.fromUserId._id.toString() === loggedInUser._id.toString()) {
        return row.toUserId;
      }
      return row.fromUserId;
    });

    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Request failed" });
  }
});

userRouter.get("/feed", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const page = parsePositiveInt(req.query.page, 1);
    let limit = parsePositiveInt(req.query.limit, 10);
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const skills = normalizeSkills(req.query.skills);
    const experience = normalizeString(req.query.experience);
    const role = normalizeString(req.query.role);
    const availability = normalizeString(req.query.availability);
    const location = normalizeString(req.query.location);

    const connectionRequests = await ConnectionRequest.find({
      $or: [{ fromUserId: loggedInUser._id }, { toUserId: loggedInUser._id }],
    }).select("fromUserId  toUserId");

    const hideUsersFromFeed = new Set();
    connectionRequests.forEach((req) => {
      hideUsersFromFeed.add(req.fromUserId.toString());
      hideUsersFromFeed.add(req.toUserId.toString());
    });

    const filterQuery = {
      $and: [
        { _id: { $nin: Array.from(hideUsersFromFeed) } },
        { _id: { $ne: loggedInUser._id } },
        { isProfileComplete: true },
      ],
    };

    if (skills.length > 0) {
      filterQuery.skills = { $in: skills };
    }
    if (experience && experience !== "any") {
      filterQuery.experience = experience;
    }
    if (role && role !== "any") {
      filterQuery.role = role;
    }
    if (availability && availability !== "any") {
      filterQuery.availability = availability;
    }
    if (location) {
      filterQuery.location = { $regex: location, $options: "i" };
    }

    // Fetch limit+1 to compute hasMore
    const users = await User.find(filterQuery)
      .select(USER_SAFE_DATA)
      .skip(skip)
      .limit(limit + 1);

    const hasMore = users.length > limit;
    const sliced = hasMore ? users.slice(0, limit) : users;

    res.json({ data: sliced, page, limit, hasMore });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// User analytics dashboard (real data; safe defaults for untracked metrics)
userRouter.get("/dashboard", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const userId = loggedInUser._id;

    const now = new Date();
    const today = startOfDay(now);

    const currentWindowStart = addDays(today, -29); // last 30 days inclusive
    const previousWindowStart = addDays(currentWindowStart, -30);
    const previousWindowEnd = addDays(currentWindowStart, -1);

    const [
      interestsReceivedCurrent,
      interestsReceivedPrev,
      acceptedConnectionsCurrent,
      acceptedConnectionsPrev,
    ] = await Promise.all([
      ConnectionRequest.countDocuments({
        toUserId: userId,
        status: "interested",
        createdAt: { $gte: currentWindowStart, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        toUserId: userId,
        status: "interested",
        createdAt: { $gte: previousWindowStart, $lte: previousWindowEnd },
      }),
      ConnectionRequest.countDocuments({
        $or: [{ toUserId: userId }, { fromUserId: userId }],
        status: "accepted",
        createdAt: { $gte: currentWindowStart, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        $or: [{ toUserId: userId }, { fromUserId: userId }],
        status: "accepted",
        createdAt: { $gte: previousWindowStart, $lte: previousWindowEnd },
      }),
    ]);

    const messagesAggCurrent = await Chat.aggregate([
      { $match: { participants: new mongoose.Types.ObjectId(userId) } },
      { $unwind: "$messages" },
      { $match: { "messages.createdAt": { $gte: currentWindowStart, $lte: now } } },
      { $count: "count" },
    ]);
    const messagesAggPrev = await Chat.aggregate([
      { $match: { participants: new mongoose.Types.ObjectId(userId) } },
      { $unwind: "$messages" },
      { $match: { "messages.createdAt": { $gte: previousWindowStart, $lte: previousWindowEnd } } },
      { $count: "count" },
    ]);

    const messagesCurrent = safeNumber(messagesAggCurrent?.[0]?.count);
    const messagesPrev = safeNumber(messagesAggPrev?.[0]?.count);

    const [profileViewsAggCurrent, profileViewsAggPrev] = await Promise.all([
      ProfileView.countDocuments({
        viewedUserId: userId,
        viewedAt: { $gte: currentWindowStart, $lte: now },
      }),
      ProfileView.countDocuments({
        viewedUserId: userId,
        viewedAt: { $gte: previousWindowStart, $lte: previousWindowEnd },
      }),
    ]);

    const profileViewsCurrent = safeNumber(profileViewsAggCurrent);
    const profileViewsPrev = safeNumber(profileViewsAggPrev);

    const stats = [
      {
        label: "Profile Views",
        value: profileViewsCurrent,
        change: profileViewsCurrent - profileViewsPrev,
        trend: [],
      },
      {
        label: "Connections",
        value: acceptedConnectionsCurrent,
        change: acceptedConnectionsCurrent - acceptedConnectionsPrev,
        trend: [],
      },
      {
        label: "Messages",
        value: messagesCurrent,
        change: messagesCurrent - messagesPrev,
        trend: [],
      },
      {
        label: "Interests Received",
        value: interestsReceivedCurrent,
        change: interestsReceivedCurrent - interestsReceivedPrev,
        trend: [],
      },
    ];

    // Weekly activity: last 7 days
    const profileViewsLast7 = await ProfileView.find({
      viewedUserId: userId,
      viewedAt: { $gte: addDays(today, -6), $lte: now },
    }).select("viewedAt");

    const acceptedLast7 = await ConnectionRequest.find({
      $or: [{ toUserId: userId }, { fromUserId: userId }],
      status: "accepted",
      createdAt: { $gte: addDays(today, -6), $lte: now },
    }).select("createdAt");

    const messagesLast7 = await Chat.aggregate([
      { $match: { participants: new mongoose.Types.ObjectId(userId) } },
      { $unwind: "$messages" },
      { $match: { "messages.createdAt": { $gte: addDays(today, -6), $lte: now } } },
      { $project: { createdAt: "$messages.createdAt" } },
    ]);

    const acceptedDayBuckets = groupCountsByDay(
      acceptedLast7.map((r) => r.createdAt),
      7
    );
    const messageDayBuckets = groupCountsByDay(
      messagesLast7.map((r) => r.createdAt),
      7
    );
    const viewDayBuckets = groupCountsByDay(
      profileViewsLast7.map((r) => r.viewedAt),
      7
    );

    const weeklyActivity = acceptedDayBuckets.map((b, idx) => ({
      day: b.label,
      views: viewDayBuckets[idx]?.count ?? 0,
      connections: b.count,
      messages: messageDayBuckets[idx]?.count ?? 0,
    }));

    // Monthly growth: last 6 months
    const profileViewsLast6m = await ProfileView.find({
      viewedUserId: userId,
      viewedAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1), $lte: now },
    }).select("viewedAt");

    const acceptedLast6m = await ConnectionRequest.find({
      $or: [{ toUserId: userId }, { fromUserId: userId }],
      status: "accepted",
      createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1), $lte: now },
    }).select("createdAt");

    const messagesLast6m = await Chat.aggregate([
      { $match: { participants: new mongoose.Types.ObjectId(userId) } },
      { $unwind: "$messages" },
      { $match: { "messages.createdAt": { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1), $lte: now } } },
      { $project: { createdAt: "$messages.createdAt" } },
    ]);

    const acceptedMonthBuckets = groupCountsByMonth(
      acceptedLast6m.map((r) => r.createdAt),
      6
    );
    const messageMonthBuckets = groupCountsByMonth(
      messagesLast6m.map((r) => r.createdAt),
      6
    );
    const viewMonthBuckets = groupCountsByMonth(
      profileViewsLast6m.map((r) => r.viewedAt),
      6
    );

    const monthlyGrowth = acceptedMonthBuckets.map((b, idx) => ({
      month: b.label,
      connections: b.count,
      matches: b.count,
      views: viewMonthBuckets[idx]?.count ?? 0,
      messages: messageMonthBuckets[idx]?.count ?? 0,
    }));

    // Who viewed you (last 30 days): group by viewer
    const viewerGroups = await ProfileView.aggregate([
      {
        $match: {
          viewedUserId: new mongoose.Types.ObjectId(userId),
          viewedAt: { $gte: currentWindowStart, $lte: now },
        },
      },
      {
        $group: {
          _id: "$viewerUserId",
          count: { $sum: 1 },
          lastViewedAt: { $max: "$viewedAt" },
        },
      },
      { $sort: { lastViewedAt: -1 } },
      { $limit: 20 },
    ]);

    const viewerIds = viewerGroups.map((g) => g._id).filter(Boolean);
    const viewerUsers = viewerIds.length
      ? await User.find({ _id: { $in: viewerIds } }).select(USER_SAFE_DATA)
      : [];
    const viewerById = new Map(viewerUsers.map((u) => [String(u._id), u]));

    const profileViewers = viewerGroups
      .map((g) => {
        const u = viewerById.get(String(g._id));
        if (!u) return null;
        return {
          profile: toViewerUiProfile(u),
          viewedAt: g.lastViewedAt,
          count: safeNumber(g.count),
        };
      })
      .filter(Boolean);

    // Skills attracting views: use viewer skills frequencies weighted by view count
    const skillCounts = new Map();
    let totalSkillViews = 0;
    for (const g of viewerGroups) {
      const u = viewerById.get(String(g._id));
      const skills = Array.isArray(u?.skills) ? u.skills : [];
      const weight = safeNumber(g.count);
      for (const s of skills) {
        const key = String(s || "").trim();
        if (!key) continue;
        skillCounts.set(key, (skillCounts.get(key) || 0) + weight);
        totalSkillViews += weight;
      }
    }
    const topSkillsViewed = Array.from(skillCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([skill, views]) => ({
        skill,
        views,
        percentage: totalSkillViews ? roundPercent((views / totalSkillViews) * 100) : 0,
      }));

    // Match rate (based on connection requests you sent)
    const last7Start = addDays(today, -6);
    const prev7Start = addDays(last7Start, -7);
    const prev7End = addDays(last7Start, -1);

    const [sent30, matched30, sent7, matched7, sentPrev7, matchedPrev7] = await Promise.all([
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: { $in: ["interested", "accepted"] },
        createdAt: { $gte: currentWindowStart, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: "accepted",
        createdAt: { $gte: currentWindowStart, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: { $in: ["interested", "accepted"] },
        createdAt: { $gte: last7Start, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: "accepted",
        createdAt: { $gte: last7Start, $lte: now },
      }),
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: { $in: ["interested", "accepted"] },
        createdAt: { $gte: prev7Start, $lte: prev7End },
      }),
      ConnectionRequest.countDocuments({
        fromUserId: userId,
        status: "accepted",
        createdAt: { $gte: prev7Start, $lte: prev7End },
      }),
    ]);

    const matchPct30 = sent30 ? (matched30 / sent30) * 100 : 0;
    const matchPct7 = sent7 ? (matched7 / sent7) * 100 : 0;
    const matchPctPrev7 = sentPrev7 ? (matchedPrev7 / sentPrev7) * 100 : 0;

    const matchRate = {
      percentage: roundPercent(matchPct30),
      weeklyChange: roundPercent(matchPct7 - matchPctPrev7),
      matched: safeNumber(matched30),
      sent: safeNumber(sent30),
    };

    // Response rate (rough estimate from chats): for each received msg, did user reply after it?
    const chatsForResponse = await Chat.find({ participants: userId }).select("participants messages");
    let received = 0;
    let responded = 0;
    let totalResponseMs = 0;
    let responseSamples = 0;

    for (const chat of chatsForResponse) {
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      // messages are in insertion order; sort just in case
      const sorted = messages
        .map((m) => ({
          senderId: String(m.senderId),
          createdAt: m.createdAt ? new Date(m.createdAt) : null,
        }))
        .filter((m) => m.createdAt && !Number.isNaN(m.createdAt.getTime()))
        .sort((a, b) => a.createdAt - b.createdAt);

      for (let i = 0; i < sorted.length; i++) {
        const m = sorted[i];
        if (m.createdAt < currentWindowStart || m.createdAt > now) continue;
        if (m.senderId === String(userId)) continue;

        received += 1;

        // find next message from user after this one
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          if (next.createdAt < currentWindowStart || next.createdAt > now) continue;
          if (next.senderId === String(userId)) {
            responded += 1;
            const diff = next.createdAt.getTime() - m.createdAt.getTime();
            if (diff > 0) {
              totalResponseMs += diff;
              responseSamples += 1;
            }
            break;
          }
        }
      }
    }

    const responsePct = received ? (responded / received) * 100 : 0;
    const avgResponseTime = responseSamples ? totalResponseMs / responseSamples : 0;

    const responseRate = {
      percentage: roundPercent(responsePct),
      avgResponseTime: formatAvgResponseTime(avgResponseTime),
      responded,
      received,
    };

    // Peak hours (profile views + messages) in last 30 days
    const peakHoursMap = new Map(Array.from({ length: 24 }, (_, h) => [h, 0]));
    const profileViewsForHours = await ProfileView.find({
      viewedUserId: userId,
      viewedAt: { $gte: currentWindowStart, $lte: now },
    }).select("viewedAt");
    for (const v of profileViewsForHours) {
      const d = new Date(v.viewedAt);
      const h = d.getHours();
      peakHoursMap.set(h, (peakHoursMap.get(h) || 0) + 1);
    }
    // Add message activity too
    const messagesForHours = await Chat.aggregate([
      { $match: { participants: new mongoose.Types.ObjectId(userId) } },
      { $unwind: "$messages" },
      { $match: { "messages.createdAt": { $gte: currentWindowStart, $lte: now } } },
      { $project: { createdAt: "$messages.createdAt" } },
    ]);
    for (const m of messagesForHours) {
      const d = new Date(m.createdAt);
      const h = d.getHours();
      peakHoursMap.set(h, (peakHoursMap.get(h) || 0) + 1);
    }
    const peakHours = Array.from({ length: 24 }, (_, hour) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      activity: peakHoursMap.get(hour) || 0,
    }));

    // Recent activity (mix of connection events and messages)
    const recentIncomingInterests = await ConnectionRequest.find({
      toUserId: userId,
      status: "interested",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("fromUserId", USER_SAFE_DATA);

    const recentAccepted = await ConnectionRequest.find({
      $or: [{ toUserId: userId }, { fromUserId: userId }],
      status: "accepted",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("fromUserId", USER_SAFE_DATA)
      .populate("toUserId", USER_SAFE_DATA);

    const recentChats = await Chat.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate("participants", USER_SAFE_DATA);

    const recentActivity = [];

    for (const reqRow of recentIncomingInterests) {
      const fromUser = reqRow.fromUserId;
      recentActivity.push({
        type: "interest",
        text: `${fromUser?.fullName || "Someone"} sent you a connection request`,
        time: reqRow.createdAt,
        avatar: fromUser?.photoUrl,
      });
    }

    for (const reqRow of recentAccepted) {
      const fromUser = reqRow.fromUserId;
      const toUser = reqRow.toUserId;
      const other = String(fromUser?._id) === String(userId) ? toUser : fromUser;
      recentActivity.push({
        type: "connection",
        text: `You connected with ${other?.fullName || "a user"}`,
        time: reqRow.createdAt,
        avatar: other?.photoUrl,
      });
    }

    for (const chat of recentChats) {
      const lastMessage = Array.isArray(chat.messages) && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
      if (!lastMessage) continue;

      const senderId = lastMessage.senderId?.toString?.() || String(lastMessage.senderId);
      const sender = Array.isArray(chat.participants)
        ? chat.participants.find((p) => String(p?._id) === String(senderId))
        : null;

      recentActivity.push({
        type: "message",
        text: `New message${sender?.fullName ? ` from ${sender.fullName}` : ""}`,
        time: lastMessage.createdAt,
        avatar: sender?.photoUrl,
      });
    }

    recentActivity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // Keep the response compatible with the current Dashboard.jsx structure
    return res.json({
      data: {
        stats,
        weeklyActivity,
        monthlyGrowth,
        recentActivity: recentActivity.slice(0, 10),
        topSkillsViewed,
        profileViewers,
        matchRate,
        responseRate,
        peakHours,
      },
    });
  } catch (err) {
    return res.status(400).json({ message: err?.message || "Request failed" });
  }
});

userRouter.post("/swipe-left", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { toUserId } = req.body || {};

    if (!toUserId) {
      return res.status(400).json({ message: "toUserId is required" });
    }

    const toUser = await User.findById(toUserId);
    if (!toUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await ConnectionRequest.findOne({
      fromUserId: loggedInUser._id,
      toUserId,
    });
    if (existing) {
      return res.json({ message: "Already swiped", data: existing });
    }

    const connectionRequest = new ConnectionRequest({
      fromUserId: loggedInUser._id,
      toUserId,
      status: "ignored",
    });

    const data = await connectionRequest.save();
    res.json({ message: "Swiped left", data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

userRouter.post("/swipe-right", userAuth, checkProfileComplete, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const { toUserId } = req.body || {};

    if (!toUserId) {
      return res.status(400).json({ message: "toUserId is required" });
    }

    const toUser = await User.findById(toUserId);
    if (!toUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await ConnectionRequest.findOne({
      fromUserId: loggedInUser._id,
      toUserId,
    });
    if (existing) {
      // If already interested, we can still return match status based on reciprocal.
      const reciprocal = await ConnectionRequest.findOne({
        fromUserId: toUserId,
        toUserId: loggedInUser._id,
        status: "interested",
      });
      return res.json({
        message: "Already swiped",
        data: existing,
        matched: Boolean(reciprocal),
      });
    }

    const reciprocalInterested = await ConnectionRequest.findOne({
      fromUserId: toUserId,
      toUserId: loggedInUser._id,
      status: "interested",
    });

    const connectionRequest = new ConnectionRequest({
      fromUserId: loggedInUser._id,
      toUserId,
      status: "interested",
    });

    const data = await connectionRequest.save();

    if (reciprocalInterested) {
      // Mark both as accepted to represent a match
      await ConnectionRequest.updateMany(
        {
          $or: [
            { fromUserId: loggedInUser._id, toUserId },
            { fromUserId: toUserId, toUserId: loggedInUser._id },
          ],
        },
        { $set: { status: "accepted" } }
      );

      return res.json({ message: "It's a match!", data, matched: true });
    }

    res.json({ message: "Connection request sent", data, matched: false });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// View another user's profile
// Keep this at the bottom to avoid conflicting with other /user/* routes.
userRouter.get("/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const viewerId = req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const user = await User.findById(userId).select(USER_SAFE_DATA);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Track profile view (best-effort; never break the request)
    try {
      if (viewerId && String(viewerId) !== String(userId)) {
        const now = new Date();
        const dayStart = startOfDay(now);

        // Count at most 1 view per viewer per day (prevents refresh spam)
        const alreadyCountedToday = await ProfileView.findOne({
          viewedUserId: userId,
          viewerUserId: viewerId,
          viewedAt: { $gte: dayStart, $lte: now },
        }).select("_id");

        if (!alreadyCountedToday) {
          await ProfileView.create({
            viewedUserId: userId,
            viewerUserId: viewerId,
            viewedAt: now,
          });
        }
      }
    } catch (_) {
      // ignore tracking errors
    }

    return res.json({ data: user });
  } catch (err) {
    return res.status(500).json({ message: err?.message || "Request failed" });
  }
});
module.exports = userRouter;

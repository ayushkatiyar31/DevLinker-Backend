const Gig = require("../models/gig");
const GigApplication = require("../models/gigApplication");
const User = require("../models/user");
const ConnectionRequest = require("../models/connectionRequest");
const Notification = require("../models/notification");
const { Chat } = require("../models/chat");
const { mapGigToUi } = require("./gigController");

const USER_SAFE_DATA =
  "fullName photoUrl bio about skills role experience location availability github linkedin portfolio isPremium isProfileComplete";

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

const toApplicationUi = (app) => {
  return {
    id: String(app._id),
    gigId: String(app.gig?._id || app.gig),
    gig: app.gig
      ? {
          id: String(app.gig._id),
          title: app.gig.title,
          category: app.gig.category,
          budgetType: app.gig.budgetType,
          budgetMin: app.gig.budgetMin,
          budgetMax: app.gig.budgetMax,
          owner: toOwnerUi(app.gig.owner),
        }
      : null,
    applicant: app.applicant
      ? {
          id: String(app.applicant._id),
          name: app.applicant.fullName,
          avatar_url: app.applicant.photoUrl,
          is_premium: Boolean(app.applicant.isPremium),
          role: app.applicant.role || "",
          location: app.applicant.location || "",
        }
      : null,
    proposal: app.proposal,
    expectedDelivery: app.expectedDelivery,
    budgetQuote: app.budgetQuote,
    attachments: app.attachments || [],
    status: app.status,
    createdAt: app.createdAt ? new Date(app.createdAt).toISOString() : null,
  };
};

// GET /api/v1/gig/dashboard/freelancer
const getFreelancerDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    const savedGigsIds = req.user.savedGigs || [];
    const savedGigs = await Gig.find({ _id: { $in: savedGigsIds } }).populate("owner", USER_SAFE_DATA);

    const applications = await GigApplication.find({ applicant: userId })
      .sort({ createdAt: -1 })
      .populate({ path: "gig", populate: { path: "owner", select: USER_SAFE_DATA } })
      .populate("applicant", USER_SAFE_DATA);

    const appliedGigsIds = applications.map((a) => a.gig?._id).filter(Boolean);

    const accepted = applications.filter((a) => a.status === "accepted");

    // weekly applications: last 4 weeks buckets
    const now = new Date();
    const weeks = [];
    for (let i = 3; i >= 0; i -= 1) {
      const start = new Date(now);
      start.setDate(now.getDate() - i * 7);
      const label = `W${4 - i}`;
      weeks.push({ label, start });
    }

    const weeklyApplications = weeks.map((w, idx) => {
      const start = new Date(w.start);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      const count = applications.filter((a) => {
        const t = new Date(a.createdAt);
        return t >= start && t < end;
      }).length;
      return { week: `W${idx + 1}`, applications: count };
    });

    const statusMap = new Map();
    for (const app of applications) {
      const key = app.status;
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }

    const applicationsByStatus = [
      { status: "Pending", key: "pending", color: "hsl(var(--chart-1))" },
      { status: "Accepted", key: "accepted", color: "hsl(var(--chart-2))" },
      { status: "Rejected", key: "rejected", color: "hsl(var(--chart-3))" },
    ].map((x) => ({ status: x.status, count: statusMap.get(x.key) || 0, color: x.color }));

    const data = {
      appliedGigs: appliedGigsIds.map((id) => String(id)),
      savedGigs: await Promise.all(savedGigs.map((g) => mapGigToUi(g))),
      acceptedGigs: accepted.map((a) => String(a.gig?._id)).filter(Boolean),
      totalEarnings: 0,
      activeProjects: 0,
      completedProjects: 0,
      successRate: 0,
      avgRating: 0,
      weeklyApplications,
      applicationsByStatus,
      applications: applications.map(toApplicationUi),
    };

    res.json({ message: "Freelancer dashboard fetched", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch freelancer dashboard" });
  }
};

// GET /api/v1/gig/dashboard/client
const getClientDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    const postedGigs = await Gig.find({ owner: userId })
      .sort({ createdAt: -1 })
      .populate("owner", USER_SAFE_DATA);

    const gigIds = postedGigs.map((g) => g._id);

    const applicationsReceived = await GigApplication.find({ gig: { $in: gigIds } })
      .sort({ createdAt: -1 })
      .populate({ path: "gig", populate: { path: "owner", select: USER_SAFE_DATA } })
      .populate("applicant", USER_SAFE_DATA);

    const totalGigsPosted = postedGigs.length;
    const activeGigs = postedGigs.filter((g) => g.status === "open" || g.status === "in_progress").length;
    const completedGigs = postedGigs.filter((g) => g.status === "completed").length;

    const avgGigBudget = totalGigsPosted
      ? Math.round(
          postedGigs.reduce((sum, g) => sum + (Number(g.budgetMax) || 0), 0) / totalGigsPosted
        )
      : 0;

    const applicationsByGigMap = new Map();
    for (const app of applicationsReceived) {
      const gigTitle = app.gig?.title || "Gig";
      applicationsByGigMap.set(gigTitle, (applicationsByGigMap.get(gigTitle) || 0) + 1);
    }

    const applicationsByGig = Array.from(applicationsByGigMap.entries()).map(([gig, count]) => ({ gig, count }));

    const gigPerformance = await Promise.all(
      postedGigs.slice(0, 10).map(async (g) => {
        const count = await GigApplication.countDocuments({ gig: g._id });
        return {
          gigId: String(g._id),
          gig: g.title,
          views: g.views || 0,
          applications: count,
          status: g.status,
        };
      })
    );

    const data = {
      postedGigs: await Promise.all(postedGigs.map((g) => mapGigToUi(g))),
      totalGigsPosted,
      activeGigs,
      completedGigs,
      applicationsReceived: applicationsReceived.map(toApplicationUi),
      acceptedFreelancers: [],
      totalSpent: 0,
      avgGigBudget,
      gigPerformance,
      monthlySpending: [],
      applicationsByGig,
    };

    res.json({ message: "Client dashboard fetched", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch client dashboard" });
  }
};

// POST /api/v1/gig/:gigId/applications/:applicationId/decision
const decideGigApplication = async (req, res) => {
  try {
    const { gigId, applicationId } = req.params;
    const status = String(req.body?.status || "").trim();

    if (!status || !["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "status must be 'accepted' or 'rejected'" });
    }

    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    if (String(gig.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const application = await GigApplication.findOne({ _id: applicationId, gig: gigId });
    if (!application) return res.status(404).json({ message: "Application not found" });

    const prevStatus = application.status;
    application.status = status;
    await application.save();

    // Side effects only when transitioning to accepted
    if (status === "accepted" && prevStatus !== "accepted") {
      const ownerId = req.user._id;
      const applicantId = application.applicant;

      // Ensure they are connected so chat permissions work.
      try {
        const existing = await ConnectionRequest.findOne({
          $or: [
            { fromUserId: ownerId, toUserId: applicantId },
            { fromUserId: applicantId, toUserId: ownerId },
          ],
        }).select("_id status");

        if (existing) {
          if (existing.status !== "accepted") {
            await ConnectionRequest.updateOne({ _id: existing._id }, { $set: { status: "accepted" } });
          }
        } else {
          await ConnectionRequest.create({
            fromUserId: ownerId,
            toUserId: applicantId,
            status: "accepted",
          });
        }
      } catch {
        // connection should not break accept flow
      }

      // Create chat thread if missing.
      try {
        const existingChat = await Chat.findOne({
          participants: { $all: [ownerId, applicantId] },
        }).select("_id");

        if (!existingChat) {
          await Chat.create({ participants: [ownerId, applicantId], messages: [] });
        }
      } catch {
        // chat should not break accept flow
      }

      // Notify applicant.
      try {
        const gigTitle = gig.title || "your gig";
        await Notification.create({
          userId: applicantId,
          type: "gig",
          title: "Application accepted",
          description: `Your application was accepted for: ${gigTitle}`,
          metadata: {
            gigId: String(gig._id),
            applicationId: String(application._id),
            ownerId: String(ownerId),
          },
        });
      } catch {
        // ignore
      }
    }

    const populated = await GigApplication.findById(application._id)
      .populate({ path: "gig", populate: { path: "owner", select: USER_SAFE_DATA } })
      .populate("applicant", USER_SAFE_DATA);

    res.json({ message: "Application updated", data: toApplicationUi(populated) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to update application" });
  }
};

// GET /api/v1/gig/:gigId/applications (owner-only)
const listGigApplicationsForGig = async (req, res) => {
  try {
    const { gigId } = req.params;

    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    if (String(gig.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const applications = await GigApplication.find({ gig: gigId })
      .sort({ createdAt: -1 })
      .populate({ path: "gig", populate: { path: "owner", select: USER_SAFE_DATA } })
      .populate("applicant", USER_SAFE_DATA);

    res.json({ message: "Applications fetched", data: applications.map(toApplicationUi) });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch applications" });
  }
};

// POST /api/v1/gig/saved/:gigId (toggle)
const toggleSaveGig = async (req, res) => {
  try {
    const { gigId } = req.params;
    const gig = await Gig.findById(gigId);
    if (!gig) return res.status(404).json({ message: "Gig not found" });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const set = new Set((user.savedGigs || []).map((id) => String(id)));
    const key = String(gig._id);

    if (set.has(key)) {
      user.savedGigs = (user.savedGigs || []).filter((id) => String(id) !== key);
    } else {
      user.savedGigs = [...(user.savedGigs || []), gig._id];
    }

    await user.save();

    res.json({ message: "Saved gigs updated", data: { savedGigs: (user.savedGigs || []).map((id) => String(id)) } });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to save gig" });
  }
};

// GET /api/v1/gig/saved
const listSavedGigs = async (req, res) => {
  try {
    const ids = req.user.savedGigs || [];
    const gigs = await Gig.find({ _id: { $in: ids } }).populate("owner", USER_SAFE_DATA);
    const data = [];
    for (const g of gigs) data.push(await mapGigToUi(g));
    res.json({ message: "Saved gigs fetched", data });
  } catch (err) {
    res.status(400).json({ message: err?.message || "Failed to fetch saved gigs" });
  }
};

module.exports = {
  getFreelancerDashboard,
  getClientDashboard,
  decideGigApplication,
  listGigApplicationsForGig,
  toggleSaveGig,
  listSavedGigs,
};

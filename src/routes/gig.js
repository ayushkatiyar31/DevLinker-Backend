const express = require("express");
const gigRouter = express.Router();

const { userAuth, optionalAuth } = require("../middlewares/auth");

const {
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
} = require("../controllers/gigController");

const {
  getFreelancerDashboard,
  getClientDashboard,
  decideGigApplication,
  listGigApplicationsForGig,
  toggleSaveGig,
  listSavedGigs,
} = require("../controllers/gigDashboardController");

// Listing + create
gigRouter.get("/", userAuth, listGigs);

gigRouter.post("/", userAuth, createGig);

// Dashboards
gigRouter.get("/dashboard/freelancer", userAuth, getFreelancerDashboard);
gigRouter.get("/dashboard/client", userAuth, getClientDashboard);

// Saved gigs
gigRouter.get("/saved", userAuth, listSavedGigs);
gigRouter.post("/saved/:gigId", userAuth, toggleSaveGig);

// Comments
gigRouter.get("/:gigId/comments", userAuth, listGigComments);
gigRouter.post("/:gigId/comments", userAuth, addGigComment);
gigRouter.post("/:gigId/comments/:commentId/like", userAuth, toggleGigCommentLike);
gigRouter.post("/:gigId/comments/:commentId/reply", userAuth, addGigCommentReply);

// Applications & votes
gigRouter.post("/:gigId/apply", userAuth, applyToGig);
gigRouter.get("/:gigId/my-application", userAuth, getMyGigApplication);
gigRouter.get("/:gigId/applications", userAuth, listGigApplicationsForGig);
gigRouter.post("/:gigId/applications/:applicationId/decision", userAuth, decideGigApplication);
gigRouter.post("/:gigId/vote", userAuth, voteGig);

// Detail + update + delete
// Note: optionalAuth retained for future anonymous browsing; currently protected in FE.
gigRouter.get("/:gigId", optionalAuth, getGigById);
gigRouter.patch("/:gigId", userAuth, updateGig);
gigRouter.delete("/:gigId", userAuth, deleteGig);

module.exports = gigRouter;

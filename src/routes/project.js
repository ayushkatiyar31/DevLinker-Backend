const express = require("express");
const projectRouter = express.Router();

const { userAuth, optionalAuth } = require("../middlewares/auth");

const {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  toggleInterest,
  voteProject,
  listProjectsByUser,
} = require("../controllers/projectController");

const {
  listMyProjects,
  getMyProjectDashboard,
  getMyProjectInterests,
} = require("../controllers/projectDashboardController");

const {
  listComments,
  addComment,
  addReply,
  toggleLike,
  toggleReplyLike,
} = require("../controllers/projectCommentController");

// Public
projectRouter.get("/", listProjects);
projectRouter.get("/user/:userId", listProjectsByUser);

// Authenticated (owner)
projectRouter.get("/me", userAuth, listMyProjects);
projectRouter.get("/dashboard", userAuth, getMyProjectDashboard);
projectRouter.get("/interests", userAuth, getMyProjectInterests);

// Detail is public, but supports optional auth for view de-dupe.
// We keep it public by NOT adding userAuth here.
projectRouter.get("/:projectId", optionalAuth, getProjectById);

// Authenticated actions
projectRouter.post("/", userAuth, createProject);
projectRouter.patch("/:projectId", userAuth, updateProject);
projectRouter.delete("/:projectId", userAuth, deleteProject);

projectRouter.post("/:projectId/interest", userAuth, toggleInterest);
projectRouter.post("/:projectId/vote", userAuth, voteProject);

// Comments
projectRouter.get("/:projectId/comments", listComments);
projectRouter.post("/:projectId/comments", userAuth, addComment);
projectRouter.post("/:projectId/comments/:commentId/replies", userAuth, addReply);
projectRouter.post("/:projectId/comments/:commentId/like", userAuth, toggleLike);
projectRouter.post(
  "/:projectId/comments/:commentId/replies/:replyId/like",
  userAuth,
  toggleReplyLike
);

module.exports = projectRouter;

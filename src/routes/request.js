const express = require("express");
const requestRouter = express.Router();

const { userAuth } = require("../middlewares/auth");
const { checkProfileComplete } = require("../middlewares/checkProfileComplete");
const ConnectionRequest = require("../models/connectionRequest");
const User = require("../models/user");
const Notification = require("../models/notification");

const sendEmail = require("../utils/sendEmail");

requestRouter.post(
  "/send/:status/:toUserId",
  userAuth,
  checkProfileComplete,
  async (req, res) => {
    try {
      const fromUserId = req.user._id;
      const toUserId = req.params.toUserId;
      const status = req.params.status;
      const meta = req.body && typeof req.body === "object" ? req.body.meta || req.body.metadata || {} : {};

      const allowedStatus = ["ignored", "interested"];
      if (!allowedStatus.includes(status)) {
        return res
          .status(400)
          .json({ message: "Invalid status type: " + status });
      }

      const toUser = await User.findById(toUserId);
      if (!toUser) {
        return res.status(404).json({ message: "User not found!" });
      }

      // Support toggling (interested <-> ignored) for the same direction.
      const existingSameDirection = await ConnectionRequest.findOne({
        fromUserId,
        toUserId,
      });
      if (existingSameDirection) {
        if (existingSameDirection.status === status) {
          return res.json({
            message: "Connection request already " + status,
            data: existingSameDirection,
            updated: false,
          });
        }

        existingSameDirection.status = status;
        const data = await existingSameDirection.save();

        if (status === "interested") {
          try {
            await Notification.create({
              userId: toUserId,
              type: "connection",
              title: "New connection request",
              description: `${req.user.fullName} is interested in connecting.`,
              metadata: {
                fromUserId: String(fromUserId),
                requestId: String(data._id),
                ...(meta && typeof meta === "object" ? meta : {}),
              },
            });
          } catch {
            // notification should never break request flow
          }
        }

        return res.json({
          message: "Connection request updated to " + status,
          data,
          updated: true,
        });
      }

      // Prevent duplicates in the opposite direction.
      const existingOppositeDirection = await ConnectionRequest.findOne({
        fromUserId: toUserId,
        toUserId: fromUserId,
      });
      if (existingOppositeDirection) {
        return res.status(400).json({
          message: "Connection Request Already Exists!!",
        });
      }

      const connectionRequest = new ConnectionRequest({
        fromUserId,
        toUserId,
        status,
      });

      const data = await connectionRequest.save();

      if (status === "interested") {
        try {
          await Notification.create({
            userId: toUserId,
            type: "connection",
            title: "New connection request",
            description: `${req.user.fullName} is interested in connecting.`,
            metadata: {
              fromUserId: String(fromUserId),
              requestId: String(data._id),
              ...(meta && typeof meta === "object" ? meta : {}),
            },
          });
        } catch {
          // ignore
        }
      }

      // const emailRes = await sendEmail.run(
      //   "A new friend request from " + req.user.firstName,
      //   req.user.firstName + " is " + status + " in " + toUser.firstName
      // );
      // console.log(emailRes);

      res.json({
        message:
          req.user.firstName + " is " + status + " in " + toUser.firstName,
        data,
      });
    } catch (err) {
      res.status(400).json({ message: err?.message || "Request failed" });
    }
  }
);

requestRouter.post(
  "/review/:status/:requestId",
  userAuth,
  checkProfileComplete,
  async (req, res) => {
    try {
      const loggedInUser = req.user;
      const { status, requestId } = req.params;

      const allowedStatus = ["accepted", "rejected"];
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ messaage: "Status not allowed!" });
      }

      const connectionRequest = await ConnectionRequest.findOne({
        _id: requestId,
        toUserId: loggedInUser._id,
        status: "interested",
      });
      if (!connectionRequest) {
        return res
          .status(404)
          .json({ message: "Connection request not found" });
      }

      connectionRequest.status = status;

      const data = await connectionRequest.save();

      res.json({ message: "Connection request " + status, data });
    } catch (err) {
      res.status(400).json({ message: err?.message || "Request failed" });
    }
  }
);

module.exports = requestRouter;

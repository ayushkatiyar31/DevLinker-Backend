const jwt = require("jsonwebtoken");
const User = require("../models/user");

const resolveUserFromRequest = async (req) => {
  const cookieToken = req.cookies?.token;
  const authHeader = req.headers?.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

  const token = cookieToken || bearerToken;
  if (!token) return null;

  const jwtSecret = process.env.JWT_SECRET || "DEV@Tinder$790";
  const decodedObj = await jwt.verify(token, jwtSecret);
  const { _id } = decodedObj;
  if (!_id) return null;

  const user = await User.findById(_id);
  return user || null;
};

const userAuth = async (req, res, next) => {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ message: "Please Login!" });
    }

    req.user = user;
    next();
  } catch (err) {
    const msg = err?.message || "Authentication failed";
    // Common jwt errors should be treated as 401
    const isJwtError =
      msg.includes("jwt") ||
      msg.includes("token") ||
      msg.includes("signature") ||
      msg.includes("expired");
    res.status(isJwtError ? 401 : 400).json({ message: msg });
  }
};

// Best-effort auth: attaches req.user when token is valid, otherwise continues.
const optionalAuth = async (req, _res, next) => {
  try {
    const user = await resolveUserFromRequest(req);
    if (user) req.user = user;
  } catch {
    // ignore
  }
  next();
};

module.exports = {
  userAuth,
  optionalAuth,
};

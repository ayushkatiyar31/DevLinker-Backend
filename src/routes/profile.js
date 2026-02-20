const express = require("express");
const profileRouter = express.Router();

const fs = require("fs");
const path = require("path");
const multer = require("multer");

const { userAuth } = require("../middlewares/auth");
const { validateEditProfileData } = require("../utils/validation");

const PROFILE_UPLOAD_DIR = path.join(process.cwd(), "uploads", "profile", "images");

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
};

const safeFilename = (originalName) => {
  const raw = String(originalName || "photo");
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const ext = path.extname(cleaned) || ".jpg";
  const base = cleaned.slice(0, -ext.length) || "photo";
  return `${Date.now()}_${Math.round(Math.random() * 1e9)}_${base}${ext}`;
};

const uploadProfilePhoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      ensureDir(PROFILE_UPLOAD_DIR);
      cb(null, PROFILE_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      cb(null, safeFilename(file?.originalname));
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const type = String(file?.mimetype || "");
    if (!type.startsWith("image/")) {
      return cb(new Error("Only image uploads are supported"));
    }
    return cb(null, true);
  },
});

const deleteOldProfileUploadIfAny = async (photoUrl) => {
  const u = String(photoUrl || "").trim();
  if (!u) return;

  // Handle both absolute and relative urls.
  const marker = "/uploads/profile/images/";
  const idx = u.indexOf(marker);
  if (idx === -1) return;

  const base = path.basename(u.slice(idx + marker.length));
  if (!base) return;

  const diskPath = path.join(PROFILE_UPLOAD_DIR, base);
  try {
    await fs.promises.unlink(diskPath);
  } catch {
    // ignore
  }
};

profileRouter.get("/profile/view", userAuth, async (req, res) => {
  try {
    const user = req.user;

    res.send(user);
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

profileRouter.patch("/profile/edit", userAuth, async (req, res) => {
  try {
    if (!validateEditProfileData(req)) {
      throw new Error("Invalid Edit Request");
    }

    const loggedInUser = req.user;

    Object.keys(req.body).forEach((key) => (loggedInUser[key] = req.body[key]));

    await loggedInUser.save();

    res.json({
      message: `${loggedInUser.fullName}, your profile updated successfuly`,
      data: loggedInUser,
    });
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

// POST /api/v1/profile/profile/photo
// multipart/form-data: photo=<image>
profileRouter.post(
  "/profile/photo",
  userAuth,
  (req, res, next) => {
    const handler = uploadProfilePhoto.single("photo");
    return handler(req, res, (err) => {
      if (!err) return next();
      return res.status(400).json({ message: err?.message || "Upload failed" });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "photo file is required" });
      }

      const loggedInUser = req.user;
      await deleteOldProfileUploadIfAny(loggedInUser.photoUrl);

      const proto = req.get("x-forwarded-proto") || req.protocol;
      const host = req.get("host");
      const filename = path.basename(req.file.path);
      const publicUrl = `${proto}://${host}/uploads/profile/images/${filename}`;

      loggedInUser.photoUrl = publicUrl;
      await loggedInUser.save();

      return res.json({
        message: "Profile photo updated successfully",
        data: loggedInUser,
      });
    } catch (err) {
      return res.status(400).json({ message: err?.message || "Request failed" });
    }
  }
);

module.exports = profileRouter;

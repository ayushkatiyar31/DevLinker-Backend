const express = require("express");
const authRouter = express.Router();

const { validateSignUpData } = require("../utils/validation");
const { userAuth } = require("../middlewares/auth");
const User = require("../models/user");
const bcrypt = require("bcrypt");

function toSafeUser(userDoc) {
  if (!userDoc) return null;
  const obj = typeof userDoc.toObject === "function" ? userDoc.toObject() : userDoc;
  // Never expose password hashes
  delete obj.password;
  delete obj.confirmPassword;
  return obj;
}

authRouter.post("/signup", async (req, res) => {
  try {
    // Validation of data
    validateSignUpData(req);

    const { firstName, lastName, fullName, emailId, password, confirmPassword } = req.body;
    const computedFullName = fullName || `${firstName} ${lastName}`.trim();

    if (password !== confirmPassword) {
      throw new Error("Passwords do not match");
    }

    // Encrypt the password
    const passwordHash = await bcrypt.hash(password, 10);

    //   Creating a new instance of the User model
    const user = new User({
      firstName,
      lastName,
      fullName: computedFullName,
      emailId,
      password: passwordHash,
      isProfileComplete: false,
    });

    const savedUser = await user.save();
    const token = await savedUser.getJWT();

    res.cookie("token", token, {
      expires: new Date(Date.now() + 8 * 3600000),
    });

    res.json({
      message: "User Added successfully!",
      data: { ...toSafeUser(savedUser), token },
    });
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

authRouter.post("/onboarding", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const {
      role,
      experience,
      location,
      availability,
      github,
      linkedin,
      portfolio,
      skills,
      bio,
      photoUrl,
    } = req.body || {};

    if (role !== undefined) loggedInUser.role = role;
    if (experience !== undefined) loggedInUser.experience = experience;
    if (location !== undefined) loggedInUser.location = location;
    if (availability !== undefined) loggedInUser.availability = availability;
    if (github !== undefined) loggedInUser.github = github;
    if (linkedin !== undefined) loggedInUser.linkedin = linkedin;
    if (portfolio !== undefined) loggedInUser.portfolio = portfolio;
    if (skills !== undefined) loggedInUser.skills = skills;
    if (bio !== undefined) {
      loggedInUser.bio = bio;
     
      loggedInUser.about = bio;
    }
    if (photoUrl !== undefined) loggedInUser.photoUrl = photoUrl;

    loggedInUser.isProfileComplete = true;
    await loggedInUser.save();

    res.json({
      message: "Onboarding completed successfully!",
      data: toSafeUser(loggedInUser),
    });
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { emailId, password } = req.body;

    const user = await User.findOne({ emailId: emailId });
    if (!user) {
      throw new Error("Invalid credentials");
    }
    const isPasswordValid = await user.validatePassword(password);

    if (isPasswordValid) {
      const token = await user.getJWT();

      res.cookie("token", token, {
        expires: new Date(Date.now() + 8 * 3600000),
      });
      res.send({ ...toSafeUser(user), token });
    } else {
      throw new Error("Invalid credentials");
    }
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

authRouter.post("/logout", async (req, res) => {
  res.cookie("token", null, {
    expires: new Date(Date.now()),
  });
  res.send("Logout Successful!!");
});

module.exports = authRouter;

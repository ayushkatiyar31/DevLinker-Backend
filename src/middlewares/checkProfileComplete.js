const checkProfileComplete = (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).send("Please Login!");
    }

    if (!user.isProfileComplete) {
      return res
        .status(403)
        .json({ message: "Please complete onboarding to continue." });
    }

    next();
  } catch (err) {
    res.status(400).send("ERROR: " + err.message);
  }
};

module.exports = { checkProfileComplete };

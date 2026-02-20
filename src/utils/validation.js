const validator = require("validator");

const validateSignUpData = (req) => {
  const { firstName, lastName, fullName, emailId, password } = req.body;
  const hasFullName = typeof fullName === "string" && fullName.trim().length >= 3;
  const hasFirstLast = Boolean(firstName) && Boolean(lastName);

  if (!hasFullName && !hasFirstLast) {
    throw new Error("Name is not valid!");
  } else if (!validator.isEmail(emailId)) {
    throw new Error("Email is not valid!");
  } else if (!validator.isStrongPassword(password)) {
    throw new Error("Please enter a strong Password!");
  }
};

const validateEditProfileData = (req) => {
  const allowedEditFields = [
    "firstName",
    "lastName",
    "fullName",
    "emailId",
    "photoUrl",
    "gender",
    "age",
    "about",
    "skills",
    "role",
    "experience",
    "location",
    "availability",
    "github",
    "linkedin",
    "portfolio",
  ];

  const isEditAllowed = Object.keys(req.body).every((field) =>
    allowedEditFields.includes(field)
  );

  return isEditAllowed;
};

module.exports = {
  validateSignUpData,
  validateEditProfileData,
};

const mongoose = require("mongoose");

const connectDB = async () => {
  console.log("Connecting to:", process.env.DB_CONNECTION_SECRET);
  // Remove the options object - they're not needed in newer versions
  await mongoose.connect(process.env.DB_CONNECTION_SECRET);
  console.log("Database connection established...");
};

module.exports = connectDB;
const express = require("express");
const connectDB = require("./config/database");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");
const http = require("http");
const path = require("path");

require("dotenv").config();

require("./utils/cronjob");

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith("http://localhost:")) return callback(null, true);
      if (origin.startsWith("http://127.0.0.1:")) return callback(null, true);

      // Allow-list from env (comma-separated). Example:
      // CORS_ORIGINS=https://devlinker-frontend.vercel.app,https://dev-linker-frontend.vercel.app
      const envList = String(process.env.CORS_ORIGINS || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      // Known production frontend domains
      const hardcodedAllow = new Set([
        "https://dev-linker-frontend.vercel.app",
        "https://devlinker-frontend.vercel.app",
      ]);

      if (hardcodedAllow.has(origin)) return callback(null, true);
      if (envList.includes(origin)) return callback(null, true);

      // Don’t throw (which becomes a 500 and looks like a server crash).
      // Instead: disallow this origin.
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());


app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");
const paymentRouter = require("./routes/payment");
const { initializeSocket } = require("./utils/socket");
const chatRouter = require("./routes/chat");
const projectRouter = require("./routes/project");
const gigRouter = require("./routes/gig");
const notificationRouter = require("./routes/notification");
const discussRouter = require("./routes/discuss");
const postsRouter = require("./routes/posts");

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/profile", profileRouter);
app.use("/api/v1/request", requestRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/payment", paymentRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/project", projectRouter);
app.use("/api/v1/gig", gigRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/discuss", discussRouter);


app.use("/api/v1/posts", postsRouter);
app.use("/api/posts", postsRouter);

const server = http.createServer(app);
initializeSocket(server);

const normalizePort = (value) => {
  if (value === undefined || value === null) return null;

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return null;
  if (parsed <= 0 || parsed > 65535) return null;
  return parsed;
};

const port = normalizePort(process.env.PORT) ?? 4000;

server.on("error", (err) => {
  if (err?.syscall !== "listen") throw err;

  if (err.code === "EACCES") {
    console.error(`Port ${port} requires elevated privileges or is blocked.`);
    process.exit(1);
  }
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    process.exit(1);
  }

  throw err;
});

// Render requires the service to bind to a port quickly.
// Start listening first, then connect to the database.
server.listen(port, "0.0.0.0", () => {
  console.log(`Server is successfully listening on port ${port}...`);
});

connectDB()
  .then(() => {
    console.log("Database connection established...");
  })
  .catch((err) => {
    console.error("Database cannot be connected!!");
    console.error(err?.message || err);
  });

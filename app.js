if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
require("./models/user");
require("./models/subscription");
require("./models/summary");
require("./models/caption");
const express = require("express");
const app = express();
const session = require("express-session");
const mongoose = require("mongoose");
const MongoDBStore = require("connect-mongo");
const bodyParser = require("body-parser");
const ExpressError = require("./utils/ExpressError");
const cors = require("cors");
const agenda = require("./middlewares/agenda");
const authRoutes = require("./routes/auth");
const transcriptRoutes = require("./routes/transcript");
const stripeRoutes = require("./routes/stripeRoutes");
const stripeWebhook = require("./routes/webhook");
const summaryRoutes = require("./routes/summary");
const { Server } = require("socket.io");
const http = require("http");
const jwt = require("jsonwebtoken");
const User = mongoose.model("User");
const Summary = mongoose.model("Summary");
const Caption = mongoose.model("Caption");
const OpenAI = require('openai');
const { chatPrompt } = require("./utils/prompts");

const openai = new OpenAI({
  apiKey: process.env.GPT_SECRET_KEY
});

// Variables
const PORT = process.env.PORT || 4000;
const mongoURi = process.env.MONGODB_URI || "mongodb://localhost:27017/youtella";
const secret = "thisisnotagoodsecret";

const store = MongoDBStore.create({
  mongoUrl: mongoURi,
  secret,
  touchAfter: 24 * 60 * 60,
});

const sessionConfig = {
  store,
  secret,
  name: "session",
  resave: false,
  saveUninitialized: false,
};

const corsOptions = {
  origin: [
    process.env.DOMAIN_FRONTEND,
    process.env.DOMAIN_SECOND,
  ],
  credentials: true,
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type,Authorization",
};

// Create HTTP server and integrate Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

// Socket.IO middleware to verify JWT
io.use(async (socket, next) => {
  const authHeader = socket.handshake.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new Error("Authentication error: No token"));
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return next(new Error("Authentication error: User not found"));
    }

    socket.userId = user._id;
    next();
  } catch (error) {
    next(new Error("Authentication error: Invalid token"));
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  socket.on("chat_message", async (data) => {
    const { message, summaryId } = data;

    try {
      if (!summaryId) {
        socket.emit("chat_response", "Please select a summary to chat.");
        return;
      }

      // Find summary and verify user ownership
      const summary = await Summary.findOne({
        _id: summaryId,
        userId: socket.userId,
      });
      if (!summary) {
        socket.emit("chat_error", "Invalid summary ID or unauthorized");
        return;
      }

      // Find caption for the video
      const caption = await Caption.findOne({
        videoUrl: summary.videoUrl,
      });

      // Save user message
      summary.chats.push({
        sender: "user",
        text: message,
      });

      // Construct prompt for OpenAI
      const prompt = chatPrompt(summary, caption, message);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: prompt,
        max_tokens: 14000,
        temperature: 0.7,
      });
      const botResponse = completion.choices[0].message.content;

      // Save bot response
      summary.chats.push({
        sender: "bot",
        text: botResponse,
      });

      // Save updated summary
      await summary.save();

      // Send bot response to client
      socket.emit("chat_response", botResponse);
    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit("chat_error", "Server error");
    }
  });

  socket.on("get_summary_chats", async (summaryId) => {
    try {
      const summary = await Summary.findOne({
        _id: summaryId,
        userId: socket.userId,
      }).select("chats");
      if (!summary) {
        socket.emit("chat_error", "Invalid summary ID or unauthorized");
        return;
      }
      socket.emit("summary_chats", summary.chats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      socket.emit("chat_error", "Server error");
    }
  });

  socket.on("disconnect", () => { });
});

// Using the app
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionConfig));

// Define routes that need raw body parsing before JSON parsing
app.use("/api/stripe", stripeWebhook);

// Use JSON parser for all other routes
app.use(bodyParser.json());

// Define other routes after JSON parsing
app.use("/api/auth", authRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api", transcriptRoutes);
app.use("/api", summaryRoutes);

// Start Agenda
agenda.on("ready", () => {
  console.log("Agenda is ready");
  agenda.start();
});

// Error handling for Agenda
agenda.on("error", (err) => {
  console.error("Agenda error:", err);
});

app.get("/", (req, res) => {
  res.send("Welcome to Youtella API");
});

// Handling the error message
app.all("*", (req, res, next) => {
  next(new ExpressError("Page not found", 404));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const { status = 500 } = err;
  if (!err.message) err.message = "Oh No, Something Went Wrong!";
  res.status(status).json({ error: err.message });
});

// Initializing Mongoose
mongoose
  .connect(mongoURi, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log("Mongoose is connected");
  })
  .catch((e) => {
    console.log(e);
  });

// Listen for the port number
server.listen(PORT, () => {
  console.log(`App is listening on http://localhost:${PORT}`);
});
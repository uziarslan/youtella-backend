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
app.listen(PORT, () => {
  console.log(`App is listening on http://localhost:${PORT}`);
});
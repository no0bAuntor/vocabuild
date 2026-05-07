const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
const distPath = path.resolve(process.cwd(), "dist");
app.use(express.json());

const optionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    correct: { type: Boolean, required: true },
  },
  { _id: false },
);

const currentQuestionSchema = new mongoose.Schema(
  {
    entryId: { type: Number, default: null },
    prompt: { type: String, default: null },
    answer: { type: String, default: null },
    options: { type: [optionSchema], default: [] },
  },
  { _id: false },
);

const progressSchema = new mongoose.Schema(
  {
    isActive: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
    reviewMode: { type: Boolean, default: false },
    mode: { type: String, default: "en-bn" },
    questionCount: { type: String, default: "20" },
    selectedSheets: { type: [String], default: [] },
    deckEntryIds: { type: [Number], default: [] },
    currentIndex: { type: Number, default: -1 },
    score: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    mistakeEntryIds: { type: [Number], default: [] },
    selectedAnswer: { type: String, default: null },
    feedbackText: { type: String, default: "" },
    currentQuestion: { type: currentQuestionSchema, default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: "" },
    preferences: {
      activeMode: { type: String, default: "en-bn" },
      questionCount: { type: String, default: "20" },
      selectedSheets: { type: [String], default: [] },
    },
    stats: {
      quizzesStarted: { type: Number, default: 0 },
      quizzesCompleted: { type: Number, default: 0 },
      answeredCount: { type: Number, default: 0 },
      correctCount: { type: Number, default: 0 },
      wrongCount: { type: Number, default: 0 },
      resumedSessions: { type: Number, default: 0 },
      lastPlayedAt: { type: Date, default: null },
    },
    progress: { type: progressSchema, default: () => ({}) },
  },
  { timestamps: true, minimize: false },
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

function normalizeUserId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new Error("User ID must contain letters or numbers.");
  }

  return normalized;
}

function serializeUser(user) {
  const plain = user.toObject({ versionKey: false });
  return {
    userId: plain.userId,
    displayName: plain.displayName,
    preferences: plain.preferences,
    stats: plain.stats,
    progress: plain.progress,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function applyProgressUpdate(user, progress, isActive) {
  user.progress = {
    ...user.progress.toObject(),
    ...progress,
    isActive,
    updatedAt: new Date(),
  };
  user.stats.lastPlayedAt = new Date();
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/users/register", async (request, response) => {
  try {
    const userId = normalizeUserId(request.body.userId);
    const existingUser = await User.findOne({ userId });
    if (existingUser) {
      return response.status(409).json({ error: "That user ID already exists." });
    }

    const user = await User.create({
      userId,
      displayName: String(request.body.displayName || "").trim(),
    });

    return response.status(201).json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to create user." });
  }
});

app.post("/api/users/login", async (request, response) => {
  try {
    const userId = normalizeUserId(request.body.userId);
    const user = await User.findOne({ userId });
    if (!user) {
      return response.status(404).json({ error: "User ID not found." });
    }

    if (user.progress?.isActive) {
      user.stats.resumedSessions += 1;
      await user.save();
    }

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to load user." });
  }
});

app.get("/api/users/:userId", async (request, response) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(request.params.userId) });
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to load user." });
  }
});

app.put("/api/users/:userId/preferences", async (request, response) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(request.params.userId) });
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    user.preferences = {
      ...user.preferences.toObject(),
      ...request.body,
    };
    await user.save();

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to save preferences." });
  }
});

app.post("/api/users/:userId/sessions/start", async (request, response) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(request.params.userId) });
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    applyProgressUpdate(user, request.body.progress || {}, true);
    user.stats.quizzesStarted += 1;
    await user.save();

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to start quiz." });
  }
});

app.put("/api/users/:userId/progress", async (request, response) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(request.params.userId) });
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    applyProgressUpdate(user, request.body.progress || {}, true);
    await user.save();

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Failed to save progress." });
  }
});

app.post("/api/users/:userId/sessions/complete", async (request, response) => {
  try {
    const user = await User.findOne({ userId: normalizeUserId(request.params.userId) });
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    const progress = request.body.progress || {};
    applyProgressUpdate(user, progress, false);
    user.stats.quizzesCompleted += 1;
    user.stats.answeredCount += Number(progress.answeredCount || 0);
    user.stats.correctCount += Number(progress.score || 0);
    user.stats.wrongCount += Math.max(
      Number(progress.answeredCount || 0) - Number(progress.score || 0),
      0,
    );
    await user.save();

    return response.json({ user: serializeUser(user) });
  } catch (error) {
    return response
      .status(400)
      .json({ error: error.message || "Failed to complete and save quiz." });
  }
});

app.use(express.static(distPath));

app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

async function start() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required. Add it to .env.");
  }

  await mongoose.connect(mongoUri);

  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

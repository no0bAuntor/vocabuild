const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
const distPath = path.resolve(process.cwd(), "dist");
const vocabPath = path.join(process.cwd(), "public", "data", "vocabulary.json");
const buildScriptPath = path.join(process.cwd(), "scripts", "build_dataset.py");
const execFileAsync = promisify(execFile);
const vocabSyncIntervalMs = Number(process.env.VOCAB_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const pythonBinary =
  process.env.PYTHON_BIN ||
  process.env.PYTHON ||
  (process.platform === "win32" ? "python" : "python3");

let vocabSyncInFlight = null;
let vocabSyncTimer = null;
let vocabLastSyncAt = null;
const vocabClients = new Set();
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
    questionOrder: { type: String, default: "random" },
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
      questionOrder: { type: String, default: "random" },
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

async function syncVocabularyDataset() {
  if (vocabSyncInFlight) {
    return vocabSyncInFlight;
  }

  vocabSyncInFlight = (async () => {
    await execFileAsync(pythonBinary, [buildScriptPath], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    vocabLastSyncAt = new Date();
    console.log(`Vocabulary synced at ${vocabLastSyncAt.toISOString()}`);
    return vocabLastSyncAt;
  })().catch((error) => {
    const stderr = error?.stderr ? String(error.stderr) : "";
    console.error("Vocabulary sync failed:", stderr || error.message || error);
    throw error;
  }).finally(() => {
    vocabSyncInFlight = null;
  });

  return vocabSyncInFlight;
}

function broadcastVocabularyUpdate(payload) {
  const message = `event: vocabulary-updated\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of vocabClients) {
    client.write(message);
  }
}

function scheduleVocabularySync() {
  const refresh = async () => {
    try {
      const syncedAt = await syncVocabularyDataset();
      broadcastVocabularyUpdate({
        syncedAt: syncedAt?.toISOString?.() || null,
        source: "scheduled",
      });
    } catch (_error) {
      // Keep serving the last successful dataset if Sheets is temporarily unavailable.
    }
  };

  void refresh();

  vocabSyncTimer = setInterval(refresh, vocabSyncIntervalMs);
  if (typeof vocabSyncTimer.unref === "function") {
    vocabSyncTimer.unref();
  }
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    vocabularyLastSyncAt: vocabLastSyncAt,
    connectedClients: vocabClients.size,
  });
});

app.get("/api/vocabulary/stream", (_request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  response.write(`event: connected\ndata: ${JSON.stringify({
    vocabularyLastSyncAt: vocabLastSyncAt,
  })}\n\n`);

  vocabClients.add(response);

  const keepAlive = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, 30000);

  const cleanup = () => {
    clearInterval(keepAlive);
    vocabClients.delete(response);
  };

  response.on("close", cleanup);
  response.on("error", cleanup);
});

app.post("/api/webhooks/google-sheets", async (request, response) => {
  const expectedSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  const providedSecret =
    request.get("x-webhook-secret") || request.body?.secret || request.query?.secret;

  if (expectedSecret && providedSecret !== expectedSecret) {
    return response.status(401).json({ error: "Invalid webhook secret." });
  }

  try {
    const syncedAt = await syncVocabularyDataset();
    broadcastVocabularyUpdate({
      syncedAt: syncedAt?.toISOString?.() || null,
      source: "webhook",
    });

    return response.status(202).json({
      ok: true,
      vocabularyLastSyncAt: syncedAt,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: error.message || "Failed to sync vocabulary.",
    });
  }
});

app.get("/api/vocabulary", (_request, response) => {
  try {
    const jsonString = fs.readFileSync(vocabPath, "utf8");
    const buffer = Buffer.from(jsonString, 'utf8');
    response.set("Content-Type", "application/json; charset=utf-8");
    response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");
    response.set("Content-Length", buffer.length);
    response.end(buffer);
  } catch (error) {
    console.error("Error serving vocabulary:", error);
    response.status(500).json({ error: "Failed to load vocabulary data", details: error.message });
  }
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
    scheduleVocabularySync();
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

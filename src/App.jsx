import { useEffect, useRef, useState } from "react";

const MODE_OPTIONS = [
  { value: "en-bn", label: "English → Bangla" },
  { value: "bn-en", label: "Bangla → English" },
];

const QUESTION_OPTIONS = [
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

const ORDER_OPTIONS = [
  { value: "random", label: "Random" },
  { value: "sorted", label: "Sorted" },
];

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizeOptionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200c\u200d]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function compactOptionText(value) {
  return normalizeOptionText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitOptionVariants(value) {
  return normalizeOptionText(value)
    .split(/[\/|,;•]+/g)
    .map((part) => compactOptionText(part))
    .filter(Boolean);
}

function areOptionTextsTooSimilar(left, right) {
  const leftCompact = compactOptionText(left);
  const rightCompact = compactOptionText(right);

  if (!leftCompact || !rightCompact) {
    return false;
  }

  if (leftCompact === rightCompact) {
    return true;
  }

  if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
    return true;
  }

  const leftVariants = splitOptionVariants(left);
  const rightVariants = splitOptionVariants(right);

  return leftVariants.some((leftVariant) =>
    rightVariants.some(
      (rightVariant) =>
        leftVariant === rightVariant ||
        leftVariant.includes(rightVariant) ||
        rightVariant.includes(leftVariant),
    ),
  );
}

function buildOptionObjects(answer, sourceTexts, optionCount = 3) {
  const uniqueSourceTexts = [
    ...new Map(
      sourceTexts
        .map((text) => [compactOptionText(text), text])
        .filter(([key]) => Boolean(key)),
    ).values(),
  ];
  const distractors = [];

  for (const candidate of shuffle(uniqueSourceTexts)) {
    if (areOptionTextsTooSimilar(candidate, answer)) {
      continue;
    }

    if (distractors.some((existing) => areOptionTextsTooSimilar(existing, candidate))) {
      continue;
    }

    distractors.push(candidate);
    if (distractors.length >= optionCount) {
      break;
    }
  }

  return shuffle([answer, ...distractors]).map((text) => ({
    text,
    correct: text === answer,
  }));
}

function optionsAreValid(answer, options) {
  if (!Array.isArray(options) || !options.length) {
    return false;
  }

  const texts = options.map((option) => option?.text).filter(Boolean);
  if (!texts.some((text) => normalizeOptionText(text) === normalizeOptionText(answer))) {
    return false;
  }

  for (let index = 0; index < texts.length; index += 1) {
    if (
      texts[index] !== answer &&
      areOptionTextsTooSimilar(texts[index], answer)
    ) {
      return false;
    }

    for (let otherIndex = index + 1; otherIndex < texts.length; otherIndex += 1) {
      if (areOptionTextsTooSimilar(texts[index], texts[otherIndex])) {
        return false;
      }
    }
  }

  return true;
}

function sortEntries(entries, mode) {
  if (mode === "sorted") {
    return [...entries].sort((left, right) => left.english.localeCompare(right.english));
  }

  return shuffle(entries);
}

function buildDeck(entries, requestedCount, questionOrder) {
  const ordered = sortEntries(entries, questionOrder);
  if (requestedCount === "all") {
    return ordered;
  }

  const limit = Number(requestedCount);
  return ordered.slice(0, Math.min(limit, ordered.length));
}

function buildQuestion(entry, pool, mode) {
  const prompt = mode === "en-bn" ? entry.english : entry.bengali;
  const answer = mode === "en-bn" ? entry.bengali : entry.english;
  const sourceTexts = pool
    .filter((candidate) => candidate.id !== entry.id)
    .map((candidate) => (mode === "en-bn" ? candidate.bengali : candidate.english))
    .filter((candidate) => candidate !== answer);

  return {
    entry,
    prompt,
    answer,
    options: buildOptionObjects(answer, sourceTexts),
  };
}

function buildProgressPayload({
  activeDeck,
  currentIndex,
  currentQuestion,
  selectedAnswer,
  feedbackText,
  score,
  answeredCount,
  mistakes,
  reviewMode,
  activeMode,
  questionCount,
  questionOrder,
  selectedSheets,
  isActive,
  completed,
}) {
  return {
    isActive,
    completed,
    reviewMode,
    mode: activeMode,
    questionCount,
    questionOrder,
    selectedSheets,
    deckEntryIds: activeDeck.map((entry) => entry.id),
    currentIndex,
    score,
    answeredCount,
    mistakeEntryIds: mistakes.map((entry) => entry.id),
    selectedAnswer,
    feedbackText,
    currentQuestion: currentQuestion
      ? {
          entryId: currentQuestion.entry.id,
          prompt: currentQuestion.prompt,
          answer: currentQuestion.answer,
          options: currentQuestion.options,
        }
      : null,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function buildInitialRowRanges(metadata, sheets) {
  const ranges = {};
  for (const sheet of sheets) {
    const range = metadata?.rowRanges?.[sheet];
    ranges[sheet] = {
      from: range?.min ?? 1,
      to: range?.max ?? 100,
    };
  }
  return ranges;
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PageShell({ children }) {
  return (
    <main className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-112 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.68),transparent_55%)]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Logo" className="h-20 w-auto" />
          <h2 className="font-['Sora'] text-2xl font-bold text-stone-900">Vocabuild</h2>
        </div>
        {children}
      </div>
    </main>
  );
}

function Panel({ className = "", children }) {
  return (
    <section
      className={`rounded-4xl border border-stone-900/8 bg-white/72 p-5 shadow-[0_18px_45px_rgba(89,64,30,0.12)] backdrop-blur sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-[1.4rem] border border-stone-900/8 bg-white/60 px-5 py-4 shadow-[0_10px_30px_rgba(80,60,30,0.08)] backdrop-blur">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-stone-900">{value}</p>
    </div>
  );
}

function SectionTitle({ label, meta }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-[0.74rem] font-semibold uppercase tracking-[0.24em] text-stone-500">
        {label}
      </p>
      {meta ? <p className="text-xs font-medium text-stone-500">{meta}</p> : null}
    </div>
  );
}

function ModePicker({ activeMode, disabled, onChange }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {MODE_OPTIONS.map((mode) => {
        const active = mode.value === activeMode;
        return (
          <button
            key={mode.value}
            type="button"
            onClick={() => onChange(mode.value)}
            disabled={disabled}
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              active
                ? "border-emerald-900 bg-emerald-800 text-white shadow-[0_10px_25px_rgba(6,78,59,0.22)]"
                : "border-stone-900/10 bg-white text-stone-800 hover:-translate-y-0.5 hover:bg-stone-50"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

function SheetPicker({ sheets, selectedSheets, disabled, onToggle }) {
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {sheets.map((sheet) => {
        const checked = selectedSheets.includes(sheet);
        return (
          <label
            key={sheet}
            className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
              checked
                ? "border-emerald-800/30 bg-emerald-50/70"
                : "border-stone-900/10 bg-white hover:bg-stone-50"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(sheet)}
              disabled={disabled}
              className="h-4 w-4 rounded border-stone-300 accent-emerald-700"
            />
            <span className="text-sm font-medium text-stone-800">{sheet}</span>
          </label>
        );
      })}
    </div>
  );
}

function QuestionCountPicker({ value, disabled, onChange }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="mt-3 w-full sm:w-32 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-medium text-stone-900 outline-none ring-0 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {QUESTION_OPTIONS.map((option) => (
        <option key={option.value} value={option.value} className="text-stone-900">
          {option.label}
        </option>
      ))}
    </select>
  );
}

function QuestionOrderPicker({ value, disabled, onChange }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {ORDER_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={disabled}
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              active
                ? "border-amber-300 bg-amber-300 text-stone-950"
                : "border-amber-200 bg-white text-stone-900 hover:bg-amber-50"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RowRangePicker({ sheet, rowRange, disabled, onChange, metadata }) {
  const range = metadata?.rowRanges?.[sheet];
  if (!range) return null;

  const handleFromChange = (e) => {
    const input = e.target.value;
    // Allow user to type freely, only validate on blur
    onChange(sheet, { ...rowRange, from: input });
  };

  const handleFromBlur = () => {
    if (rowRange.from === "" || rowRange.from === undefined) {
      onChange(sheet, { ...rowRange, from: range.min });
      return;
    }
    const num = Number(rowRange.from);
    if (isNaN(num)) {
      onChange(sheet, { ...rowRange, from: range.min });
    } else {
      const validFrom = Math.max(range.min, Math.min(num, rowRange.to || range.max));
      onChange(sheet, { ...rowRange, from: validFrom });
    }
  };

  const handleToChange = (e) => {
    const input = e.target.value;
    // Allow user to type freely, only validate on blur
    onChange(sheet, { ...rowRange, to: input });
  };

  const handleToBlur = () => {
    if (rowRange.to === "" || rowRange.to === undefined) {
      onChange(sheet, { ...rowRange, to: range.max });
      return;
    }
    const num = Number(rowRange.to);
    if (isNaN(num)) {
      onChange(sheet, { ...rowRange, to: range.max });
    } else {
      const validTo = Math.max(rowRange.from || range.min, Math.min(num, range.max));
      onChange(sheet, { ...rowRange, to: validTo });
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-900/20 bg-emerald-50/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-700 mb-3">
        {sheet} - Rows {range.min}-{range.max}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-2">From</label>
          <input
            type="text"
            inputMode="numeric"
            value={rowRange.from}
            onChange={handleFromChange}
            onBlur={handleFromBlur}
            placeholder={String(range.min)}
            disabled={disabled}
            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-600 mb-2">To</label>
          <input
            type="text"
            inputMode="numeric"
            value={rowRange.to}
            onChange={handleToChange}
            onBlur={handleToBlur}
            placeholder={String(range.max)}
            disabled={disabled}
            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none disabled:opacity-60"
          />
        </div>
      </div>
    </div>
  );
}

function App() {
  const [dataset, setDataset] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [authState, setAuthState] = useState("loading");
  const [authError, setAuthError] = useState("");
  const [authForm, setAuthForm] = useState({ userId: "", displayName: "" });
  const [currentUser, setCurrentUser] = useState(null);
  const [activePage, setActivePage] = useState("login");
  const [activeMode, setActiveMode] = useState("en-bn");
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [questionCount, setQuestionCount] = useState("20");
  const [customQuestionCount, setCustomQuestionCount] = useState("25");
  const [questionOrder, setQuestionOrder] = useState("random");
  const [rowRanges, setRowRanges] = useState({});
  const [activeDeck, setActiveDeck] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [score, setScore] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [mistakes, setMistakes] = useState([]);
  const [reviewMode, setReviewMode] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const applyingUserRef = useRef(false);
  const progressSaveQueueRef = useRef(Promise.resolve());

  async function loadVocabularyDataset({ initial = false } = {}) {
    const response = await fetch(`/api/vocabulary?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Dataset request failed with status ${response.status}`);
    }

    const nextDataset = await response.json();

    if (nextDataset.entries && nextDataset.entries.length > 1) {
      const sampleBengali = nextDataset.entries[1].bengali;
      console.log("DEBUG - Sample Bengali from fetch:", sampleBengali);
      console.log("DEBUG - Byte codes:", Array.from(sampleBengali).map((c) => c.charCodeAt(0)));
    }

    setDataset(nextDataset);

    if (initial) {
      setSelectedSheets(nextDataset.metadata.includedSheets);
      setRowRanges(buildInitialRowRanges(nextDataset.metadata, nextDataset.metadata.includedSheets));
    } else {
      setRowRanges((current) => {
        const merged = { ...current };
        for (const sheet of nextDataset.metadata.includedSheets) {
          if (!merged[sheet]) {
            const range = nextDataset.metadata.rowRanges?.[sheet];
            merged[sheet] = {
              from: range?.min ?? 1,
              to: range?.max ?? 100,
            };
          }
        }
        return merged;
      });
    }

    return nextDataset;
  }

  useEffect(() => {
    async function initializeApp() {
      try {
        const nextDataset = await loadVocabularyDataset({ initial: true });

        setLoadState("ready");

        const rememberedUserId = window.localStorage.getItem("voa-user-id");
        if (!rememberedUserId) {
          setAuthState("guest");
          setActivePage("login");
          return;
        }

        try {
          const { user } = await requestJson(`/api/users/${rememberedUserId}`);
          applyUser(user, nextDataset);
          setAuthState("ready");
          setActivePage("dashboard");
        } catch (error) {
          window.localStorage.removeItem("voa-user-id");
          setAuthState("guest");
          setActivePage("login");
          setAuthError(
            error instanceof Error ? error.message : "Failed to restore saved user.",
          );
        }
      } catch (error) {
        setLoadState("error");
        setAuthState("guest");
        setActivePage("login");
        setErrorMessage(error instanceof Error ? error.message : "Failed to load dataset.");
      }
    }

    initializeApp();
  }, []);

  useEffect(() => {
    const stream = new EventSource("/api/vocabulary/stream");

    const refreshDataset = async () => {
      try {
        await loadVocabularyDataset({ initial: false });
      } catch (error) {
        console.error("Failed to refresh vocabulary dataset:", error);
      }
    };

    stream.addEventListener("vocabulary-updated", refreshDataset);

    return () => {
      stream.removeEventListener("vocabulary-updated", refreshDataset);
      stream.close();
    };
  }, []);

  function resetQuizState() {
    setActiveDeck([]);
    setCurrentIndex(-1);
    setCurrentQuestion(null);
    setSelectedAnswer(null);
    setScore(0);
    setAnsweredCount(0);
    setMistakes([]);
    setReviewMode(false);
    setFeedbackText("");
  }

  function applyUser(user, activeDataset = dataset) {
    if (!activeDataset) {
      return;
    }

    applyingUserRef.current = true;
    setCurrentUser(user);
    setAuthForm({ userId: user.userId, displayName: user.displayName || "" });

    const entryMap = new Map(activeDataset.entries.map((entry) => [entry.id, entry]));
    const nextSheets =
      user.progress?.selectedSheets?.length
        ? user.progress.selectedSheets
        : user.preferences?.selectedSheets?.length
          ? user.preferences.selectedSheets
          : activeDataset.metadata.includedSheets;

    setSelectedSheets(nextSheets);
    setActiveMode(user.progress?.mode || user.preferences?.activeMode || "en-bn");
    setQuestionCount(user.progress?.questionCount || user.preferences?.questionCount || "20");
    setCustomQuestionCount(
      user.preferences?.customQuestionCount
        ? String(user.preferences.customQuestionCount)
        : "25",
    );
    setQuestionOrder(
      user.progress?.questionOrder || user.preferences?.questionOrder || "random",
    );

    // Apply saved row ranges
    const nextRowRanges = {};
    for (const sheet of activeDataset.metadata.includedSheets) {
      const range = activeDataset.metadata.rowRanges[sheet];
      nextRowRanges[sheet] = user.preferences?.rowRanges?.[sheet] || {
        from: range?.min ?? 1,
        to: range?.max ?? 100,
      };
    }
    setRowRanges(nextRowRanges);

    const savedProgress = user.progress;
    if (savedProgress?.isActive && savedProgress.deckEntryIds?.length) {
      const restoredDeck = savedProgress.deckEntryIds
        .map((entryId) => entryMap.get(entryId))
        .filter(Boolean);
      const restoredMistakes = (savedProgress.mistakeEntryIds || [])
        .map((entryId) => entryMap.get(entryId))
        .filter(Boolean);
      const restoredEntry = savedProgress.currentQuestion?.entryId
        ? entryMap.get(savedProgress.currentQuestion.entryId)
        : null;
      const restoredMode = savedProgress.mode || user.progress?.mode || user.preferences?.activeMode || "en-bn";
      const restoredQuestion =
        restoredEntry && savedProgress.currentQuestion
          ? optionsAreValid(savedProgress.currentQuestion.answer, savedProgress.currentQuestion.options)
            ? {
                entry: restoredEntry,
                prompt: savedProgress.currentQuestion.prompt,
                answer: savedProgress.currentQuestion.answer,
                options: savedProgress.currentQuestion.options,
              }
            : buildQuestion(restoredEntry, filteredEntries, restoredMode)
          : null;

      setActiveDeck(restoredDeck);
      setCurrentIndex(savedProgress.currentIndex ?? 0);
      setScore(savedProgress.score ?? 0);
      setAnsweredCount(savedProgress.answeredCount ?? 0);
      setMistakes(restoredMistakes);
      setReviewMode(Boolean(savedProgress.reviewMode));
      setSelectedAnswer(savedProgress.selectedAnswer || null);
      setFeedbackText(savedProgress.feedbackText || "");
      setCurrentQuestion(restoredQuestion);
      applyingUserRef.current = false;
      return;
    }

    resetQuizState();
    applyingUserRef.current = false;
  }

  function mergeUserSnapshot(user) {
    setCurrentUser((current) => ({
      ...(current || {}),
      ...user,
    }));
  }

  async function waitForPendingProgress() {
    await progressSaveQueueRef.current.catch(() => {});
  }

  const filteredEntries = dataset
    ? dataset.entries.filter((entry) => {
        // Check if entry has any of the selected sheets
        const hasSheet = selectedSheets.some((sheet) => sheet in entry.sources);
        if (!hasSheet) return false;

        // Check if entry is within row range for any selected sheet
        return selectedSheets.some((sheet) => {
          const rowInSheet = entry.sources[sheet];
          if (rowInSheet === undefined) return false;
          const range = rowRanges[sheet];
          return rowInSheet >= range.from && rowInSheet <= range.to;
        });
      })
    : [];

  const availableCount = filteredEntries.length;
  const totalQuestions = activeDeck.length;
  const progress = totalQuestions ? Math.min(currentIndex + 1, totalQuestions) : 0;
  const liveAccuracy = answeredCount ? Math.round((score / answeredCount) * 100) : 0;
  const roundAccuracy = totalQuestions ? Math.round((score / totalQuestions) * 100) : 0;
  const roundComplete = totalQuestions > 0 && currentIndex >= totalQuestions;
  const controlsLocked = Boolean(currentUser?.progress?.isActive);
  const userAccuracy =
    currentUser?.stats?.answeredCount > 0
      ? Math.round((currentUser.stats.correctCount / currentUser.stats.answeredCount) * 100)
      : 0;

  function resolveQuestionCount() {
    if (questionCount === "custom") {
      const parsed = Number(customQuestionCount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
      }
      return String(Math.floor(parsed));
    }

    return questionCount;
  }

  async function savePreferences(nextPreferences) {
    if (!currentUser) {
      return;
    }

    const { user } = await requestJson(`/api/users/${currentUser.userId}/preferences`, {
      method: "PUT",
      body: JSON.stringify(nextPreferences),
    });
    mergeUserSnapshot(user);
  }

  async function updateMode(mode) {
    setActiveMode(mode);
    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode: mode,
        questionCount,
        customQuestionCount,
        questionOrder,
        selectedSheets,
        rowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function updateSelectedSheets(sheet) {
    const nextSheets = selectedSheets.includes(sheet)
      ? selectedSheets.filter((item) => item !== sheet)
      : [...selectedSheets, sheet];
    setSelectedSheets(nextSheets);

    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode,
        questionCount,
        customQuestionCount,
        questionOrder,
        selectedSheets: nextSheets,
        rowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function updateQuestionCount(value) {
    setQuestionCount(value);
    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode,
        questionCount: value,
        customQuestionCount,
        questionOrder,
        selectedSheets,
        rowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function updateCustomQuestionCount(value) {
    setCustomQuestionCount(value);
    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode,
        questionCount,
        customQuestionCount: value,
        questionOrder,
        selectedSheets,
        rowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function updateQuestionOrder(value) {
    setQuestionOrder(value);
    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode,
        questionCount,
        customQuestionCount,
        questionOrder: value,
        selectedSheets,
        rowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function updateRowRange(sheet, range) {
    const nextRowRanges = { ...rowRanges, [sheet]: range };
    setRowRanges(nextRowRanges);

    if (!currentUser || applyingUserRef.current) {
      return;
    }

    try {
      await savePreferences({
        activeMode,
        questionCount,
        customQuestionCount,
        questionOrder,
        selectedSheets,
        rowRanges: nextRowRanges,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save preferences.");
    }
  }

  async function persistProgress(nextState) {
    if (!currentUser) {
      return;
    }

    const userId = currentUser.userId;
    const progressPayload = buildProgressPayload(nextState);

    const queuedSave = progressSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        const endpoint = nextState.completed
          ? `/api/users/${userId}/sessions/complete`
          : nextState.isActive && nextState.currentIndex === 0 && nextState.answeredCount === 0
            ? `/api/users/${userId}/sessions/start`
            : `/api/users/${userId}/progress`;
        const method = endpoint.endsWith("/progress") ? "PUT" : "POST";

        const { user } = await requestJson(endpoint, {
          method,
          body: JSON.stringify({ progress: progressPayload }),
        });
        mergeUserSnapshot(user);
        setAuthError("");
      });

    progressSaveQueueRef.current = queuedSave;
    await queuedSave;
  }

  async function startQuiz(reviewOnly) {
    if (!currentUser) {
      setAuthError("Create or load a user profile before starting a quiz.");
      return;
    }

    const sourceEntries = reviewOnly ? mistakes : filteredEntries;
    if (!sourceEntries.length) {
      setFeedbackText(
        reviewOnly
          ? "No mistakes to review yet."
          : "No vocabulary entries are available with the current sheet selection.",
      );
      return;
    }

    const effectiveQuestionCount = resolveQuestionCount();
    if (!effectiveQuestionCount) {
      setFeedbackText("Enter a valid custom question count greater than 0.");
      return;
    }

    const nextDeck = buildDeck(sourceEntries, effectiveQuestionCount, questionOrder);
    const firstQuestion = buildQuestion(nextDeck[0], filteredEntries, activeMode);

    setReviewMode(reviewOnly);
    setActiveDeck(nextDeck);
    setCurrentIndex(0);
    setCurrentQuestion(firstQuestion);
    setSelectedAnswer(null);
    setScore(0);
    setAnsweredCount(0);
    setFeedbackText("");
    if (!reviewOnly) {
      setMistakes([]);
    }
    setActivePage("quiz");

    try {
      await persistProgress({
        activeDeck: nextDeck,
        currentIndex: 0,
        currentQuestion: firstQuestion,
        selectedAnswer: null,
        feedbackText: "",
        score: 0,
        answeredCount: 0,
        mistakes: reviewOnly ? mistakes : [],
        reviewMode: reviewOnly,
        activeMode,
        questionCount: effectiveQuestionCount,
        questionOrder,
        selectedSheets,
        isActive: true,
        completed: false,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save progress.");
    }
  }

  async function handleAnswer(option) {
    if (selectedAnswer || !currentQuestion) {
      return;
    }

    const nextAnsweredCount = answeredCount + 1;
    const nextScore = option.correct ? score + 1 : score;
    const nextMistakes =
      option.correct || mistakes.some((entry) => entry.id === currentQuestion.entry.id)
        ? mistakes
        : [...mistakes, currentQuestion.entry];
    const nextFeedback = option.correct ? "Correct." : `Correct answer: ${currentQuestion.answer}`;

    setSelectedAnswer(option.text);
    setScore(nextScore);
    setAnsweredCount(nextAnsweredCount);
    setFeedbackText(nextFeedback);
    if (!option.correct) {
      setMistakes(nextMistakes);
    }

    try {
      await persistProgress({
        activeDeck,
        currentIndex,
        currentQuestion,
        selectedAnswer: option.text,
        feedbackText: nextFeedback,
        score: nextScore,
        answeredCount: nextAnsweredCount,
        mistakes: nextMistakes,
        reviewMode,
        activeMode,
        questionCount,
        questionOrder,
        selectedSheets,
        isActive: true,
        completed: false,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save progress.");
    }
  }

  async function moveToQuestion(nextDeck, nextIndex) {
    if (nextIndex >= nextDeck.length) {
      const completionText = `Accuracy: ${Math.round((score / nextDeck.length) * 100)}%. ${
        mistakes.length ? `Mistakes saved: ${mistakes.length}.` : "No mistakes saved."
      }`;

      setCurrentIndex(nextIndex);
      setCurrentQuestion(null);
      setSelectedAnswer(null);
      setFeedbackText(completionText);

      try {
        await persistProgress({
          activeDeck: nextDeck,
          currentIndex: nextIndex,
          currentQuestion: null,
          selectedAnswer: null,
          feedbackText: completionText,
          score,
          answeredCount,
          mistakes,
          reviewMode,
          activeMode,
          questionCount,
          questionOrder,
          selectedSheets,
          isActive: false,
          completed: true,
        });
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Failed to save progress.");
      }

      return;
    }

    const nextQuestion = buildQuestion(nextDeck[nextIndex], filteredEntries, activeMode);
    setCurrentIndex(nextIndex);
    setCurrentQuestion(nextQuestion);
    setSelectedAnswer(null);
    setFeedbackText("");

    try {
      await persistProgress({
        activeDeck: nextDeck,
        currentIndex: nextIndex,
        currentQuestion: nextQuestion,
        selectedAnswer: null,
        feedbackText: "",
        score,
        answeredCount,
        mistakes,
        reviewMode,
        activeMode,
        questionCount,
        questionOrder,
        selectedSheets,
        isActive: true,
        completed: false,
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to save progress.");
    }
  }

  function moveToNextQuestion() {
    moveToQuestion(activeDeck, currentIndex + 1);
  }

  async function createUser() {
    if (!authForm.userId.trim()) {
      setAuthError("User ID is required.");
      return;
    }

    try {
      setAuthState("working");
      setAuthError("");
      const { user } = await requestJson("/api/users/register", {
        method: "POST",
        body: JSON.stringify(authForm),
      });
      window.localStorage.setItem("voa-user-id", user.userId);
      applyUser(user);
      setAuthState("ready");
      setActivePage("dashboard");
    } catch (error) {
      setAuthState("guest");
      setAuthError(error instanceof Error ? error.message : "Failed to create user.");
    }
  }

  async function loadUser() {
    if (!authForm.userId.trim()) {
      setAuthError("Enter a user ID to continue.");
      return;
    }

    try {
      setAuthState("working");
      setAuthError("");
      const { user } = await requestJson("/api/users/login", {
        method: "POST",
        body: JSON.stringify({ userId: authForm.userId }),
      });
      window.localStorage.setItem("voa-user-id", user.userId);
      applyUser(user);
      setAuthState("ready");
      setActivePage("dashboard");
    } catch (error) {
      setAuthState("guest");
      setAuthError(error instanceof Error ? error.message : "Failed to load user.");
    }
  }

  function signOut() {
    window.localStorage.removeItem("voa-user-id");
    setCurrentUser(null);
    setAuthState("guest");
    setAuthForm({ userId: "", displayName: "" });
    setAuthError("");
    if (dataset) {
      setSelectedSheets(dataset.metadata.includedSheets);
    }
    setActiveMode("en-bn");
    setQuestionCount("20");
    setCustomQuestionCount("25");
    setQuestionOrder("random");
    setActivePage("login");
    resetQuizState();
  }

  async function resumeSavedQuiz() {
    if (!currentUser?.progress?.isActive) {
      return;
    }

    await waitForPendingProgress();
    setAuthError("");
    setActivePage("quiz");
  }

  async function goToDashboard() {
    if (!currentUser) {
      setActivePage("login");
      return;
    }

    await waitForPendingProgress();
    setAuthError("");
    setActivePage("dashboard");
  }

  if (loadState === "loading") {
    return (
      <PageShell>
        <Panel className="mx-auto my-auto max-w-3xl text-center">
          <p className="font-['Sora'] text-3xl font-bold text-stone-950">
            Loading workbook data...
          </p>
        </Panel>
      </PageShell>
    );
  }

  if (loadState === "error") {
    return (
      <PageShell>
        <Panel className="mx-auto my-auto max-w-3xl text-center">
          <p className="font-['Sora'] text-3xl font-bold text-stone-950">Dataset load failed.</p>
          <p className="mt-4 text-sm text-rose-700">{errorMessage}</p>
        </Panel>
      </PageShell>
    );
  }

  if (activePage === "login" || !currentUser) {
    return (
      <PageShell>
        <section className="grid min-h-[70vh] gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="font-['Sora'] text-xs font-bold uppercase tracking-[0.35em] text-emerald-800">
              Vocabulary Quiz
            </p>
            <h1 className="mt-3 max-w-3xl font-['Sora'] text-4xl font-extrabold tracking-tight text-stone-950 sm:text-5xl lg:text-6xl">
              Login first. Resume later. Keep every quiz attempt tied to one user dashboard.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-stone-600">
              Your profile, dashboard stats, and active quiz progress are stored in MongoDB.
              Create an ID once, then come back and continue from where you left off.
            </p>
          </div>

          <Panel className="border-amber-500/20 bg-amber-50/75">
            <p className="font-['Sora'] text-2xl font-bold text-stone-950">
              Create or load your user ID
            </p>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              This version uses a simple ID-based profile. No password flow yet.
            </p>
            <div className="mt-6 grid gap-4">
              <input
                type="text"
                value={authForm.userId}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, userId: event.target.value }))
                }
                placeholder="User ID, e.g. auntor-01"
                className="rounded-2xl border border-stone-900/10 bg-white px-5 py-4 text-base text-stone-900 outline-none"
              />
              <input
                type="text"
                value={authForm.displayName}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Display name"
                className="rounded-2xl border border-stone-900/10 bg-white px-5 py-4 text-base text-stone-900 outline-none"
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={createUser}
                disabled={authState === "working"}
                className="rounded-2xl bg-emerald-800 px-6 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:opacity-60"
              >
                Create Profile
              </button>
              <button
                type="button"
                onClick={loadUser}
                disabled={authState === "working"}
                className="rounded-2xl border border-stone-900/10 bg-white px-6 py-4 text-base font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-stone-50 disabled:opacity-60"
              >
                Continue With ID
              </button>
            </div>
            {(authError || authState === "loading") && (
              <p className="mt-5 text-sm text-rose-700">
                {authState === "loading" ? "Checking saved profile..." : authError}
              </p>
            )}
          </Panel>
        </section>
      </PageShell>
    );
  }

  if (activePage === "dashboard") {
    return (
      <PageShell>
        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <p className="font-['Sora'] text-xs font-bold uppercase tracking-[0.35em] text-emerald-800">
              Dashboard
            </p>
            <h1 className="mt-3 max-w-4xl font-['Sora'] text-4xl font-extrabold tracking-tight text-stone-950 sm:text-5xl">
              {currentUser.displayName || currentUser.userId}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-stone-600">
              Manage your quiz settings, review your progress, and jump back into a saved
              session from one place.
            </p>
          </div>
          <Panel className="bg-white/60">
            <p className="text-sm leading-7 text-stone-600">
              User ID: <span className="font-semibold text-stone-900">{currentUser.userId}</span>
            </p>
            <p className="mt-2 text-sm leading-7 text-stone-600">
              Last activity:{" "}
              <span className="font-semibold text-stone-900">
                {formatDate(currentUser.stats?.lastPlayedAt)}
              </span>
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => startQuiz(false)}
                className="rounded-2xl bg-emerald-800 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700"
              >
                Start Quiz
              </button>
              {currentUser.progress?.isActive && (
                <button
                  type="button"
                  onClick={resumeSavedQuiz}
                  className="rounded-2xl border border-stone-900/10 bg-white px-5 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-stone-50"
                >
                  Resume Saved Quiz
                </button>
              )}
              <button
                type="button"
                onClick={signOut}
                className="rounded-2xl border border-stone-900/10 bg-white px-5 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-stone-50"
              >
                Sign Out
              </button>
            </div>
            {authError && <p className="mt-4 text-sm text-rose-700">{authError}</p>}
          </Panel>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Started" value={currentUser.stats?.quizzesStarted || 0} />
          <StatCard label="Completed" value={currentUser.stats?.quizzesCompleted || 0} />
          <StatCard label="Accuracy" value={`${userAccuracy}%`} />
          <StatCard
            label="Resume"
            value={currentUser.progress?.isActive ? "Saved" : "Clear"}
          />
        </section>

        <section className="grid gap-6 md:gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Panel>
            <div className="space-y-6">
              <div>
                <SectionTitle label="Quiz Mode" />
                <ModePicker
                  activeMode={activeMode}
                  disabled={controlsLocked}
                  onChange={updateMode}
                />
              </div>

              <div>
                <SectionTitle
                  label="Source Sheets"
                  meta={`${selectedSheets.length} selected`}
                />
                <SheetPicker
                  sheets={dataset.metadata.includedSheets}
                  selectedSheets={selectedSheets}
                  disabled={controlsLocked}
                  onToggle={updateSelectedSheets}
                />
              </div>

              {selectedSheets.length > 0 && (
                <div>
                  <SectionTitle label="Row Range (Optional)" meta="customize per sheet" />
                  <div className="mt-3 space-y-3">
                    {selectedSheets.map((sheet) => (
                      <RowRangePicker
                        key={sheet}
                        sheet={sheet}
                        rowRange={rowRanges[sheet] || { from: 1, to: 100 }}
                        disabled={controlsLocked}
                        onChange={updateRowRange}
                        metadata={dataset.metadata}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-[1.6rem] border border-amber-200/30 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,252,235,0.88))] px-6 py-6">
                <div className="space-y-5">
                  <div>
                    <SectionTitle label="Questions" />
                    <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                      <div className="w-full sm:w-32">
                        <QuestionCountPicker
                          value={questionCount}
                          disabled={controlsLocked}
                          onChange={updateQuestionCount}
                        />
                      </div>
                      {questionCount === "custom" && (
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={customQuestionCount}
                          onChange={(event) => updateCustomQuestionCount(event.target.value)}
                          disabled={controlsLocked}
                          placeholder="Enter custom count"
                          className="w-full sm:flex-1 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder-stone-500 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      )}
                    </div>
                  </div>

                  <div className="border-t border-amber-100" />

                  <div>
                    <SectionTitle label="Question Order" />
                    <QuestionOrderPicker
                      value={questionOrder}
                      disabled={controlsLocked}
                      onChange={updateQuestionOrder}
                    />
                  </div>

                  {controlsLocked && (
                    <div className="rounded-xl border border-amber-200/50 bg-amber-50/50 p-3">
                      <p className="text-xs font-medium text-amber-900">
                        ⓘ Finish or resume the saved quiz before changing deck settings.
                      </p>
                    </div>
                  )}

                  <div className="border-t border-amber-100" />

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => startQuiz(false)}
                      disabled={controlsLocked || selectedSheets.length === 0}
                      className="flex-1 rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      ▶ Start Quiz
                    </button>
                    {currentUser.progress?.isActive && (
                      <button
                        type="button"
                        onClick={resumeSavedQuiz}
                        className="flex-1 rounded-2xl border border-amber-300 bg-white px-6 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-amber-50"
                      >
                        ↻ Resume
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="space-y-5">
              <div>
                <SectionTitle label="Session Snapshot" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-stone-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                      Available Entries
                    </p>
                    <p className="mt-2 text-3xl font-extrabold text-stone-950">
                      {availableCount}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-stone-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                      Saved Position
                    </p>
                    <p className="mt-2 text-3xl font-extrabold text-stone-950">
                      {currentUser.progress?.isActive
                        ? (currentUser.progress.currentIndex || 0) + 1
                        : 0}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.7rem] border border-emerald-900/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(232,248,242,0.92))] p-5">
                <p className="font-['Sora'] text-xl font-bold text-stone-950">
                  {currentUser.progress?.isActive
                    ? "A quiz is already saved for this user."
                    : "No active quiz is waiting right now."}
                </p>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  {currentUser.progress?.isActive
                    ? "Use Resume Saved Quiz to continue exactly from the last saved question."
                    : "Start a new quiz round from the current dashboard settings."}
                </p>
              </div>
            </div>
          </Panel>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <div>
          <p className="font-['Sora'] text-xs font-bold uppercase tracking-[0.35em] text-emerald-800">
            Quiz Page
          </p>
          <h1 className="mt-3 max-w-4xl font-['Sora'] text-4xl font-extrabold tracking-tight text-stone-950 sm:text-5xl">
            Stay on the question. Leave the settings and dashboard outside the quiz flow.
          </h1>
        </div>
        <Panel className="bg-white/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-stone-600">
                User:{" "}
                <span className="font-semibold text-stone-900">
                  {currentUser.displayName || currentUser.userId}
                </span>
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Mode:{" "}
                <span className="font-semibold text-stone-900">
                  {activeMode === "en-bn" ? "English → Bangla" : "Bangla → English"}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={goToDashboard}
              className="rounded-2xl border border-stone-900/10 bg-white px-5 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-stone-50"
            >
              Back to Dashboard
            </button>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Available" value={availableCount} />
        <StatCard label="Progress" value={`${progress} / ${totalQuestions}`} />
        <StatCard label="Score" value={score} />
        <StatCard label="Accuracy" value={`${liveAccuracy}%`} />
      </section>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-stone-500">
              {roundComplete
                ? reviewMode
                  ? "Review Finished"
                  : "Round Finished"
                : currentQuestion
                  ? reviewMode
                    ? `Review Question ${currentIndex + 1}`
                    : `Question ${currentIndex + 1}`
                  : "Saved Session"}
            </p>
            <p className="mt-2 text-sm text-stone-500">
              {currentQuestion
                ? `Source: ${Object.keys(currentQuestion.entry.sources).join(", ")}`
                : "This page auto-saves while you work."}
            </p>
          </div>
          <div className="rounded-full border border-emerald-900/12 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
            {activeMode === "en-bn" ? "Prompt in English" : "Prompt in Bangla"}
          </div>
        </div>

        <div className="mt-5 rounded-4xl border border-emerald-900/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(232,248,242,0.92))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-8">
          <p className="font-['Sora'] text-2xl font-extrabold leading-tight tracking-tight text-stone-950 sm:text-4xl" style={{ fontFamily: activeMode === "bn-en" ? '"Hind Siliguri", sans-serif' : 'inherit' }}>
            {roundComplete
              ? `${score} out of ${totalQuestions} correct.`
              : currentQuestion?.prompt ?? "Start or resume a quiz from the dashboard."}
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {currentQuestion?.options.map((option) => {
            const isSelected = selectedAnswer === option.text;
            const revealCorrect = Boolean(selectedAnswer) && option.correct;
            const revealIncorrect = isSelected && !option.correct;

            return (
              <button
                key={option.text}
                type="button"
                disabled={Boolean(selectedAnswer)}
                onClick={() => handleAnswer(option)}
                className={`rounded-[1.4rem] border px-4 py-4 text-left text-base font-medium transition ${
                  revealCorrect
                    ? "border-emerald-800/30 bg-emerald-100 text-emerald-950"
                    : revealIncorrect
                      ? "border-rose-800/25 bg-rose-100 text-rose-950"
                      : "border-stone-900/10 bg-white text-stone-800 hover:-translate-y-0.5 hover:bg-stone-50 disabled:cursor-default"
                }`}
                style={{ fontFamily: '"Hind Siliguri", sans-serif' }}
              >
                {option.text}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <p className="min-h-6 text-sm text-stone-600">
              {roundComplete ? `Final accuracy: ${roundAccuracy}%.` : feedbackText}
            </p>
            {selectedAnswer && !roundComplete && currentQuestion && (
              <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                    Meaning
                  </p>
                  <p className="mt-2 text-sm font-medium text-stone-900" style={{ fontFamily: '"Hind Siliguri", sans-serif' }}>
                    {activeMode === "en-bn"
                      ? currentQuestion.entry.bengali
                      : currentQuestion.entry.english}
                  </p>
                </div>
                {currentQuestion.entry.example && (
                  <div className="border-t border-emerald-200 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                      Example
                    </p>
                    <p className="mt-2 text-sm italic text-stone-800">
                      "{currentQuestion.entry.example}"
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto md:shrink-0 md:justify-end">
            {selectedAnswer && !roundComplete && (
              <button
                type="button"
                onClick={moveToNextQuestion}
                className="rounded-2xl bg-emerald-800 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 sm:flex-initial"
              >
                Next
              </button>
            )}
            <button
              type="button"
              onClick={goToDashboard}
              className="rounded-2xl border border-stone-900/10 bg-white px-5 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-stone-50 sm:flex-initial"
            >
              Dashboard
            </button>
          </div>
        </div>
      </Panel>
    </PageShell>
  );
}

export default App;

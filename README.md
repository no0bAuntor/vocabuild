# Vocabulary Quiz

React + Tailwind quiz app built from Google Sheets, with MongoDB-backed user profiles and saved quiz progress.

Included sheets:
- `War`
- `Random`
- `A World Undone`
- `Competitive Exams`
- `Analogy`

Included columns:
- `Word`
- `Meaning` or `Bengali Meaning`

## Run

1. Create `.env` from `.env.example` and set your MongoDB connection string:

```powershell
Copy-Item .env.example .env
```

2. Install dependencies:

```powershell
npm install
```

3. Build the dataset:

```powershell
npm run build:data
```

4. Make sure MongoDB is running.

5. Start the frontend and API together:

```powershell
npm run dev
```

6. Open:

```text
http://localhost:5173
```

The API runs on `http://localhost:4000` and Vite proxies `/api` to it during development.

## Current Scope

- MongoDB-backed user profiles
- Simple ID-based profile creation and sign-in
- Saved active quiz session with resume support
- Per-user dashboard stats
- English → Bangla quiz mode
- Bangla → English quiz mode
- Source-sheet filtering
- Question count selection
- Score, progress, and accuracy tracking
- Mistake review round

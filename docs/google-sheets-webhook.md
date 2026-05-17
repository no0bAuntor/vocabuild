# Google Sheets Webhook Setup

This project now supports push-based vocabulary sync. To make sheet edits update the app immediately, add an installable Apps Script trigger in the Google Sheet.

## Server env

Set this in `.env`:

```env
GOOGLE_SHEETS_WEBHOOK_SECRET=change-me
```

If you are developing locally, expose the server with a public HTTPS URL first. Apps Script cannot call `localhost` directly.

## Apps Script

Paste this into `Extensions -> Apps Script` in the Google Sheet:

```javascript
const WEBHOOK_URL = "https://your-domain.example/api/webhooks/google-sheets";
const WEBHOOK_SECRET = "change-me";

function setupTriggers() {
  const sheet = SpreadsheetApp.getActive();

  ScriptApp.newTrigger("syncVocabulary")
    .forSpreadsheet(sheet)
    .onEdit()
    .create();

  ScriptApp.newTrigger("syncVocabulary")
    .forSpreadsheet(sheet)
    .onChange()
    .create();
}

function syncVocabulary(e) {
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      secret: WEBHOOK_SECRET,
      source: "google-sheets",
      eventType: e && e.changeType ? e.changeType : "edit",
    }),
    muteHttpExceptions: true,
  });
}
```

## Steps

1. Replace `WEBHOOK_URL` with your server URL.
2. Replace `WEBHOOK_SECRET` with the same value used in `.env`.
3. Run `setupTriggers()` once from the Apps Script editor.
4. Edit a row in the sheet and confirm the app updates without a manual rebuild.


# DocAi Digital Rebuild Service

Fastify + TypeScript prototype of the Phase 1 Digital Rebuild pipeline.

## Why Fastify + pdf-lib

- **Fastify**: strong performance and built-in schema-driven request handling.
- **pdf-lib**: deterministic text-positioned PDFs with selectable text and clean TypeScript support.

## Architecture

- `src/api/` routes/controllers
- `src/services/ocr/` OCR interface + Google Vision adapter
- `src/services/layout/` geometry-first segmentation + table reconstruction + confidence logic
- `src/services/recomposer/` geometry-first PDF rebuild engine
- `src/services/quality/` quality metrics harness
- `src/services/jobs/` submit/process/retry/timeout orchestration
- `src/store/` job/artifact persistence abstractions
- `src/types/` shared DTOs and schemas
- `src/utils/` logging, timing, errors, env config

## Run

```bash
npm install
npm run dev
```

## Local Demo (One Command)

Run an end-to-end demo without external OCR credentials:

```bash
npm run demo:local
```

What it does:
- Starts the app in-process with mock OCR fixture data.
- Submits a rebuild job and polls until completion.
- Prints the generated rebuilt PDF path and confidence summary.
- On macOS, attempts to open the generated PDF automatically.

## Test With Your Own Image

This uses the real Google Vision OCR provider.

1) Export credentials:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/your-service-account.json"
```

2) Run:

```bash
npm run demo:image -- --image "/absolute/path/to/your-document.png"
```

What you get:
- Printed job progress in terminal
- Rebuilt PDF path
- Structured block count + confidence summary
- Auto-opened PDF on macOS (best effort)

## API Contracts

### POST `/rebuild/jobs`

Request:

```json
{
  "documentId": "doc-1",
  "pages": [
    { "pageNumber": 1, "storagePath": "gs://bucket/doc-1-p1.png" }
  ],
  "options": {
    "confidenceThreshold": 0.85,
    "stageTimeoutMs": 15000
  }
}
```

Response (`202`):

```json
{
  "jobId": "0c77b394-5e6f-4f83-95cc-9d58ccf42f9e",
  "acceptedAt": "2026-03-28T12:00:00.000Z",
  "status": "queued"
}
```

### GET `/rebuild/jobs/:jobId`

Response (`200`):

```json
{
  "jobId": "0c77b394-5e6f-4f83-95cc-9d58ccf42f9e",
  "status": "processing",
  "progress": { "stage": "layout", "percent": 55 },
  "error": null,
  "updatedAt": "2026-03-28T12:00:05.100Z"
}
```

### GET `/rebuild/jobs/:jobId/result`

Response (`200`):

```json
{
  "jobId": "0c77b394-5e6f-4f83-95cc-9d58ccf42f9e",
  "status": "completed",
  "result": {
    "pdfPath": "artifacts/0c77b394-5e6f-4f83-95cc-9d58ccf42f9e.pdf",
    "structuredBlocks": [
      {
        "id": "...",
        "pageNumber": 1,
        "blockType": "heading",
        "text": "SERVICE AGREEMENT",
        "confidence": 0.99,
        "lowConfidence": false
      }
    ],
    "confidenceSummary": {
      "threshold": 0.85,
      "overallConfidence": 0.91,
      "lowConfidenceBlocks": 1,
      "totalBlocks": 4
    }
  }
}
```

## Testing

```bash
npm test
npm run lint
npm run build
```

Integration tests use fixture `tests/fixtures/sample-ocr-page-1.json` for deterministic output.

## Notes

- Idempotency key is supported via `Idempotency-Key` request header.
- Retry is applied for retryable OCR failures.
- Stage timeout guards are applied for preprocess, OCR, layout, and recompose stages.
- Geometry-first rendering places text by OCR coordinates and preserves line-level breaks.
- Table reconstruction uses word-box clustering to infer row/column grid and draw borders.
- Result payload includes `manualReview` hooks (`required`, low-confidence block IDs, low-confidence line count).
- Google Vision provider is ready; tests run with mock provider.

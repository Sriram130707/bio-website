# Plant Stress Insight

A responsive plant-care information app. Upload or capture a plant photo, optionally add care context, and receive a cautious AI-generated assessment. Results are informational, not a diagnosis. The app does not use accounts or save photos, context, or result history.

## Requirements

- Node.js 22.12 or later and npm
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys)

## Setup and development

1. Copy `.env.example` to `.env` and replace `add_your_gemini_api_key_here` with your Gemini API key. Keep it server-only; never use a `VITE_` prefix. The Gemini free tier and its model quotas vary by account and region.
2. Install dependencies: `npm install`
3. Start the frontend and API together: `npm run dev`
4. Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The frontend proxies `/api` requests to the Node API on port `3001`.

Do not paste API keys into chat or commit them. Free-tier access, quotas, model availability, and provider data-use terms are controlled by Google and can change. If Gemini free-tier access is unavailable, the account may need billing enabled.

The API also accepts direct multipart requests at `POST http://localhost:3001/api/analyze`, using an `image` file field and optional `plantType`, `symptoms`, `watering`, `light`, and `recentChanges` text fields.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Secret Google AI Studio key, read only by the backend |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Primary server-side Gemini vision model |
| `GEMINI_FALLBACK_MODELS` | `gemini-flash-lite-latest` | Comma-separated fallback models, tried after transient model errors or incomplete/invalid model output |
| `PORT` | `3001` | API listening port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Exact browser origin allowed by API CORS |
| `MAX_UPLOAD_BYTES` | `8388608` | Maximum in-memory upload size in bytes (8 MiB) |

Supported images are JPEG, PNG, and WebP, up to 8 MiB by default. The server checks both the declared MIME type and the file signature, applies a 20-request/15-minute per-IP limit, and does not log image or context contents. If Gemini returns truncated, malformed, or schema-invalid output, the API tries configured fallback models and validates each response before returning it. No provider can guarantee analysis for every image or during authentication, quota, network, or service failures; in those cases the app reports a recoverable error rather than inventing an assessment.

## Build, test, and run

- Run tests: `npm test`
- Type-check both app and API: `npm run typecheck`
- Lint TypeScript and React code: `npm run lint`
- Build the frontend: `npm run build`
- Run the API after building: `npm start`

In development, `npm run dev` starts both services. In a deployment, serve the built `dist` assets with a static web server, route `/api` requests to the Node API, and run `npm start` for the API. Configure `FRONTEND_ORIGIN` to the deployed frontend origin.

## Image privacy and provider retention

Images are processed in memory by this app and sent to the configured AI provider to generate an assessment. This app does not persist uploaded images, user context, or results. The AI provider processes the image under its own terms and policies, which determine whether and how provider-side data may be retained. Review the provider’s current terms and data controls before uploading sensitive images.

The Gemini API free tier, when available, has provider-defined quotas and different data-use terms from its paid tier. Review Google AI Studio's current [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [terms](https://ai.google.dev/gemini-api/terms) before using it.

## Troubleshooting

If analysis says `GEMINI_API_KEY` is missing, add your key to `.env` and restart `npm run dev`. Gemini can temporarily report high demand for an individual model. The server retries temporary 503 responses and tries configured fallbacks after transient model errors or incomplete, malformed, or invalid output. If Gemini reports a usage limit, check the model's free-tier quota in Google AI Studio or wait for it to reset. The app does not generate substitute or mock assessments when Gemini is unavailable.

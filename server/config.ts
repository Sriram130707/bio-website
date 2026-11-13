const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: positiveInteger(process.env.PORT, 3001),
  maxUploadBytes: positiveInteger(process.env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  model: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
  fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-lite-latest")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
};

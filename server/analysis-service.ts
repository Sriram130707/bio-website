import { assessmentSchema, type AnalyzeContext, type Assessment } from "../shared/contract.js";

export class InvalidProviderResponseError extends Error {
  constructor() {
    super("The analysis provider returned an invalid response.");
    this.name = "InvalidProviderResponseError";
  }
}

export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    readonly providerStatus?: string,
  ) {
    super("The Gemini API request failed.");
    this.name = "GeminiApiError";
  }
}

export interface ProviderFailure {
  category: "configuration" | "authentication" | "quota" | "rate_limit" | "request" | "provider" | "connection" | "unknown";
  status?: number;
  code?: string;
}

export function providerFailureMessage(failure: ProviderFailure): string {
  switch (failure.category) {
    case "configuration":
      return "Gemini is not configured yet. Add GEMINI_API_KEY to the server .env file, then restart the app.";
    case "authentication":
      return "Google rejected the Gemini API key. Check that the key is correct and enabled in Google AI Studio.";
    case "quota":
      return "The Gemini API usage limit was reached. Check Google AI Studio for this model’s free-tier quota, or try again after the limit resets.";
    case "rate_limit":
      return "Gemini is receiving too many requests. Please wait a moment and try again.";
    case "request":
      return "Gemini could not accept this request. Check that the selected model is available for this API key.";
    case "provider":
      return "The Gemini API is temporarily unavailable. Please try again later.";
    case "connection":
      return "The Gemini API cannot be reached right now. Check your internet connection and try again.";
    case "unknown":
      return "Plant analysis is temporarily unavailable through Gemini. Please try again.";
  }
}

export function describeProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof GeminiApiError) {
    const category = error.status === 401 || error.status === 403
      ? "authentication"
      : error.status === 429
        ? "quota"
        : error.status >= 500
          ? "provider"
          : error.status >= 400
            ? "request"
            : "unknown";
    return {
      category,
      status: error.status,
      ...(error.providerStatus === undefined ? {} : { code: error.providerStatus }),
    };
  }
  if (error instanceof Error && error.message === "Analysis provider is not configured.") {
    return { category: "configuration" };
  }
  if (error instanceof TypeError || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    const causeCode = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      ? cause.code.slice(0, 60)
      : undefined;
    return {
      category: "connection",
      ...(causeCode === undefined ? {} : { code: causeCode }),
    };
  }
  return { category: "unknown" };
}

export interface AnalysisInput {
  image: Buffer;
  mimeType: string;
  context: AnalyzeContext;
}

export interface AnalysisProvider {
  analyze(input: AnalysisInput): Promise<unknown>;
}

const geminiResponseSchema = {
  type: "OBJECT",
  required: ["summary", "observations", "possibleStressors", "careActions", "uncertainty", "whenToSeekHelp"],
  properties: {
    summary: { type: "STRING" },
    observations: { type: "ARRAY", items: { type: "STRING" } },
    possibleStressors: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "reason", "likelihood"],
        properties: {
          name: { type: "STRING" },
          reason: { type: "STRING" },
          likelihood: { type: "STRING", enum: ["possible", "likely", "uncertain"] },
        },
      },
    },
    careActions: { type: "ARRAY", items: { type: "STRING" } },
    uncertainty: { type: "STRING" },
    whenToSeekHelp: { type: "STRING" },
  },
} as const;

const systemPrompt = [
  "You are a cautious plant-care information assistant, not a diagnostic authority.",
  "Describe only visible image evidence as observations, and clearly separate it from possible explanations.",
  "Never state or imply a definitive diagnosis. Use tentative likelihood labels and do not invent evidence.",
  "Offer a short, prioritized set of low-risk, practical care steps; avoid drastic treatment without stronger evidence.",
  "Keep each item concise. Provide at most 4 observations, 3 possible stressors, and 5 care actions.",
  "Mention image quality, limited context, and other relevant uncertainties. Explain when to consult a local horticulture professional or extension service.",
  "If the image does not show a plant or is too unclear, say so plainly in the summary and observations; do not fabricate plant findings.",
].join(" ");

function buildUserContext(context: AnalyzeContext): string {
  const entries = [
    ["Plant type", context.plantType],
    ["Symptoms described by user", context.symptoms],
    ["Watering", context.watering],
    ["Light", context.light],
    ["Recent changes", context.recentChanges],
  ].filter(([, value]) => value);

  return entries.length
    ? entries.map(([label, value]) => `${label}: ${value}`).join("\n")
    : "No additional plant context was provided.";
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
}

interface GeminiErrorResponse {
  error?: {
    status?: unknown;
  };
}

function providerStatusFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("error" in value)) return undefined;
  const providerError = value.error;
  if (!providerError || typeof providerError !== "object" || !("status" in providerError)) return undefined;
  const status = providerError.status;
  return typeof status === "string" && /^[A-Z_]{1,60}$/.test(status) ? status : undefined;
}

function assessmentFromGeminiResponse(payload: GeminiResponse): Assessment | undefined {
  for (const candidate of payload.candidates ?? []) {
    if (candidate.finishReason && candidate.finishReason !== "STOP") continue;
    const text = candidate.content?.parts
      ?.map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!text) continue;

    try {
      const result = assessmentSchema.safeParse(JSON.parse(text) as unknown);
      if (result.success) return result.data;
    } catch {
      continue;
    }
  }
  return undefined;
}

export class GeminiAnalysisProvider implements AnalysisProvider {
  constructor(
    private readonly apiKey: string | undefined = process.env.GEMINI_API_KEY,
    private readonly model: string = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
    private readonly fetchRequest: typeof fetch = fetch,
    private readonly fallbackModels: string[] = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-lite-latest")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
  ) {}

  async analyze(input: AnalysisInput): Promise<unknown> {
    const apiKey = this.apiKey?.trim();
    if (!apiKey || apiKey === "add_your_gemini_api_key_here" || apiKey === "your_gemini_api_key_here") {
      throw new Error("Analysis provider is not configured.");
    }

    const body = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        role: "user",
        parts: [
          { text: `Assess this plant photo using the supplied context. Return only the requested structured assessment.\n\n${buildUserContext(input.context)}` },
          { inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 3000,
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema,
      },
    });

    const models = [...new Set([this.model, ...this.fallbackModels])];
    for (const [modelIndex, model] of models.entries()) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await this.fetchRequest(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok || response.status !== 503 || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }

      if (response?.ok) {
        let payload: GeminiResponse;
        try {
          payload = await response.json() as GeminiResponse;
        } catch {
          payload = {};
        }
        const assessment = assessmentFromGeminiResponse(payload);
        if (assessment) return assessment;

        if (modelIndex < models.length - 1) {
          console.warn("Gemini model returned an incomplete assessment; trying configured fallback model.");
          continue;
        }
        throw new InvalidProviderResponseError();
      }

      if (response && [429, 404, 503].includes(response.status) && modelIndex < models.length - 1) {
        console.warn("Gemini model is temporarily unavailable; trying configured fallback model.");
        continue;
      }

      let errorPayload: GeminiErrorResponse | undefined;
      try {
        errorPayload = await response?.json() as GeminiErrorResponse;
      } catch {
        errorPayload = undefined;
      }
      throw new GeminiApiError(response?.status ?? 503, providerStatusFrom(errorPayload));
    }

    throw new InvalidProviderResponseError();
  }
}

export async function analyzePlant(
  provider: AnalysisProvider,
  input: AnalysisInput,
): Promise<Assessment> {
  let candidate: unknown;
  try {
    candidate = await provider.analyze(input);
  } catch (error) {
    if (error instanceof InvalidProviderResponseError) {
      throw error;
    }
    throw error;
  }

  const result = assessmentSchema.safeParse(candidate);
  if (!result.success) {
    throw new InvalidProviderResponseError();
  }
  return result.data;
}

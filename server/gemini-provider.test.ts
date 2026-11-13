import { describe, expect, it, vi } from "vitest";
import {
  describeProviderFailure,
  GeminiAnalysisProvider,
  GeminiApiError,
  InvalidProviderResponseError,
} from "./analysis-service.js";
import type { AnalysisInput } from "./analysis-service.js";

const assessment = {
  summary: "The image shows pale leaves, but it does not establish a cause.",
  observations: ["Some leaves appear lighter than others."],
  possibleStressors: [{ name: "Watering conditions", reason: "Changes in watering can affect leaf color.", likelihood: "possible" }],
  careActions: ["Check soil moisture before watering."],
  uncertainty: "Only one image and limited care details are available.",
  whenToSeekHelp: "Ask a local horticulture service if the plant keeps declining.",
};

const input: AnalysisInput = {
  image: Buffer.from("image bytes"),
  mimeType: "image/png",
  context: {
    plantType: "Pothos",
    symptoms: "Lower leaves look pale",
    watering: "Weekly",
    light: "Indirect",
    recentChanges: "",
  },
};

describe("Gemini analysis provider", () => {
  it("sends the image and context to Gemini and parses its structured assessment", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(assessment) }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const provider = new GeminiAnalysisProvider("test-key", "gemini-test", fetchRequest);

    await expect(provider.analyze(input)).resolves.toEqual(assessment);

    const [url, options] = fetchRequest.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    const body = JSON.parse(String(options?.body));
    expect(body.contents[0].parts[0].text).toContain("Pothos");
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/png",
      data: input.image.toString("base64"),
    });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBe(3000);
  });

  it("retries a temporarily unavailable Gemini model", async () => {
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(assessment) }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    const provider = new GeminiAnalysisProvider("test-key", "gemini-test", fetchRequest);

    await expect(provider.analyze(input)).resolves.toEqual(assessment);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("uses the configured fallback model after temporary primary-model failures", async () => {
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(assessment) }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    const provider = new GeminiAnalysisProvider(
      "test-key",
      "primary-model",
      fetchRequest,
      ["fallback-model"],
    );

    await expect(provider.analyze(input)).resolves.toEqual(assessment);
    expect(fetchRequest).toHaveBeenCalledTimes(4);
    expect(fetchRequest.mock.calls[0][0]).toContain("/primary-model:");
    expect(fetchRequest.mock.calls[3][0]).toContain("/fallback-model:");
  });

  it("uses a fallback model when the primary response is truncated at the token limit", async () => {
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"summary":' }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(assessment) }] } }],
      }), { status: 200 }));
    const provider = new GeminiAnalysisProvider("test-key", "primary-model", fetchRequest, ["fallback-model"]);

    await expect(provider.analyze(input)).resolves.toEqual(assessment);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(fetchRequest.mock.calls[1][0]).toContain("/fallback-model:");
  });

  it("uses a fallback model when the primary response does not match the assessment schema", async () => {
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: "Incomplete." }) }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(assessment) }] } }],
      }), { status: 200 }));
    const provider = new GeminiAnalysisProvider("test-key", "primary-model", fetchRequest, ["fallback-model"]);

    await expect(provider.analyze(input)).resolves.toEqual(assessment);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(fetchRequest.mock.calls[1][0]).toContain("/fallback-model:");
  });

  it("allows an honest no-plant response without inventing stressors or care actions", async () => {
    const noPlantAssessment = {
      summary: "No plant is identifiable in this image.",
      observations: ["The image does not show enough plant detail for an assessment."],
      possibleStressors: [],
      careActions: [],
      uncertainty: "A clear photo of the plant is needed to comment on its condition.",
      whenToSeekHelp: "Retake the photo with the plant in focus if you need plant-care guidance.",
    };
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(noPlantAssessment) }] } }],
      }), { status: 200 }),
    );
    const provider = new GeminiAnalysisProvider("test-key", "gemini-test", fetchRequest, []);

    await expect(provider.analyze(input)).resolves.toEqual(noPlantAssessment);
  });

  it("classifies Gemini usage-limit errors", () => {
    expect(describeProviderFailure(new GeminiApiError(429))).toEqual({
      category: "quota",
      status: 429,
    });
  });

  it("rejects malformed or empty model responses", async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }),
    );
    const provider = new GeminiAnalysisProvider("test-key", "gemini-test", fetchRequest, []);
    await expect(provider.analyze(input)).rejects.toBeInstanceOf(InvalidProviderResponseError);
  });

  it("fails safely when every configured model returns invalid output", async () => {
    const invalidResponse = new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "not json" }] } }],
    }), { status: 200 });
    const fetchRequest = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(invalidResponse.clone())
      .mockResolvedValueOnce(invalidResponse.clone());
    const provider = new GeminiAnalysisProvider("test-key", "primary-model", fetchRequest, ["fallback-model"]);

    await expect(provider.analyze(input)).rejects.toBeInstanceOf(InvalidProviderResponseError);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("fails safely when a Gemini key is missing", async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const provider = new GeminiAnalysisProvider(undefined, "gemini-test", fetchRequest);
    await expect(provider.analyze(input)).rejects.toThrow("Analysis provider is not configured.");
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("does not send the setup placeholder as an API key", async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const provider = new GeminiAnalysisProvider("add_your_gemini_api_key_here", "gemini-test", fetchRequest);
    await expect(provider.analyze(input)).rejects.toThrow("Analysis provider is not configured.");
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

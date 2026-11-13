import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Assessment } from "../shared/contract.js";
import { GeminiApiError, type AnalysisProvider } from "./analysis-service.js";
import { createApp } from "./app.js";

const assessment: Assessment = {
  summary: "The leaves show some yellowing, though the photo alone cannot explain why.",
  observations: ["Several lower leaves appear pale."],
  possibleStressors: [{ name: "Watering stress", reason: "Leaf color can change with watering conditions.", likelihood: "possible" }],
  careActions: ["Check the top layer of soil before watering."],
  uncertainty: "Lighting and the plant's recent care history are not fully known.",
  whenToSeekHelp: "Ask a local horticulture professional if the decline continues.",
};

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function providerReturning(result: unknown): AnalysisProvider {
  return { analyze: vi.fn().mockResolvedValue(result) };
}

describe("POST /api/analyze", () => {
  it("returns a validated assessment and forwards optional context", async () => {
    const provider = providerReturning(assessment);
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .field("plantType", "Pothos")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(assessment);
    expect(provider.analyze).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: "image/png",
      context: expect.objectContaining({ plantType: "Pothos" }),
    }));
  });

  it("rejects a file with a supported MIME type but an invalid signature", async () => {
    const provider = providerReturning(assessment);
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .attach("image", Buffer.from("not actually an image"), { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE");
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME types", async () => {
    const response = await request(createApp(providerReturning(assessment)))
      .post("/api/analyze")
      .attach("image", Buffer.from("<svg></svg>"), { filename: "plant.svg", contentType: "image/svg+xml" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects oversized uploads before analysis", async () => {
    const provider = providerReturning(assessment);
    const response = await request(createApp(provider, { maxUploadBytes: 10 }))
      .post("/api/analyze")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE");
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("returns a safe error when the provider fails", async () => {
    const provider: AnalysisProvider = { analyze: vi.fn().mockRejectedValue(new Error("private provider details")) };
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("ANALYSIS_FAILED");
    expect(response.body.error.message).not.toContain("private provider details");
  });

  it("explains Gemini API quota limits without returning provider details", async () => {
    const providerError = new GeminiApiError(429);
    const provider: AnalysisProvider = { analyze: vi.fn().mockRejectedValue(providerError) };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(502);
    expect(response.body.error.message).toMatch(/Gemini API usage limit was reached/i);
    expect(log).toHaveBeenCalledWith("Plant analysis provider request failed.", {
      category: "quota",
      status: 429,
    });
    log.mockRestore();
  });

  it("explains how to configure the Gemini key", async () => {
    const provider: AnalysisProvider = {
      analyze: vi.fn().mockRejectedValue(new Error("Analysis provider is not configured.")),
    };
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(502);
    expect(response.body.error.message).toMatch(/GEMINI_API_KEY.*server \.env/i);
  });

  it("rejects malformed provider output rather than returning fabricated data", async () => {
    const provider = providerReturning({ summary: "Only a summary." });
    const response = await request(createApp(provider))
      .post("/api/analyze")
      .attach("image", png, { filename: "plant.png", contentType: "image/png" });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("INVALID_RESPONSE");
  });

  it("requires an image", async () => {
    const response = await request(createApp(providerReturning(assessment))).post("/api/analyze");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE");
  });
});

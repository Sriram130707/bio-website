import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { Assessment } from "../shared/contract";

const assessment: Assessment = {
  summary: "Some leaves appear pale. This photo cannot establish the cause.",
  observations: ["A few lower leaves look lighter than the rest."],
  possibleStressors: [{ name: "Watering conditions", reason: "Changes in watering can sometimes affect leaf color.", likelihood: "possible" }],
  careActions: ["Check the soil moisture before watering again."],
  uncertainty: "The image and limited care details leave several explanations possible.",
  whenToSeekHelp: "Seek local advice if more leaves change or the plant declines.",
};

function apiResponse(payload: unknown, ok = true) {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:plant-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("Plant Stress Insight workflow", () => {
  it("shows a recoverable error and allows retrying for a real result", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(apiResponse({ error: { code: "ANALYSIS_FAILED", message: "Please try again." } }, false))
      .mockResolvedValueOnce(apiResponse(assessment));

    render(<App />);
    await user.upload(screen.getByLabelText("Choose a plant photo"), new File(["image"], "leaf.png", { type: "image/png" }));
    expect(screen.getByAltText("Preview of the selected plant photo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /get plant insights/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again.");
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText(assessment.summary)).toBeInTheDocument();
    expect(screen.getByText("What’s visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print \/ save pdf/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores an analysis response made stale by replacing the photo", async () => {
    const user = userEvent.setup();
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

    render(<App />);
    await user.upload(screen.getByLabelText("Choose a plant photo"), new File(["first"], "first.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /get plant insights/i }));
    const analyzingButton = screen.getByRole("button", { name: /taking a closer look/i });
    expect(analyzingButton).toBeDisabled();
    await user.click(analyzingButton);
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /replace photo/i }));
    await user.upload(screen.getByLabelText("Replace plant photo"), new File(["second"], "second.png", { type: "image/png" }));
    resolveFetch?.(apiResponse(assessment));

    await waitFor(() => expect(screen.getByRole("button", { name: /get plant insights/i })).toBeEnabled());
    expect(screen.queryByText(assessment.summary)).not.toBeInTheDocument();
    expect(screen.getByText("second.png")).toBeInTheDocument();
  });

  it("rejects unsupported files before sending a request", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App />);
    await user.upload(screen.getByLabelText("Choose a plant photo"), new File(["text"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("file type is not supported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a clear no-evidence result without invented stressors or care steps", async () => {
    const user = userEvent.setup();
    const noPlantAssessment: Assessment = {
      summary: "No plant is identifiable in this image.",
      observations: ["The image does not show enough plant detail for an assessment."],
      possibleStressors: [],
      careActions: [],
      uncertainty: "A clear photo of the plant is needed to comment on its condition.",
      whenToSeekHelp: "Retake the photo with the plant in focus if you need plant-care guidance.",
    };
    vi.mocked(fetch).mockResolvedValue(apiResponse(noPlantAssessment));

    render(<App />);
    await user.upload(screen.getByLabelText("Choose a plant photo"), new File(["image"], "other.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: /get plant insights/i }));

    expect(await screen.findByText("No plant is identifiable in this image.")).toBeInTheDocument();
    expect(screen.getByText("There isn’t enough visual evidence to suggest a possible stressor.")).toBeInTheDocument();
    expect(screen.getByText("No care changes are suggested from this image alone.")).toBeInTheDocument();
  });
});

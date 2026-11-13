import { z } from "zod";

export const possibleStressorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(600),
  likelihood: z.enum(["possible", "likely", "uncertain"]),
}).strict();

export const assessmentSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  observations: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  possibleStressors: z.array(possibleStressorSchema).max(6),
  careActions: z.array(z.string().trim().min(1).max(500)).max(8),
  uncertainty: z.string().trim().min(1).max(1000),
  whenToSeekHelp: z.string().trim().min(1).max(800),
}).strict();

export type Assessment = z.infer<typeof assessmentSchema>;
export type StressLikelihood = Assessment["possibleStressors"][number]["likelihood"];

export const analyzeContextSchema = z.object({
  plantType: z.string().trim().max(120).optional().default(""),
  symptoms: z.string().trim().max(1000).optional().default(""),
  watering: z.string().trim().max(400).optional().default(""),
  light: z.string().trim().max(400).optional().default(""),
  recentChanges: z.string().trim().max(600).optional().default(""),
});

export type AnalyzeContext = z.infer<typeof analyzeContextSchema>;

export type ApiErrorCode = "INVALID_IMAGE" | "ANALYSIS_FAILED" | "INVALID_RESPONSE";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

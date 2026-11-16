import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";

import {
  analyzeContextSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
} from "../shared/contract.js";

import {
  analyzePlant,
  describeProviderFailure,
  InvalidProviderResponseError,
  providerFailureMessage,
  type AnalysisProvider,
} from "./analysis-service.js";

import { config } from "./config.js";
import {
  hasValidImageSignature,
  isSupportedImageMime,
} from "./image-validation.js";

class InvalidUploadError extends Error {}

function sendError(
  res: express.Response,
  status: number,
  code: ApiErrorCode,
  message: string
): void {
  const body: ApiErrorResponse = {
    error: { code, message },
  };

  res.status(status).json(body);
}

export function createApp(
  provider: AnalysisProvider,
  options: {
    maxUploadBytes?: number;
    frontendOrigin?: string;
  } = {}
): express.Express {
  const app = express();

  const maxUploadBytes =
    options.maxUploadBytes ?? config.maxUploadBytes;

  const frontendOrigin =
    options.frontendOrigin ?? config.frontendOrigin;

  app.disable("x-powered-by");

  // Important: Render runs the application behind a proxy.
  // Trust the Render proxy so express-rate-limit can identify client IPs.
  app.set("trust proxy", 1);

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin === frontendOrigin) {
          callback(null, true);
        } else {
          callback(new Error("Origin is not allowed."));
        }
      },
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );

  app.use(express.json({ limit: "16kb" }));

  const analyzeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: {
        code: "ANALYSIS_FAILED",
        message:
          "Too many requests. Please wait a few minutes and try again.",
      },
    },
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
      fields: 5,
      fieldSize: 1200,
      parts: 6,
    },
    fileFilter: (_request, file, callback) => {
      if (!isSupportedImageMime(file.mimetype)) {
        callback(new InvalidUploadError("Unsupported image format."));
        return;
      }

      callback(null, true);
    },
  });

  app.post(
    "/api/analyze",
    analyzeLimiter,
    upload.single("image"),
    async (request, response) => {
      const file = request.file;

      if (!file || !hasValidImageSignature(file)) {
        sendError(
          response,
          400,
          "INVALID_IMAGE",
          "Choose a valid JPEG, PNG, or WebP image and try again."
        );
        return;
      }

      const context = analyzeContextSchema.safeParse(
        request.body ?? {}
      );

      if (!context.success) {
        sendError(
          response,
          400,
          "ANALYSIS_FAILED",
          "Some context fields are too long. Review them and try again."
        );
        return;
      }

      try {
        const assessment = await analyzePlant(provider, {
          image: file.buffer,
          mimeType: file.mimetype,
          context: context.data,
        });

        response.json(assessment);
      } catch (error) {
        if (error instanceof InvalidProviderResponseError) {
          sendError(
            response,
            502,
            "INVALID_RESPONSE",
            "The analysis service returned an unreadable result. Please try again."
          );
          return;
        }

        const failure = describeProviderFailure(error);

        console.error(
          "Plant analysis provider request failed.",
          failure
        );

        sendError(
          response,
          502,
          "ANALYSIS_FAILED",
          providerFailureMessage(failure)
        );
      }
    }
  );

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next
  ) => {
    if (
      error instanceof InvalidUploadError ||
      error instanceof multer.MulterError
    ) {
      const message =
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
          ? `The image is too large. Choose an image under ${Math.floor(
              maxUploadBytes / (1024 * 1024)
            )} MB.`
          : "Choose one valid JPEG, PNG, or WebP image and try again.";

      sendError(response, 400, "INVALID_IMAGE", message);
      return;
    }

    if (response.headersSent) {
      next(error);
      return;
    }

    sendError(
      response,
      500,
      "ANALYSIS_FAILED",
      "Something went wrong. Please try again."
    );
  };

  app.use(errorHandler);

  return app;
}
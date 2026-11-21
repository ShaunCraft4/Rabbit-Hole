import { z } from "zod";

import {
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  API_ERROR_CODES,
  API_ROUTES,
  ApiErrorSchema,
  PlanRequestSchema,
  PlanResponseSchema,
  ReportRequestSchema,
  ReportResponseSchema,
  ResearchRequestSchema,
  ResearchResponseSchema,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type PlanRequest,
  type PlanResponse,
  type ReportRequest,
  type ReportResponse,
  type ResearchRequest,
  type ResearchResponse,
} from "@/lib/contracts";

/** A failed route call, normalized to { code, message } plus the HTTP status. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

function invalidRequest(error: z.ZodError): ApiClientError {
  const message = error.issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(" ");
  return new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, message || "That request is not valid.", 400);
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(
      "NETWORK",
      "The path down could not be reached. Check your connection and try again.",
      0,
    );
  }

  const json = await readBody(response);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiClientError(
        parsed.data.error.code,
        parsed.data.error.message || "The request failed.",
        response.status,
      );
    }
    throw new ApiClientError(API_ERROR_CODES.INTERNAL, "The request failed.", response.status);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError(
      API_ERROR_CODES.MODEL_OUTPUT_INVALID,
      "The response did not match the expected shape.",
      response.status,
    );
  }
  return parsed.data;
}

export function postPlan(body: PlanRequest): Promise<PlanResponse> {
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return Promise.reject(invalidRequest(parsed.error));
  return postJson(API_ROUTES.plan, parsed.data, PlanResponseSchema);
}

export function postResearch(body: ResearchRequest): Promise<ResearchResponse> {
  const parsed = ResearchRequestSchema.safeParse(body);
  if (!parsed.success) return Promise.reject(invalidRequest(parsed.error));
  return postJson(API_ROUTES.research, parsed.data, ResearchResponseSchema);
}

export function postAnalyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) return Promise.reject(invalidRequest(parsed.error));
  return postJson(API_ROUTES.analyze, parsed.data, AnalyzeResponseSchema);
}

export function postReport(body: ReportRequest): Promise<ReportResponse> {
  const parsed = ReportRequestSchema.safeParse(body);
  if (!parsed.success) return Promise.reject(invalidRequest(parsed.error));
  return postJson(API_ROUTES.report, parsed.data, ReportResponseSchema);
}

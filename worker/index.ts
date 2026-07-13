/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import gplLicenseText from "../LICENSE?raw";
import { BrowserSession } from "./browser-session";
import {
  CloudflareAiNameVariantProvider,
  suggestNameVariants,
  validateNameVariantRequest,
} from "../lib/server/name-variant-provider.mjs";

export { BrowserSession };

interface WorkerEnv {
  ASSETS: Fetcher;
  AI: Ai;
  AI_VARIANT_RATE_LIMITER: RateLimit;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function apiJson(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store, private",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function handleVariantSuggestions(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return apiJson({ error: "Use POST for variant suggestions." }, 405);
  }
  if (request.headers.get("origin") !== url.origin) {
    return apiJson({ error: "Cross-origin variant requests are not allowed." }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return apiJson({ error: "Variant suggestions require JSON." }, 415);
  }

  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await env.AI_VARIANT_RATE_LIMITER.limit({ key: actor });
  if (!rateLimit.success) {
    return apiJson(
      { error: "Too many AI variant requests. Try again in a minute." },
      429,
    );
  }

  const text = await request.text();
  if (text.length > 2_048) {
    return apiJson({ error: "Variant request is too large." }, 413);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return apiJson({ error: "Variant request is not valid JSON." }, 400);
  }
  const input = validateNameVariantRequest(raw);
  if (!input) {
    return apiJson(
      {
        error:
          "Provide only state, voter name, relative names, and explicit AI opt-in.",
      },
      400,
    );
  }

  const result = await suggestNameVariants(
    input,
    new CloudflareAiNameVariantProvider(env.AI),
  );
  return apiJson(result);
}

const worker = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/variants") {
      return handleVariantSuggestions(request, env);
    }

    if (url.pathname === "/api/search") {
      return apiJson(
        {
          error:
            "Cloud browser search is disabled. Install the SIR Assist browser companion and reload the app.",
          extensionRequired: true,
        },
        410,
      );
    }

    if (url.pathname === "/LICENSE.txt") {
      return new Response(gplLicenseText, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=86400",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/_vinext/image" && env.IMAGES) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES!.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

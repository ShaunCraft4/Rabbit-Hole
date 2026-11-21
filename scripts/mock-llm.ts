/**
 * A tiny fake OpenAI-compatible chat server for tests: answers each request with the next queued
 * reply, and points the app's LLM env vars at itself.
 *
 * A reply is either the assistant's message text, or an HTTP error to return instead
 * ({ status, body?, headers? }), e.g. { status: 429, headers: { "retry-after": "0" } }.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type MockReply = string | { status: number; body?: unknown; headers?: Record<string, string> };

export interface MockLLM {
  /** Replies to send, in order; once empty, every reply is "still not json". */
  replies: MockReply[];
  /** Requests received since the last reset(). */
  calls: () => number;
  /** Request bodies received since the last reset() (for checking what the app sent). */
  bodies: () => string[];
  reset: () => void;
  close: () => Promise<void>;
}

export async function startMockLLM(opts: { apiKey?: string } = {}): Promise<MockLLM> {
  const replies: MockReply[] = [];
  let calls = 0;
  let bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      calls++;
      bodies.push(body);
      const reply = replies.shift() ?? "still not json";
      res.setHeader("content-type", "application/json");
      if (typeof reply !== "string") {
        res.statusCode = reply.status;
        for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
        res.end(JSON.stringify(reply.body ?? { error: { message: `mock error ${reply.status}`, type: "mock" } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: `mock-${calls}`,
          object: "chat.completion",
          created: 0,
          model: "mock-model",
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = opts.apiKey ?? "";
  process.env.LLM_MODEL_STRONG = "mock-model";
  process.env.LLM_MODEL_FAST = "mock-model";

  return {
    replies,
    calls: () => calls,
    bodies: () => bodies,
    reset: () => {
      calls = 0;
      bodies = [];
    },
    // Close keep-alive sockets and wait, or exiting trips a libuv assertion on Windows.
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

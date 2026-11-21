/**
 * A tiny fake OpenAI-compatible chat server for tests: answers each request with the next queued
 * reply, and points the app's LLM env vars at itself.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLLM {
  /** Replies to send, in order; once empty, every reply is "still not json". */
  replies: string[];
  /** Requests received since the last reset(). */
  calls: () => number;
  reset: () => void;
  close: () => Promise<void>;
}

export async function startMockLLM(): Promise<MockLLM> {
  const replies: string[] = [];
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls++;
      const content = replies.shift() ?? "still not json";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `mock-${calls}`,
          object: "chat.completion",
          created: 0,
          model: "mock-model",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "";
  process.env.LLM_MODEL_STRONG = "mock-model";
  process.env.LLM_MODEL_FAST = "mock-model";

  return {
    replies,
    calls: () => calls,
    reset: () => {
      calls = 0;
    },
    // Close keep-alive sockets and wait, or exiting trips a libuv assertion on Windows.
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * claude-relay.js — 讓呼叫 Claude 這一步固定從美國機房發出（Durable Object）。
 *
 * Worker 平常在離使用者最近的機房執行；手機有時會被分到香港機房，而香港不在 Anthropic 的服務地區，
 * 請求會被擋（HTTP 403「Request not allowed」）。functions/ask.js 用 locationHint "wnam"（美國西部）
 * 建立這個物件，之後它都在那裡執行，從它發出去的請求就是美國出口。只轉送 Claude Messages API，不存任何資料。
 */
export class ClaudeRelay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const pick = (name) => request.headers.get(name) || "";
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": pick("x-api-key"), "anthropic-version": pick("anthropic-version") },
      body: await request.text(),
    });
  }
}

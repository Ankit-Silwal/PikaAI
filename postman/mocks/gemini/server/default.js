// Contract subset: https://ai.google.dev/gemini-api/docs/openai
// A deterministic test response; this does not simulate Gemini's reasoning quality.
const http = require("http");
http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || req.url !== "/v1beta/openai/chat/completions") return send(501, { error: "Unmodeled operation" });
  const body = req.body;
  if (!body || body.model !== "gemini-3.1-flash-lite" || !Array.isArray(body.messages)) return send(400, { error: "Invalid chat request" });
  const system = body.messages.find(message => message.role === "system")?.content;
  const question = body.messages.find(message => message.role === "user")?.content;
  if (typeof system !== "string" || !system.includes("Context:\n[1] File:") || system.includes("{context}") || typeof question !== "string") {
    return send(400, { error: "Missing interpolated context or question" });
  }
  if (question === "__provider_error__") {
    res.writeHead(503, { "Content-Type": "text/html" });
    return res.end("<html>Upstream unavailable</html>");
  }
  return send(200, {
    id: "chatcmpl-rag-test", object: "chat.completion", created: 1, model: body.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Test answer grounded in the provided excerpt [1]." } }],
  });
}).listen(process.env.PORT || 4500);

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express from "express";
import type { ModelProfile, Run } from "../shared/types";
process.env.STUDIO_DATA_DIR = resolve(
  "output",
  "verification-ai-client",
  Date.now().toString(),
);
const { encrypt, put, get } = await import("../server/store");
const { callModel } = await import("../server/ai-client");
const { analyze, cancelAnalysis } = await import("../server/ai");
const app = express();
app.use(express.json());
let checkedQwen = false;
let openRequests = 0;
let maxOpenRequests = 0;
app.post("/chat/completions", (req, res) => {
  const mode = req.body.model;
  assert.equal(req.body.stream, true);
  if (mode === "qwen3.8-flash") {
    assert.equal(req.body.enable_thinking, false);
    assert.equal(req.body.response_format.type, "json_object");
    checkedQwen = true;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.flushHeaders();
  openRequests++;
  maxOpenRequests = Math.max(maxOpenRequests, openRequests);
  const timers: ReturnType<typeof setTimeout>[] = [];
  res.on("close", () => {
    openRequests--;
    timers.forEach(clearTimeout);
  });
  const send = (data: unknown) =>
    res.write(`data: ${JSON.stringify(data)}\r\n\r\n`);
  if (mode === "hold") {
    const keepAlive = () => {
      if (!res.destroyed) {
        res.write(": keep-alive\n\n");
        timers.push(setTimeout(keepAlive, 30));
      }
    };
    keepAlive();
    return;
  }
  if (mode === "disconnect") {
    send({ choices: [{ delta: { content: "不完整结果" } }] });
    res.end();
    return;
  }
  let answer = {
    summary: "流式分析结果，中文完整。",
    conclusion: "当前覆盖未发现明确风险，持续观察业务结果与异常日志。",
    findings: [] as unknown[],
    caseDescriptions: [] as unknown[],
  };
  if (mode === "parallel") {
    const bundle = JSON.parse(req.body.messages[1].content);
    answer = {
      summary: "本批分析完成。",
      conclusion: "当前覆盖未发现明确风险，持续观察业务结果与异常日志。",
      findings: [],
      caseDescriptions: (bundle.steps || []).map((s: { id: string }) => ({
        stepId: s.id,
        verdict: "limited",
        reason: "当前证据不足以确认完整业务结果。",
        title: "检查按钮",
        expected: "业务预期待确认",
      })),
    };
  }
  const text = JSON.stringify(answer);
  const startDelay = mode === "parallel" ? 160 : 1100;
  timers.push(
    setTimeout(() => {
      send({
        choices: [
          { delta: { reasoning_content: "测试思考内容（不保存正文）" } },
        ],
      });
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
      const bytes = Buffer.from(frame);
      // Split UTF-8 bytes and SSE line endings to exercise incremental decoding.
      for (let index = 0; index < bytes.length; index += 7)
        res.write(bytes.subarray(index, index + 7));
      send({ choices: [{ delta: {}, finish_reason: "stop" }] });
      send({ choices: [], usage: { total_tokens: 30 } });
      res.write("data: [DONE]\r\n\r\n");
      res.end();
    }, startDelay),
  );
});
const server = createServer(app);
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const profile: ModelProfile = {
  id: randomUUID(),
  name: "流式测试",
  provider: "Qwen",
  model: "qwen3.8-flash",
  baseUrl: `http://127.0.0.1:${port}`,
  apiKey: encrypt("test-key"),
  timeout: 5,
  maxTokens: 4096,
  enabled: true,
};
try {
  const updates: { stage: string; receivedCharacters: number }[] = [];
  const result = await callModel(
    profile,
    [{ role: "user", content: "JSON 连接测试" }],
    { json: true, onProgress: (event) => updates.push(event) },
  );
  assert(checkedQwen);
  assert.equal(JSON.parse(result.content).summary, "流式分析结果，中文完整。");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { total_tokens: 30 });
  assert(updates.some((u) => u.stage === "generating"));
  assert(updates.some((u) => u.receivedCharacters > 0));
  await assert.rejects(
    () =>
      callModel({ ...profile, provider: "Custom", model: "disconnect" }, [
        { role: "user", content: "test" },
      ]),
    /中途断开/,
  );
  await assert.rejects(
    () =>
      callModel({ ...profile, model: "hold", timeout: 0.2 }, [
        { role: "user", content: "test" },
      ]),
    /请求超时/,
  );
  const run: Run = {
    id: randomUUID(),
    name: "并发分析",
    project: "验证",
    environment: "测试",
    url: "http://example.test",
    mode: "record",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    scene: "查询",
    archived: false,
    requests: [],
    logs: [],
    notes: [],
    findings: [],
    cases: [],
    analysis: { status: "NONE", findings: [] },
    operations: Array.from({ length: 3 }, (_, i) => ({
      id: randomUUID(),
      sequence: i + 1,
      pageId: "page-1",
      framePath: [],
      timestamp: new Date().toISOString(),
      kind: "click",
      label: "按钮",
      module: "查询",
      scene: "查询",
      url: "http://example.test",
      locators: [],
      status: "RECORDED",
      dependsOn: [],
      timeout: 1000,
      effect: "read",
      enabled: true,
    })),
  };
  const parallelProfile = {
    ...profile,
    id: randomUUID(),
    provider: "Custom" as const,
    model: "parallel",
    maxTokens: 100,
  };
  put("model", parallelProfile);
  put("run", run);
  maxOpenRequests = 0;
  await analyze(run, parallelProfile.id);
  while (get<Run>("run", run.id)?.analysis.status === "RUNNING")
    await new Promise((done) => setTimeout(done, 20));
  assert.equal(run.analysis.status, "COMPLETED", run.analysis.error);
  assert.equal(maxOpenRequests, 3, "必须有限并行处理三批");
  assert.equal(run.analysis.caseDescriptions?.length, 3);
  const holdProfile = {
    ...parallelProfile,
    id: randomUUID(),
    model: "hold",
    maxTokens: 4096,
  };
  const holdRun = {
    ...structuredClone(run),
    id: randomUUID(),
    analysis: { status: "NONE" as const, findings: [] },
  };
  put("model", holdProfile);
  put("run", holdRun);
  await analyze(holdRun, holdProfile.id);
  await new Promise((done) => setTimeout(done, 100));
  const stopped = await cancelAnalysis(holdRun.id);
  assert.equal(stopped?.analysis.status, "FAILED");
  assert(stopped?.analysis.error?.includes("分析已停止"));
  assert.equal(stopped?.analysis.activeRequests?.length, 0);
  console.log(
    "模型客户端：Qwen 默认关闭思考、流式中文解析、生成状态和 Usage 通过。",
  );
  console.log(
    "有界执行：三批并发、断流检测、持续心跳下总超时、主动停止和检查点保留通过。",
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

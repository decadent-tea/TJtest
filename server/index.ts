import { finalFindings } from "./evidence-quality";
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  put,
  get,
  list,
  remove,
  deleteArchivedRun,
  summary,
  dataRoot,
  encrypt,
  publicProfile,
  recoverInterrupted,
} from "./store";
import type { Flow, Run, ModelProfile, Operation } from "../shared/types";
import {
  startSession,
  stopSession,
  pauseSession,
  readRun,
  setScene,
  activeRuns,
  answerDialog,
} from "./recorder";
import { finalizeReport, reportHtml } from "./report";
import { preparedReport, prewarmReport, forgetReport } from "./report-cache";
import { analyze, callModel, cancelAnalysis } from "./ai";
import { casesWorkbook } from "./export";
import { attachmentHeader, downloadName } from "./download-name";

const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT || 4318);
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (
    req.path.startsWith("/api") &&
    origin &&
    ![
      `http://127.0.0.1:${port}`,
      "http://127.0.0.1:5173",
      `http://localhost:${port}`,
      "http://localhost:5173",
    ].includes(origin)
  ) {
    res.status(403).json({ error: "只接受本机管理页面的请求。" });
    return;
  }
  next();
});
app.use(express.json({ limit: "3mb" }));
recoverInterrupted();
const route =
  (fn: (req: express.Request, res: express.Response) => unknown) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
function requiredRun(id: string) {
  const run = readRun(id);
  if (!run) throw new Error("体检记录不存在。");
  return run;
}
const urlSchema = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "地址须为不含账号密码的 HTTP/HTTPS URL。");
const recordingSchema = z.object({
  name: z.string().trim().min(1).max(100),
  project: z.string().trim().min(1).max(100),
  environment: z.string().max(100).default("测试环境"),
  url: urlSchema,
  headless: z.boolean().optional(),
});
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    storage: "SQLite",
    active: activeRuns(),
    version: "0.1.0",
  }),
);
app.get("/api/runs", (_req, res) =>
  res.json(list<Run>("run").map((r) => summary(readRun(r.id) || r))),
);
app.get(
  "/api/runs/:id",
  route((req, res) => {
    const run = requiredRun(req.params.id as string);
    if (run.analysis.status === "COMPLETED") prewarmReport(run);
    res.json(run);
  }),
);
app.post(
  "/api/runs/:id/requests/:requestId",
  route((req, res) => {
    const run = requiredRun(req.params.id as string);
    const call = run.requests.find((r) => r.id === req.params.requestId);
    if (!call) throw new Error("接口调用不存在。");
    const input = z
      .object({
        description: z.string().trim().min(1).max(500),
        module: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    call.description = input.description;
    call.module = input.module;
    finalizeReport(run);
    put("run", run);
    res.json(run);
  }),
);
app.post(
  "/api/recordings",
  route(async (req, res) => {
    const input = recordingSchema.parse(req.body);
    res.status(201).json(await startSession(input));
  }),
);
app.post(
  "/api/runs/:id/stop",
  route(async (req, res) =>
    res.json(await stopSession(req.params.id as string)),
  ),
);
app.post(
  "/api/runs/:id/pause",
  route((req, res) => res.json(pauseSession(req.params.id as string))),
);
app.post(
  "/api/runs/:id/scene",
  route((req, res) =>
    res.json(
      setScene(
        req.params.id as string,
        z.object({ scene: z.string().trim().min(1).max(100) }).parse(req.body)
          .scene,
      ),
    ),
  ),
);
app.post(
  "/api/runs/:id/dialog",
  route(async (req, res) => {
    const input = z
      .object({
        accepted: z.boolean(),
        input: z.string().max(5000).default(""),
      })
      .parse(req.body);
    res.json(
      await answerDialog(req.params.id as string, input.accepted, input.input),
    );
  }),
);
app.post(
  "/api/runs/:id/archive",
  route((req, res) => {
    const run = requiredRun(req.params.id as string);
    if (["RECORDING", "PAUSED", "REPLAYING"].includes(run.status))
      throw new Error("活动任务无法归档。");
    const input = z.object({ archived: z.boolean().optional() }).parse(req.body || {});
    run.archived = input.archived ?? !run.archived;
    put("run", run);
    res.json(run);
  }),
);
app.delete(
  "/api/runs/:id",
  route((req, res) => {
    const id = req.params.id as string;
    if (activeRuns().some((run) => run.id === id))
      throw new Error("活动任务无法删除。");
    deleteArchivedRun(id);
    forgetReport(id);
    res.json({ ok: true });
  }),
);
app.get(
  "/api/runs/:id/report",
  route(async (req, res) => {
    const run = requiredRun(req.params.id as string);
    const buffer = await preparedReport(run);
    res.setHeader(
      "Content-Disposition",
      attachmentHeader(downloadName(run, "report"), `report-${run.id}.docx`),
    );
    res
      .type(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .send(buffer);
  }),
);
app.get(
  "/api/runs/:id/cases",
  route((req, res) => {
    const run = requiredRun(req.params.id as string);
    finalizeReport(run);
    res.setHeader(
      "Content-Disposition",
      attachmentHeader(downloadName(run, "html"), `cases-${run.id}.html`),
    );
    res.type("html").send(reportHtml(run));
  }),
);
app.get(
  "/api/runs/:id/cases.xlsx",
  route(async (req, res) => {
    const run = requiredRun(req.params.id as string);
    const buffer = await casesWorkbook(run);
    res.setHeader(
      "Content-Disposition",
      attachmentHeader(downloadName(run, "cases"), `cases-${run.id}.xlsx`),
    );
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(Buffer.from(buffer));
  }),
);
app.get("/api/flows", (_req, res) => res.json(list<Flow>("flow")));
app.delete(
  "/api/flows/:id",
  route((req, res) => {
    const id = req.params.id as string;
    if (!get<Flow>("flow", id)) {
      res.status(404).json({ error: "流程不存在。" });
      return;
    }
    remove("flow", id);
    res.json({ ok: true });
  }),
);
app.get("/api/issues", (_req, res) =>
  res.json(
    list<Run>("run").flatMap((run) =>
      finalFindings(run)
        .filter((finding) => !finding.deleted)
        .map((finding) => ({
          ...finding,
          runId: run.id,
          runName: run.name,
          project: run.project,
          startedAt: run.startedAt,
        })),
    ),
  ),
);
app.put(
  "/api/issues/:runId/:findingId",
  route((req, res) => {
    const run = requiredRun(req.params.runId as string);
    const finding = [...run.findings, ...run.analysis.findings].find(
      (item) => item.id === req.params.findingId,
    );
    if (!finding || finding.deleted) {
      res.status(404).json({ error: "问题不存在。" });
      return;
    }
    const body = z
      .object({
        disposition: z.enum(["open", "investigating", "resolved"]),
        note: z.string().max(2000),
      })
      .parse(req.body);
    Object.assign(finding, body);
    put("run", run);
    res.json(finding);
  }),
);
app.delete(
  "/api/issues/:runId/:findingId",
  route((req, res) => {
    const run = requiredRun(req.params.runId as string);
    const finding = [...run.findings, ...run.analysis.findings].find(
      (item) => item.id === req.params.findingId,
    );
    if (!finding || finding.deleted) {
      res.status(404).json({ error: "问题不存在。" });
      return;
    }
    finding.deleted = true;
    put("run", run);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/runs/:id/flow",
  route((req, res) => {
    const run = requiredRun(req.params.id as string);
    if (["RECORDING", "PAUSED", "REPLAYING"].includes(run.status))
      throw new Error("请先停止录制。");
    if (!run.operations.length) throw new Error("本次没有可保存的操作。");
    const name = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(req.body).name;
    const flow: Flow = {
      id: randomUUID(),
      name,
      project: run.project,
      url: run.url,
      version: 1,
      sourceRunId: run.id,
      viewport: run.viewport,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operations: structuredClone(run.operations),
      variables: [
        ...new Set(
          run.operations.flatMap((o) => (o.variable ? [o.variable] : [])),
        ),
      ],
    };
    put("flow", flow);
    put("flowVersion", { ...flow, id: `${flow.id}@1` });
    res.status(201).json(flow);
  }),
);
const locatorSchema = z.object({
  kind: z.enum(["testId", "role", "label", "css", "xpath", "text", "placeholder"]),
  value: z.string().min(1).max(2000),
  name: z.string().optional(),
});
const operationSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  pageId: z.string(),
  openerPageId: z.string().optional(),
  navigationMode: z.enum(["navigate", "observe"]).optional(),
  framePath: z.array(z.string()),
  timestamp: z.string(),
  kind: z.enum([
    "goto",
    "click",
    "hover",
    "fill",
    "press",
    "check",
    "select",
    "scroll",
    "assert",
    "upload",
    "dialog",
  ]),
  label: z.string().max(500),
  module: z.string().max(500),
  scene: z.string().min(1).max(100),
  url: z.string(),
  locators: z.array(locatorSchema),
  value: z.string().optional(),
  variable: z.string().regex(/^\w+$/).optional(),
  key: z.string().optional(),
  checked: z.boolean().optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  scroll: z.object({ x: z.number(), y: z.number() }).optional(),
  hoverPosition: z
    .object({ x: z.number().nonnegative(), y: z.number().nonnegative() })
    .optional(),
  clickPosition: z
    .object({ x: z.number().nonnegative(), y: z.number().nonnegative() })
    .optional(),
  clickButton: z.enum(["left", "middle", "right"]).optional(),
  clickModifiers: z
    .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
    .optional(),
  status: z.enum([
    "RECORDED",
    "PASSED",
    "EXECUTED",
    "FAILED",
    "BLOCKED",
    "SKIPPED",
  ]),
  dependsOn: z.array(z.string()),
  timeout: z.number().min(500).max(60000),
  assertion: z.string().max(3000).optional(),
  effect: z.enum(["read", "write"]),
  enabled: z.boolean(),
});
app.put(
  "/api/flows/:id",
  route((req, res) => {
    const flow = get<Flow>("flow", req.params.id as string);
    if (!flow) throw new Error("流程不存在。");
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        version: z.number(),
        operations: z.array(operationSchema).max(2000),
      })
      .parse(req.body);
    if (body.version !== flow.version) {
      res.status(409).json({ error: "流程已更新，请刷新后重试。" });
      return;
    }
    const ids = new Set<string>();
    for (const op of body.operations) {
      if (ids.has(op.id) || op.dependsOn.some((id) => !ids.has(id)))
        throw new Error("步骤 ID 必须唯一，且依赖必须指向前面的步骤。");
      ids.add(op.id);
    }
    flow.name = body.name;
    flow.operations = body.operations as Operation[];
    flow.version++;
    flow.updatedAt = new Date().toISOString();
    flow.variables = [
      ...new Set(
        flow.operations
          .flatMap((o) => (o.variable ? [o.variable] : []))
          .concat(
            flow.operations.flatMap((o) =>
              [
                ...`${o.value || ""} ${o.assertion || ""}`.matchAll(
                  /\{\{(\w+)\}\}/g,
                ),
              ].map((m) => m[1]),
            ),
          ),
      ),
    ];
    put("flow", flow);
    put("flowVersion", { ...flow, id: `${flow.id}@${flow.version}` });
    res.json(flow);
  }),
);
app.post(
  "/api/flows/:id/replay",
  route(async (req, res) => {
    const flow = get<Flow>("flow", req.params.id as string);
    if (!flow) throw new Error("流程不存在。");
    const input = z
      .object({
        name: z.string().min(1).max(100).optional(),
        environment: z.string().max(100).default("测试环境"),
        variables: z.record(z.string(), z.string()).default({}),
        headless: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(
      await startSession({
        name: input.name || `${flow.name} · 复检`,
        project: flow.project,
        environment: input.environment,
        url: flow.url,
        flow,
        variables: input.variables,
        headless: input.headless,
      }),
    );
  }),
);
app.get("/api/settings/models", (_req, res) =>
  res.json(list<ModelProfile>("model").map(publicProfile)),
);
app.delete(
  "/api/settings/models/:id",
  route((req, res) => {
    const id = req.params.id as string;
    if (!get<ModelProfile>("model", id)) {
      res.status(404).json({ error: "模型配置不存在。" });
      return;
    }
    remove("model", id);
    res.json({ ok: true });
  }),
);
const modelSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  provider: z.enum(["DeepSeek", "Qwen", "GLM", "Custom"]),
  baseUrl: urlSchema,
  model: z.string().trim().min(1).max(150),
  apiKey: z.string().max(2000).optional(),
  enabled: z.boolean(),
  timeout: z.number().min(5).max(300),
  maxTokens: z.number().min(100).max(32000),
  thinking: z.boolean().optional(),
  aiSynthesis: z.boolean().optional(),
});
app.post(
  "/api/settings/models",
  route((req, res) => {
    const body = modelSchema.parse(req.body);
    const existing = body.id ? get<ModelProfile>("model", body.id) : undefined;
    const profile: ModelProfile = {
      ...body,
      id: body.id || randomUUID(),
      apiKey: body.apiKey ? encrypt(body.apiKey) : existing?.apiKey,
    };
    put("model", profile);
    res.json(publicProfile(profile));
  }),
);
app.post(
  "/api/settings/models/:id/test",
  route(async (req, res) => {
    const profile = get<ModelProfile>("model", req.params.id as string);
    if (!profile) throw new Error("模型配置不存在。");
    const started = Date.now();
    const result = await callModel(profile, [
      { role: "user", content: "连接测试：请仅回复 OK。" },
    ]);
    res.json({
      ok: true,
      duration: Date.now() - started,
      message: result.content.slice(0, 100),
    });
  }),
);
app.post(
  "/api/runs/:id/analyze",
  route(async (req, res) =>
    res.json(
      await analyze(
        requiredRun(req.params.id as string),
        z.object({ profileId: z.string() }).parse(req.body).profileId,
      ),
    ),
  ),
);
app.post(
  "/api/runs/:id/analysis/cancel",
  route(async (req, res) => {
    requiredRun(req.params.id as string);
    res.json(await cancelAnalysis(req.params.id as string));
  }),
);
app.use(
  "/artifacts",
  express.static(resolve(dataRoot, "artifacts"), {
    dotfiles: "deny",
    index: false,
  }),
);
if (existsSync(resolve("dist/index.html"))) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error instanceof z.ZodError ? 400 : 422).json({
      error:
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("；")
          : error instanceof Error
            ? error.message
            : "请求失败。",
    });
  },
);
app.listen(port, "127.0.0.1", () =>
  console.log(
    `巡检台 API: http://127.0.0.1:${port}`,
  ),
);
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  await Promise.allSettled(
    activeRuns().map((r) => stopSession(r.id, "服务关闭，复检中断。")),
  );
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

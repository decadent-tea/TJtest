import { finalFindings } from "./evidence-quality";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { Run, Flow, ModelProfile, Summary } from "../shared/types";
export const dataRoot = resolve(process.env.STUDIO_DATA_DIR || "data");
mkdirSync(resolve(dataRoot, "artifacts"), { recursive: true });
const db = new DatabaseSync(resolve(dataRoot, "studio.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));",
);
export function put<T extends { id: string }>(kind: string, value: T) {
  db.prepare(
    "INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
  ).run(kind, value.id, JSON.stringify(value));
  return value;
}
export function get<T>(kind: string, id: string): T | undefined {
  const row = db
    .prepare("SELECT payload FROM records WHERE kind=? AND id=?")
    .get(kind, id) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : undefined;
}
export function list<T>(kind: string): T[] {
  return (
    db
      .prepare("SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind) as { payload: string }[]
  ).map((row) => JSON.parse(row.payload));
}
export function remove(kind: string, id: string) {
  return (
    db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id)
      .changes > 0
  );
}
export function deleteArchivedRun(id: string) {
  const run = get<Run>("run", id);
  if (!run) throw new Error("记录不存在。");
  if (
    ["RECORDING", "PAUSED", "REPLAYING"].includes(run.status) ||
    run.analysis.status === "RUNNING"
  )
    throw new Error("请先停止体检和模型分析，再删除记录。");
  if (!run.archived) throw new Error("请先归档，再彻底删除记录。");
  const root = resolve(dataRoot, "artifacts");
  const directory = resolve(root, id);
  if (!/^[a-zA-Z0-9-]+$/.test(id) || dirname(directory) !== root)
    throw new Error("记录文件路径无效。");
  rmSync(directory, { recursive: true, force: true });
  db.exec("BEGIN");
  try {
    for (const job of list<{ id: string; runId?: string }>("analysis-job")) {
      if (job.runId === id || job.id === run.analysis.jobId)
        remove("analysis-job", job.id);
    }
    remove("run", id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function summary(run: Run): Summary {
  return {
    id: run.id,
    name: run.name,
    project: run.project,
    environment: run.environment,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    operationCount: run.operations.length,
    requestCount: run.requests.length,
    issueCount: finalFindings(run).length,
    archived: run.archived,
    analysisStatus: run.analysis.status,
  };
}
const keyPath = resolve(dataRoot, ".encryption-key");
if (!existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
const masterKey = readFileSync(keyPath);
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body.toString("hex")}`;
}
export function decrypt(value: string) {
  const [iv, tag, body] = value.split(":");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export function publicProfile(profile: ModelProfile) {
  const { apiKey, ...rest } = profile;
  return { ...rest, hasKey: !!apiKey };
}
export function recoverInterrupted() {
  for (const run of list<Run>("run")) {
    let changed = false;
    if (["RECORDING", "PAUSED", "REPLAYING"].includes(run.status)) {
      if (run.mode === "replay") {
        const running = [...run.operations]
          .reverse()
          .find((op) => op.status === "RUNNING");
        const location =
          running ||
          [...run.operations]
            .reverse()
            .find((op) => op.status !== "BLOCKED" && op.status !== "SKIPPED");
        run.interruption = {
          reason: "服务重启导致复检中断。",
          at: new Date().toISOString(),
          stepId: location?.id,
          sequence: location?.sequence,
          label: location?.label,
        };
        if (running) {
          running.status = "FAILED";
          running.error = run.interruption.reason;
        }
      }
      run.status = "INTERRUPTED";
      run.endedAt = new Date().toISOString();
      run.notes.push("服务重启导致执行中断；已保存证据可继续查看。");
      changed = true;
    }
    if (run.analysis.status === "RUNNING") {
      run.analysis.status = "FAILED";
      run.analysis.error =
        "服务重启，分析中断。已完成批次保留，使用相同模型配置重新分析可继续未完成证据。";
      changed = true;
    }
    if (changed) put("run", run);
  }
}
export type { Run, Flow, ModelProfile };

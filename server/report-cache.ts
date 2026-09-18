import { createHash } from "node:crypto";
import type { Run } from "../shared/types";
import { reportDocx } from "./report-docx";

const cached = new Map<string, { digest: string; task: Promise<Buffer> }>();
const warmed = new Map<string, string>();
const reportDigest = (run: Run) =>
  createHash("sha256").update(JSON.stringify(run)).digest("hex");

// Keep one generation per report version. Reading a completed record starts it
// before the user clicks Download; the download route can await the same task.
export function preparedReport(run: Run): Promise<Buffer> {
  const digest = reportDigest(run);
  const previous = cached.get(run.id);
  if (previous?.digest === digest) return previous.task;
  const task = reportDocx(structuredClone(run)).catch((error) => {
    if (cached.get(run.id)?.task === task) cached.delete(run.id);
    throw error;
  });
  cached.set(run.id, { digest, task });
  return task;
}

export function prewarmReport(run: Run) {
  const digest = reportDigest(run);
  if (warmed.get(run.id) === digest) return;
  warmed.set(run.id, digest);
  void preparedReport(run).catch((error) =>
    console.error("报告预生成失败：", error),
  );
}

export function forgetReport(id: string) {
  cached.delete(id);
  warmed.delete(id);
}

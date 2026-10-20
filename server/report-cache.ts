import { createHash } from "node:crypto";
import type { Run } from "../shared/types";
import { reportDocx } from "./report-docx";

const cached = new Map<string, { digest: string; task: Promise<Buffer> }>();
const reportDigest = (run: Run) =>
  createHash("sha256").update(JSON.stringify(run)).digest("hex");

// Generate on download and share the same promise for repeated clicks.
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

export function forgetReport(id: string) {
  cached.delete(id);
}

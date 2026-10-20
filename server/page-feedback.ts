import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Run, PageFeedback } from "../shared/types";
import { redactText, redactFeedbackUrl } from "./redact";

const schema = z.object({
  kind: z.enum(["message", "dialog", "url", "title", "loading", "empty"]),
  change: z.enum(["appeared", "changed", "disappeared", "initial"]),
  timestamp: z.string(),
  eventId: z.string().max(100),
  text: z.string().max(5000).optional(),
  before: z.string().max(10000).optional(),
  after: z.string().max(10000).optional(),
  target: z.string().max(1000).optional(),
  level: z.enum(["error", "success", "warning", "info", "unknown"]).optional(),
  truncated: z.boolean().optional(),
});
const seen = new WeakMap<Run, Set<string>>();
const grouped = new WeakMap<Run, Map<string, PageFeedback>>();
export function captureFeedback(
  run: Run,
  value: unknown,
  context: { pageId: string; framePath: string[]; candidateStepIds: string[] },
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return;
  const data = parsed.data;
  if (!Number.isFinite(Date.parse(data.timestamp))) return;
  const s = (run.feedbackCapture ??= { events: 0, discarded: 0, truncated: 0 });
  const emitted = seen.get(run) || new Set<string>();
  seen.set(run, emitted);
  const sourceId = `${context.pageId}|${context.framePath.join("/")}|${data.eventId}`;
  if (emitted.has(sourceId)) return;
  if (s.events >= 5000) {
    s.discarded++;
    if (
      !run.notes.includes(
        "页面反馈达到采集上限，超限部分未保存，不代表全量覆盖。",
      )
    )
      run.notes.push("页面反馈达到采集上限，超限部分未保存，不代表全量覆盖。");
    return;
  }
  emitted.add(sourceId);
  let truncated = !!data.truncated;
  const clip = (v: string | undefined, n: number, url = false) => {
    if (v === undefined) return undefined;
    const safe = url ? redactFeedbackUrl(v) : redactText(v);
    if (safe.length > n) truncated = true;
    return safe.slice(0, n);
  };
  const text = clip(data.text, 500),
    before = clip(
      data.before,
      data.kind === "url" ? 1000 : 200,
      data.kind === "url",
    ),
    after = clip(
      data.after,
      data.kind === "url" ? 1000 : 200,
      data.kind === "url",
    );
  if ((data.kind === "url" || data.kind === "title") && before === after)
    return;
  if (data.kind === "message" && !text) return;
  const candidates = [
    ...new Set(
      context.candidateStepIds.filter((id) =>
        run.operations.some(
          (o) =>
            o.id === id &&
            o.pageId === context.pageId &&
            !["BLOCKED", "SKIPPED"].includes(o.status),
        ),
      ),
    ),
  ];
  const item: PageFeedback = {
    id: randomUUID(),
    timestamp: data.timestamp,
    pageId: context.pageId,
    framePath: context.framePath,
    stepId: candidates.length === 1 ? candidates[0] : undefined,
    candidateStepIds: candidates.length > 1 ? candidates : undefined,
    association:
      candidates.length === 1
        ? "time-candidate"
        : candidates.length > 1
          ? "ambiguous"
          : "page",
    kind: data.kind,
    change: data.change,
    level: data.level,
    text,
    before,
    after,
    target: clip(data.target, 200),
    truncated: truncated || undefined,
  };
  const key = JSON.stringify([
    item.pageId,
    item.framePath,
    item.stepId,
    item.candidateStepIds,
    item.kind,
    item.change,
    item.level,
    item.text,
    item.before,
    item.after,
    item.target,
  ]);
  const index = grouped.get(run) || new Map<string, PageFeedback>();
  grouped.set(run, index);
  const previous = index.get(key);
  if (!previous && (run.feedback?.length || 0) >= 2000) {
    s.discarded++;
    const note = "页面反馈达到采集上限，超限部分未保存，不代表全量覆盖。";
    if (!run.notes.includes(note)) run.notes.push(note);
    return;
  }
  s.events++;
  if (truncated) s.truncated++;
  if (previous) {
    previous.truncated ||= item.truncated;
    previous.occurrences = (previous.occurrences || 1) + 1;
    previous.lastSeen = [
      previous.lastSeen || previous.timestamp,
      item.timestamp,
    ]
      .sort()
      .at(-1);
    previous.timestamp = [previous.timestamp, item.timestamp].sort()[0];
  } else {
    (run.feedback ??= []).push(item);
    index.set(key, item);
  }
  return previous || item;
}

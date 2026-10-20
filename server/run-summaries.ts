import type { Run, Summary } from "../shared/types";
import { list, storeVersion, summary } from "./store";
import { activeRuns, readRun } from "./recorder";
import { finalizeReport } from "./report";

let cached: { version: string; values: Summary[] } | undefined;
export function runSummaries() {
  const live = new Set(activeRuns().map((run) => run.id));
  const version = storeVersion("run");
  if (!live.size && cached?.version === version) return cached.values;
  const values = list<Run>("run").map((stored) => {
    const running = live.has(stored.id) ? readRun(stored.id) : undefined;
    if (running) return summary(running);
    finalizeReport(stored);
    return summary(stored);
  });
  // Running sessions can change before their next database flush.
  if (!live.size) cached = { version, values };
  return values;
}

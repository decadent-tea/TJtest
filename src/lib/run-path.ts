import type { Run } from "../../shared/types";

// A replay stores blocked/skipped planned steps for diagnosis, but those
// steps were never attempted in the browser and do not belong to its path.
export function actualOperations(run: Run) {
  return run.operations.filter((op) => {
    if (run.mode === "record") return true;
    if (op.status === "BLOCKED" || op.status === "SKIPPED") return false;
    // Older interrupted runs wrote EXECUTED before starting the action.
    if (op.status === "EXECUTED" && op.duration === undefined) return false;
    return true;
  });
}

// Explicit opt-in verification against a saved flow. Credentials come from stdin.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Flow, Run } from "../shared/types";

const flowId = process.argv[2];
assert(flowId, "请指定已保存的流程 ID，并通过标准输入提供运行变量 JSON。");
const repeat = Number(process.argv[3] || 1);
assert(Number.isInteger(repeat) && repeat >= 1 && repeat <= 10);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const variables = JSON.parse(input || "{}");
const base = process.env.STUDIO_API_URL || "http://127.0.0.1:4318";
const directory = resolve(
  "output",
  "verification-live",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(directory, { recursive: true });
let activeId: string | undefined;
try {
  for (let iteration = 1; iteration <= repeat; iteration++) {
    const flows = (await fetch(`${base}/api/flows`).then((r) =>
      r.json(),
    )) as Flow[];
    const flow = flows.find((f) => f.id === flowId);
    assert(flow, "流程不存在");
    const response = await fetch(
      `${base}/api/flows/${encodeURIComponent(flowId)}/replay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variables,
          environment: "测试环境 · 稳定性验证",
          headless: false,
        }),
      },
    );
    assert(response.ok, `无法启动复检：HTTP ${response.status}`);
    let run: Run = (await response.json()) as Run;
    activeId = run.id;
    console.log(`第 ${iteration} 次真实复检已开始：${run.id}`);
    const deadline = Date.now() + 15 * 60_000;
    let progress = "";
    while (run.status === "REPLAYING") {
      assert(Date.now() < deadline, "真实复检超过 15 分钟上限");
      await new Promise((r) => setTimeout(r, 1500));
      run = (await fetch(`${base}/api/runs/${run.id}`).then((r) =>
        r.json(),
      )) as Run;
      const step = run.operations.at(-1);
      const current = `${step?.sequence} ${step?.kind} ${step?.status}`;
      if (current !== progress) {
        console.log(current);
        progress = current;
      }
    }
    activeId = undefined;
    const failures = run.operations.filter((o) =>
      ["FAILED", "BLOCKED"].includes(o.status),
    );
    const summary = {
      id: run.id,
      status: run.status,
      count: run.operations.length,
      failures: failures.map((o) => ({
        sequence: o.sequence,
        label: o.label,
        error: o.error,
        screenshot: o.screenshot,
      })),
      steps: run.operations.map((o) => ({
        sequence: o.sequence,
        kind: o.kind,
        status: o.status,
        duration: o.duration,
      })),
    };
    writeFileSync(
      resolve(directory, `run-${iteration}.json`),
      JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify(summary.failures));
    console.log(
      `第 ${iteration} 次：${run.status}，${summary.count} 步，${failures.length} 个失败或阻塞。`,
    );
    assert.notEqual(run.status, "INTERRUPTED");
    assert.equal(failures.length, 0, `查看 ${directory} 和体检记录中的证据。`);
    assert.equal(
      run.operations.length,
      flow.operations.length,
      "必须执行完整流程",
    );
    assert(
      run.operations.every((o) =>
        o.enabled
          ? ["EXECUTED", "PASSED"].includes(o.status)
          : o.status === "SKIPPED",
      ),
    );
  }
} finally {
  if (activeId)
    await fetch(`${base}/api/runs/${activeId}/stop`, { method: "POST" }).catch(
      () => {},
    );
  console.log(`验证结果：${directory}`);
}

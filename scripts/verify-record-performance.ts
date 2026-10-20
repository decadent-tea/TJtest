import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { reportDetailFixture } from "./fixtures/report-detail";
process.env.STUDIO_DATA_DIR = resolve(
  "output/verification-record-performance",
  randomUUID(),
);
const { put, remove, dataRoot } = await import("../server/store");
const { runSummaries } = await import("../server/run-summaries");
const run = reportDetailFixture(true);
put("run", run);
const initial = runSummaries();
assert.equal(initial.length, 1);
assert.equal(initial[0].issueCount, 1);
assert.equal(runSummaries(), initial, "没有数据变化时复用已整理的摘要");
run.name = "修改后的记录";
put("run", run);
const updated = runSummaries();
assert.notEqual(updated, initial, "保存后摘要自动失效");
assert.equal(updated[0].name, run.name);
const other = new DatabaseSync(resolve(dataRoot, "studio.sqlite"));
run.name = "其他连接更新的记录";
other
  .prepare("UPDATE records SET payload=? WHERE kind='run' AND id=?")
  .run(JSON.stringify(run), run.id);
assert.equal(
  runSummaries()[0].name,
  run.name,
  "其他连接提交后也不能返回旧摘要",
);
other.close();
remove("run", run.id);
assert.deepEqual(runSummaries(), [], "删除记录后不残留缓存摘要");
console.log(
  "记录摘要复用验证通过：未变化时复用，保存、外部数据库提交与删除后自动更新；无真实数据库写入。",
);

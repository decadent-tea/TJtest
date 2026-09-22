import assert from "node:assert/strict";
import { ReplayNetwork } from "../server/replay-network";

function cycle(
  network: ReplayNetwork<string>,
  key: string,
  at: number,
  options: {
    step?: string;
    method?: string;
    success?: boolean;
  } = {},
) {
  network.start(
    key,
    "page-1",
    options.step || "step-1",
    options.method || "GET",
    "/data",
    at,
  );
  network.finish(key, options.success ?? true, at + 50);
}
const network = new ReplayNetwork<string>();
cycle(network, "a", 1000);
cycle(network, "b", 2000);
network.start("c", "page-1", "step-1", "GET", "/data", 3000);
assert.equal(network.state("page-1").pending, 0);
assert.equal(network.state("page-1").polling, 1);
network.start("slow", "page-1", "step-1", "GET", "/query", 3050);
assert.deepEqual(network.state("page-1").urls, ["/query"]);
network.start("new-action", "page-1", "step-2", "GET", "/data", 3100);
assert.equal(
  network.state("page-1").pending,
  2,
  "new action's first read must block",
);
network.start("tab", "page-2", "step-1", "GET", "/data", 3150);
assert.equal(
  network.state("page-2").pending,
  1,
  "polling must not leak between tabs",
);
network.navigated("page-1", "step-2");
assert.deepEqual(
  network.state("page-1").urls,
  ["/data"],
  "navigation keeps current action requests",
);
network.clearPage("page-1");
assert.equal(network.state("page-1").pending, 0);
assert.equal(network.state("page-2").pending, 1);
for (const options of [{ method: "POST" }, { success: false }]) {
  const strict = new ReplayNetwork<string>();
  cycle(strict, "a", 1000, options);
  cycle(strict, "b", 2000, options);
  strict.start("c", "page-1", "step-1", options.method || "GET", "/data", 3000);
  assert.equal(
    strict.state("page-1").pending,
    1,
    "writes and failing reads must block",
  );
}
const searches = new ReplayNetwork<string>();
cycle(searches, "a", 1000, { step: "search-1" });
cycle(searches, "b", 2000, { step: "search-2" });
searches.start("c", "page-1", "search-3", "GET", "/data", 3000);
assert.equal(searches.state("page-1").pending, 1);
const fanout = new ReplayNetwork<string>();
cycle(fanout, "a", 1000);
cycle(fanout, "b", 1010);
fanout.start("c", "page-1", "step-1", "GET", "/data", 1020);
assert.equal(fanout.state("page-1").pending, 1);
console.log(
  "复检等待策略：周期读取、慢请求、写入、失败读取、并发请求、重复查询、跨页隔离通过。",
);

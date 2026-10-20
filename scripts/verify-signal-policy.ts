import assert from "node:assert/strict";
import { reportDetailFixture } from "./fixtures/report-detail";
import { finalizeReport } from "../server/report";
import { finalFindings, requestProblem } from "../server/evidence-quality";
import { groundFinding } from "../server/evidence-grounding";
import { reportContent } from "../shared/report-content";
import { prepareEvidence } from "../server/ai-evidence";
import {
  findingPossibleCause,
  requestPossibleCause,
} from "../shared/finding-cause";
import type { Finding, NetworkCall, Run } from "../shared/types";

const base = () => {
  const run = reportDetailFixture(true);
  run.operations = run.operations.filter((op) => op.sequence === 42);
  run.requests = [run.requests[0]];
  run.logs = [];
  run.feedback = [];
  run.findings = [];
  run.cases = [];
  run.analysis = { status: "NONE", findings: [] };
  return run;
};
const paragraphs = (run: Run) =>
  reportContent(run)
    .map((block) => JSON.stringify(block))
    .join("\n");
const diagnosis = {
  title: "查询图纸接口失败，应核查服务端处理",
  module: "首页-GIS公共服务系统",
  severity: "high" as const,
  confidence: "high" as const,
  category: "interface" as const,
  detail: "接口已失败，无需控制台共同报错才能收录。",
  impact: "图纸详情请求未取得正常结果，可能影响该步骤的数据展示。",
  possibleCause: "优先核查服务端处理与依赖，具体异常位置可结合日志进一步定位。",
  suggestion: "按请求时间和图纸编号检查服务端异常分支，并重试同一接口。",
};

for (const scenario of [
  {
    name: "HTTP500无控制台",
    status: 500,
    responseBody: "",
    owners: ["backend"],
  },
  {
    name: "HTTP503无控制台",
    status: 503,
    responseBody: "",
    owners: ["backend"],
  },
  {
    name: "HTTP400参数错误",
    status: 400,
    responseBody: '{"msg":"参数错误"}',
    owners: ["frontend", "backend"],
  },
  {
    name: "HTTP200业务失败标记",
    status: 200,
    responseBody: '{"success":false,"msg":"操作失败"}',
    owners: ["backend"],
  },
  {
    name: "只有业务失败提示",
    status: 200,
    responseBody: '{"code":500,"msg":"系统异常"}',
    owners: ["backend"],
  },
  {
    name: "只有文本失败提示",
    status: 200,
    responseBody: '{"message":"保存失败，请重试"}',
    owners: ["backend"],
  },
  {
    name: "字符串业务失败状态",
    status: 200,
    responseBody: '{"status":"error","message":"dependency unavailable"}',
    owners: ["backend"],
  },
]) {
  const run = base();
  Object.assign(run.requests[0], scenario);
  finalizeReport(run);
  let findings = finalFindings(run);
  assert.equal(findings.length, 1, `${scenario.name}可单独形成问题`);
  assert.deepEqual(findings[0].owners, scenario.owners);
  assert.equal(
    findings[0].confidence,
    "high",
    "异常现象的置信度不因根因未知降低",
  );
  assert(
    findings[0].impact && findings[0].suggestion && findings[0].possibleCause,
  );
  assert(!paragraphs(run).includes("历史AI分析未经过"));
  if (requestProblem(run.requests[0])?.includes("提示")) {
    assert(findings[0].impact?.includes("响应包含失败提示"));
    assert(
      !findings[0].impact?.includes("返回明确的业务失败标记"),
      "纯提示不改写为未采集的失败布尔字段",
    );
  }
  assert(
    run.cases.every((item) => item.status !== "PASSED"),
    "发现异常与业务通过判定分开",
  );
  assert(
    prepareEvidence(run).items.find((item) => item.kind === "request")?.data
      .response !== undefined || !scenario.responseBody,
  );
  const checked = groundFinding(run, {
    ...diagnosis,
    evidenceIds: [run.requests[0].id],
  })!;
  assert(checked, scenario.name);
  assert.equal(checked.title, diagnosis.title);
  assert.equal(checked.confidence, "high");
  assert.equal(checked.possibleCause, diagnosis.possibleCause);
  run.analysis = {
    status: "COMPLETED",
    evidenceVersion: 2,
    findings: [{ ...checked, id: "single-ai", source: "ai" }],
  };
  findings = finalFindings(run);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, diagnosis.title);
  assert(paragraphs(run).includes(diagnosis.possibleCause));
  run.analysis.findings[0].owners = ["implementation"];
  run.analysis.findings[0].ownershipSource = "manual";
  assert.deepEqual(
    finalFindings(run)[0].owners,
    ["implementation"],
    "人工归属优先于默认排查方向",
  );
}
const network = base();
network.requests[0].status = undefined;
network.requests[0].failure = "net::ERR_CONNECTION_REFUSED";
finalizeReport(network);
assert.equal(finalFindings(network).length, 1, "网络失败不要求控制台佐证");
const unlinked = base();
unlinked.requests[0].status = 500;
unlinked.requests[0].stepId = undefined;
unlinked.operations = [];
finalizeReport(unlinked);
assert.equal(finalFindings(unlinked).length, 1, "未关联按钮仍保留真实接口失败");

const requestTemplate = base().requests[0];
for (const body of [
  '{"code":0,"data":[]}',
  '{"code":500,"data":[]}',
  '{"success":true,"msg":"查询成功，失败数量为0"}',
  '{"data":{"success":false}}',
]) {
  const request: NetworkCall = {
    ...requestTemplate,
    responseBody: body,
    status: 200,
  };
  assert.equal(
    requestProblem(request),
    undefined,
    "不按未知业务码或数据内字段猜测失败",
  );
}

for (const severity of ["high", "medium", "low"] as const) {
  for (const category of [
    "interface",
    "functional",
    "frontend",
    "stability",
    undefined,
  ] as const) {
    const run = base();
    run.requests[0].responseBody = '{"success":true,"message":"ok"}';
    const before = JSON.stringify(run);
    for (const title of [
      "查询接口返回HTTP 500，服务不可用",
      "查询接口失败，整个系统不可用",
    ])
      assert.equal(
        groundFinding(run, {
          ...diagnosis,
          title,
          severity,
          category,
          impact: "整个系统已不可用。",
          evidenceIds: [run.operations[0].id, run.requests[0].id],
        }),
        undefined,
        "正常请求和操作ID不能支持接口故障，不因模型级别或分类而放行",
      );
    assert.equal(JSON.stringify(run), before, "拒绝误报不修改原始记录");
  }
}

for (const patch of [
  { responseBody: '{"code":500,"data":[]}' },
  { responseBody: undefined, bodyState: "unavailable" as const },
  { completion: "pending" as const, bodyState: "unavailable" as const },
  { completion: "stopped" as const, bodyState: "unavailable" as const },
]) {
  const run = base();
  Object.assign(run.requests[0], { responseBody: undefined }, patch);
  assert.equal(
    groundFinding(run, {
      ...diagnosis,
      evidenceIds: [run.requests[0].id],
    }),
    undefined,
    "未知业务码、正文缺失和未结束请求只说明证据受限，不能支持故障结论",
  );
}

for (const current of [false, true]) {
  const run = base();
  run.requests[0].responseBody = '{"success":true,"message":"ok"}';
  run.analysis = {
    status: "COMPLETED",
    ...(current ? { evidenceVersion: 2 } : {}),
    findings: [
      {
        ...diagnosis,
        id: "unsupported-ai",
        source: "ai",
        severity: "medium",
        title: "查询接口返回HTTP 500，服务不可用",
        impact: "整个系统已不可用。",
        evidenceIds: [run.requests[0].id],
      },
    ],
  };
  finalizeReport(run);
  assert.equal(finalFindings(run).length, 0, "历史与新版分析都需重新校验误报");
  const text = paragraphs(run);
  assert(!text.includes("HTTP 500") && !text.includes("整个系统已不可用"));
  assert(text.includes("高风险 0 项、中风险 0 项、低风险 0 项"));
  assert(run.cases.every((item) => item.status !== "PASSED"));
}

for (const patch of [
  { status: 403, responseBody: "" },
  { status: 200, responseBody: '{"success":false,"message":"保存失败"}' },
  { status: 200, responseBody: '{"success":true}', duration: 11000 },
]) {
  const run = base();
  Object.assign(run.requests[0], patch);
  const unsupported: Finding = {
    ...diagnosis,
    id: "wrong-http-status",
    source: "ai",
    title: "查询接口返回HTTP 500",
    evidenceIds: [run.requests[0].id],
  };
  assert.equal(
    groundFinding(run, unsupported),
    undefined,
    "存在其他异常也不能支持未观察到的HTTP状态码",
  );
  assert.equal(
    groundFinding(run, {
      ...unsupported,
      title: diagnosis.title,
      impact: "HTTP 500导致本次查询失败。",
    }),
    undefined,
    "影响分析也不能将业务失败或其他HTTP错误改写为HTTP500",
  );
  run.analysis.findings = [unsupported];
  finalizeReport(run);
  const findings = finalFindings(run);
  assert.equal(findings.length, 1, "拒绝错误AI解释后仍保留真实规则异常");
  assert.equal(findings[0].source, "rule");
  assert(!paragraphs(run).includes("HTTP 500"));
}

const actualHttpFailure = base();
actualHttpFailure.requests[0].status = 500;
assert(
  groundFinding(actualHttpFailure, {
    ...diagnosis,
    title: "查询接口返回HTTP 500",
    evidenceIds: [actualHttpFailure.requests[0].id],
  }),
  "真实HTTP500仍允许AI补充诊断",
);
const actualBusinessFailure = base();
actualBusinessFailure.requests[0].responseBody =
  '{"success":false,"code":500,"status":500,"message":"保存失败"}';
assert(
  groundFinding(actualBusinessFailure, {
    ...diagnosis,
    title: "接口业务状态500，保存失败",
    evidenceIds: [actualBusinessFailure.requests[0].id],
  }),
  "业务状态码不是HTTP状态，真实业务失败仍保留",
);
const browserHttpFailure = base();
browserHttpFailure.requests = [];
browserHttpFailure.logs = [
  {
    id: "http-error-log",
    timestamp: browserHttpFailure.startedAt,
    pageId: "gis-page",
    level: "error",
    text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    location: "http://fixture.test/api/drawing",
  },
];
assert(
  groundFinding(browserHttpFailure, {
    ...diagnosis,
    title: "浏览器记录HTTP 500错误",
    evidenceIds: ["http-error-log"],
  }),
  "单条浏览器HTTP错误日志也能独立支持相应状态码",
);

const runtimeWithHealthyRequest = base();
runtimeWithHealthyRequest.requests[0].responseBody = '{"success":true}';
runtimeWithHealthyRequest.logs = [
  {
    id: "independent-runtime-error",
    timestamp: runtimeWithHealthyRequest.startedAt,
    pageId: "gis-page",
    stepId: runtimeWithHealthyRequest.operations[0].id,
    level: "pageerror",
    text: "TypeError: Cannot read properties of null (reading 'id')",
  },
];
assert.equal(
  groundFinding(runtimeWithHealthyRequest, {
    ...diagnosis,
    evidenceIds: [runtimeWithHealthyRequest.requests[0].id],
  }),
  undefined,
  "未被引用的浏览器异常不能为正常接口背书",
);
const runtimeFinding = groundFinding(runtimeWithHealthyRequest, {
  ...diagnosis,
  category: "frontend",
  title: "图纸查看出现空对象访问异常",
  evidenceIds: [
    runtimeWithHealthyRequest.requests[0].id,
    "independent-runtime-error",
  ],
});
assert(runtimeFinding, "正常HTTP响应不能抹掉真实浏览器异常");
assert.equal(runtimeFinding.confidence, "high");

for (const kind of ["message", "dialog"] as const) {
  const run = base();
  run.requests = [];
  run.feedback = [
    {
      id: "error-feedback",
      timestamp: run.startedAt,
      pageId: "gis-page",
      stepId: run.operations[0].id,
      framePath: [],
      association: "time-candidate",
      kind,
      change: "appeared",
      level: "error",
      text: "保存失败：服务暂不可用",
    },
  ];
  const checked = groundFinding(run, {
    ...diagnosis,
    category: "functional",
    title: "保存图纸时页面提示服务不可用",
    evidenceIds: ["error-feedback"],
  })!;
  assert(checked, "单条明确页面错误反馈可形成问题");
  assert.equal(checked.title, "保存图纸时页面提示服务不可用");
  assert.equal(
    checked.possibleCause,
    diagnosis.possibleCause,
    "不因缺少其他渠道而清空原因分析",
  );
  assert.equal(checked.impact, diagnosis.impact);
  assert.equal(checked.suggestion, diagnosis.suggestion);
  run.feedback[0].association = "ambiguous";
  const ambiguous = groundFinding(run, {
    ...diagnosis,
    evidenceIds: ["error-feedback"],
  })!;
  assert(
    ambiguous && ambiguous.confidence === "low",
    "关联不明确时保留问题并降低关联置信度",
  );
  run.requests = [{ ...requestTemplate, status: 500 }];
  assert.equal(
    groundFinding(run, {
      ...diagnosis,
      evidenceIds: [run.requests[0].id, "error-feedback"],
    })?.confidence,
    "high",
    "不确定的反馈关联不能否定已确认的接口失败",
  );
}
const warning = base();
warning.requests = [];
warning.logs = [
  {
    id: "warning",
    timestamp: warning.startedAt,
    pageId: "gis-page",
    stepId: warning.operations[0].id,
    level: "warn",
    text: "图纸事件监听器可能未释放",
  },
];
const weak = groundFinding(warning, {
  ...diagnosis,
  category: "frontend",
  title: "图纸查看可能重复绑定事件",
  evidenceIds: ["warning"],
})!;
assert(weak && weak.severity === "low");
assert(weak.title.includes("图纸查看可能重复绑定事件"));
assert.equal(
  weak.possibleCause,
  diagnosis.possibleCause,
  "弱线索保留具体分析供人工核查",
);
assert.equal(
  groundFinding(base(), { ...diagnosis, evidenceIds: ["does-not-exist"] }),
  undefined,
  "虚构引用仍拒绝",
);

for (const [patch, expected] of [
  [{ status: 403, responseBody: "" }, "角色权限"],
  [{ status: 404, responseBody: "" }, "路由"],
  [{ status: 500, responseBody: "" }, "未捕获异常"],
  [{ status: 502, responseBody: "" }, "上游"],
  [{ status: 503, responseBody: "" }, "健康实例"],
  [{ status: 504, responseBody: "" }, "超时"],
  [{ status: undefined, failure: "net::ERR_CONNECTION_REFUSED" }, "端口未监听"],
  [{ status: undefined, failure: "net::ERR_NAME_NOT_RESOLVED" }, "DNS"],
  [
    { status: 200, responseBody: '{"success":false,"msg":"参数错误"}' },
    "必填参数",
  ],
  [
    {
      status: 200,
      responseBody: '{"success":false,"msg":"图纸绑定记录不存在"}',
    },
    "绑定关系",
  ],
] as const) {
  const run = base();
  Object.assign(run.requests[0], patch);
  finalizeReport(run);
  const before = JSON.stringify(run);
  for (const possibleCause of [
    undefined,
    "",
    "证据不足",
    "证据不足，暂不判断根因。",
    "需核对该步骤的请求参数、用户权限、接口约定与服务端日志，现有记录不能确定唯一根因。",
  ]) {
    const checked = groundFinding(run, {
      ...diagnosis,
      possibleCause,
      evidenceIds: [run.requests[0].id],
    })!;
    assert(checked.possibleCause);
    assert(
      checked.possibleCause?.includes(expected),
      `根据${JSON.stringify(patch)}给出对应候选原因`,
    );
    assert(
      checked.possibleCause.includes("可能") ||
        checked.possibleCause.includes("怀疑"),
    );
    assert(!checked.possibleCause.includes("唯一根因"));
    assert(
      checked.detail.includes(checked.possibleCause),
      "持久化明细包含补全的分析",
    );
  }
  assert.equal(JSON.stringify(run), before, "补全分析不改写原始证据与状态");
}
const historical = base();
historical.requests[0].status = 403;
historical.requests[0].responseBody = "";
historical.analysis = {
  status: "COMPLETED",
  findings: [
    {
      ...diagnosis,
      id: "old-cause",
      source: "ai",
      evidenceIds: [historical.requests[0].id],
      possibleCause: "现有记录不能确定唯一根因。",
    },
  ],
};
finalizeReport(historical);
const historicalBefore = JSON.stringify(historical);
assert(finalFindings(historical)[0].possibleCause?.includes("角色权限"));
assert(
  paragraphs(historical).includes("角色权限"),
  "历史报告展示与导出同步补全",
);
assert(!paragraphs(historical).includes("不能确定唯一根因"));
assert.equal(JSON.stringify(historical), historicalBefore);
const usefulCause =
  "现有记录不能确定唯一根因，可能是图纸绑定失效或用户授权范围不匹配。";
assert.equal(
  findingPossibleCause(historical, {
    evidenceIds: [historical.requests[0].id],
    possibleCause: usefulCause,
  }),
  usefulCause,
  "保留包含不确定性但已有具体推测的分析",
);
const frontend = base();
frontend.requests = [];
frontend.logs = [
  {
    id: "null-error",
    timestamp: frontend.startedAt,
    pageId: "gis-page",
    level: "pageerror",
    text: "TypeError: Cannot read properties of null (reading 'id')",
  },
];
assert(
  findingPossibleCause(frontend, { evidenceIds: ["null-error"] }).includes(
    "尚未准备完成",
  ),
);
frontend.logs[0].level = "unhandledrejection";
frontend.logs[0].text = "Error: 操作失败";
assert(
  findingPossibleCause(frontend, { evidenceIds: ["null-error"] }).includes(
    ".catch",
  ),
);
frontend.logs[0].level = "warn";
frontend.logs[0].text = "未知警告";
assert(
  findingPossibleCause(frontend, { evidenceIds: ["null-error"] }).includes(
    "暂无法",
  ),
  "确实缺少线索时允许说明无法分析",
);
assert(
  findingPossibleCause(frontend, { evidenceIds: ["does-not-exist"] }).includes(
    "暂无法",
  ),
  "不使用无关证据编造原因",
);
const healthy = {
  ...base().requests[0],
  status: 200,
  responseBody: '{"success":true,"data":{"message":"数据库异常"}}',
};
assert.equal(
  requestPossibleCause(healthy),
  undefined,
  "不从成功数据内容推断故障",
);
assert(
  requestPossibleCause({
    ...healthy,
    responseBody: '{"success":false}',
    duration: 20000,
  })?.includes("业务前置条件"),
  "同时存在业务失败和耗时时，先解释业务失败",
);
console.log(
  "异常收录与原因分析验证通过：独立失败可收录、候选原因按错误线索补全、旧版空泛分析同步更新、具体AI推测保留、无头绪时说明缺失信息、正常响应与虚构证据不推断故障。",
);

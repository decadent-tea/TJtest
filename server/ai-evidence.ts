import {
  countOf,
  isSuccessfulStaticAsset,
  isStaticAssetUrl,
  requestProblem,
} from "./evidence-quality";
import type { Run, ModelProfile, Analysis } from "../shared/types";
import { createHash } from "node:crypto";
import {
  isExcludedRequest,
  isExcludedResourceLog,
  requestStats,
  requestFact,
  semanticIdentity,
  responseMarkers,
  operationEvidence,
  evidenceCoverage,
  feedbackForStep,
} from "../shared/inspection-evidence";

// Budgets apply to individual calls, never to the length of a recording.
export const INPUT_CHAR_BUDGET = 24000;
export type EvidenceItem = {
  key: string;
  kind: "step" | "request" | "log" | "context" | "page" | "feedback";
  timestamp: string;
  members: string[];
  data: Record<string, unknown> & { id: string };
};
export function prepareEvidence(run: Run) {
  let truncatedFields = 0;
  const clip = (value: string | undefined, length: number) => {
    if (!value || value.length <= length) return value;
    truncatedFields++;
    return `${value.slice(0, length)}…[AI摘要截断，本机证据也可能受采集限额约束]`;
  };
  const items: EvidenceItem[] = [];
  const groups = new Map<string, EvidenceItem>();
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const priorityEntries = (value: object) =>
    Object.entries(value).sort(
      ([a], [b]) =>
        Number(
          /^(code|success|ok|status|message|msg|error|errors|errorMessage|reason)$/i.test(
            b,
          ),
        ) -
        Number(
          /^(code|success|ok|status|message|msg|error|errors|errorMessage|reason)$/i.test(
            a,
          ),
        ),
    );
  const compactJson = (value: unknown, depth = 0): unknown => {
    if (depth >= 4)
      return Array.isArray(value)
        ? `[数组 ${value.length} 项]`
        : value && typeof value === "object"
          ? "[对象]"
          : value;
    if (Array.isArray(value))
      return {
        arrayLength: value.length,
        sample: value.slice(0, 1).map((v) => compactJson(v, depth + 1)),
        note: "数据采样，不代表全量验证；本机采集亦有大小和深度限制",
      };
    if (value && typeof value === "object")
      return Object.fromEntries(
        priorityEntries(value)
          .slice(0, 20)
          .map(([k, v]) => [k, compactJson(v, depth + 1)]),
      );
    return typeof value === "string"
      ? /^data:[^;]+;base64,/i.test(value) ||
        (value.length > 300 && /^[A-Za-z0-9+/=\s]+$/.test(value))
        ? `[编码内容省略，${value.length}字符]`
        : value.slice(0, 200)
      : value;
  };
  const shape = (value: unknown, depth = 0): unknown => {
    if (depth >= 3) return typeof value;
    if (Array.isArray(value))
      return [value.length ? shape(value[0], depth + 1) : "empty"];
    if (value && typeof value === "object")
      return Object.fromEntries(
        priorityEntries(value)
          .slice(0, 30)
          .map(([k, v]) => [
            k,
            /^(code|success|ok|status|message|msg|error|errors|errorMessage|reason)$/i.test(
              k,
            )
              ? compactJson(v)
              : shape(v, depth + 1),
          ]),
      );
    return typeof value;
  };
  const responseSummary = (body: string | undefined, failed: boolean) => {
    if (!body) return body;
    let summary = body;
    try {
      summary = JSON.stringify(compactJson(JSON.parse(body)));
    } catch {
      if (/^\s*(?:<!doctype|<html)/i.test(body)) {
        summary = body
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    if (summary !== body) truncatedFields++;
    return clip(summary, failed ? 1600 : 320);
  };
  const add = (item: EvidenceItem, signature?: string) => {
    const previous = signature ? groups.get(signature) : undefined;
    if (previous && previous.members.length < 16) {
      previous.members.push(...item.members);
      previous.data.occurrences =
        Number(previous.data.occurrences || 1) +
        Number(item.data.occurrences || 1);
      previous.data.lastSeen = item.timestamp;
      previous.data.maxDuration = Math.max(
        Number(previous.data.maxDuration || previous.data.duration || 0),
        Number(item.data.maxDuration || item.data.duration || 0),
      );
      const samples = (previous.data.requestSamples || []) as string[];
      const request = item.data.request;
      if (
        typeof request === "string" &&
        request.slice(0, 300) !==
          String(previous.data.request || "").slice(0, 300) &&
        !samples.includes(request.slice(0, 300)) &&
        samples.length < 3
      )
        samples.push(request.slice(0, 300));
      if (samples.length) previous.data.requestSamples = samples;
      // The shared scope note explains grouping once, not on every record.
    } else {
      items.push(item);
      if (signature) groups.set(signature, item);
    }
  };
  for (const o of run.operations) {
    const quiet =
      ["hover", "scroll"].includes(o.kind) &&
      !o.error &&
      !o.assertion &&
      !["FAILED", "BLOCKED"].includes(o.status) &&
      !run.requests.some((r) => r.stepId === o.id && !isExcludedRequest(r)) &&
      !run.logs.some((l) => l.stepId === o.id && !isExcludedResourceLog(l));
    const pageEvidence = (run.pageObservations || []).some(
      (p) => p.stepId === o.id,
    );
    if (quiet && !pageEvidence && !feedbackForStep(run, o.id).length) {
      const previous = items.at(-1);
      if (
        previous?.kind === "context" &&
        previous.data.pageId === o.pageId &&
        previous.data.module === o.module &&
        previous.data.scene === o.scene &&
        previous.data.kind === o.kind
      ) {
        previous.members.push(`step:${o.id}`);
        previous.data.actionCount = previous.members.length;
        previous.data.lastSequence = o.sequence;
        previous.data.lastTarget = clip(o.label, 100);
      } else
        items.push({
          key: `context:${o.id}`,
          kind: "context",
          timestamp: o.timestamp,
          members: [`step:${o.id}`],
          data: {
            id: o.id,
            pageId: o.pageId,
            module: o.module,
            scene: o.scene,
            kind: o.kind,
            firstSequence: o.sequence,
            lastSequence: o.sequence,
            firstTarget: clip(o.label, 100),
            lastTarget: clip(o.label, 100),
            actionCount: 1,
            observedEffect:
              "未自动判读页面效果；可能属于菜单展开或滚动前置。仅作场景上下文，不生成单独用例。",
          },
        });
      continue;
    }
    items.push({
      key: `step:${o.id}`,
      kind: "step",
      timestamp: o.timestamp,
      members: [`step:${o.id}`],
      data: {
        id: o.id,
        sequence: o.sequence,
        label: clip(o.label, 300),
        module: clip(o.module, 300),
        scene: clip(o.scene, 300),
        kind: o.kind,
        status: o.status,
        error: clip(o.error, 1500),
        assertion: clip(o.assertion, 1000),
        url: clip(o.url, 1000),
        // Compact outcome signals keep step judgement grounded even if full evidence
        // falls into another batch. Raw payloads are sent only once as request items.
        outcome: {
          feedback: feedbackForStep(run, o.id)
            .slice(0, 5)
            .map((f) => ({
              id: f.id,
              kind: f.kind,
              association: f.association,
              level: f.level,
              change: f.change,
            })),
          evidence: operationEvidence(run, o),
          navigation: (run.pageObservations || [])
            .filter((p) => p.stepId === o.id)
            .map((p) => ({
              url: clip(p.url, 500),
              status: p.status,
              failure: clip(p.failure, 300),
            })),
          requests: run.requests
            .filter((r) => r.stepId === o.id && !isExcludedRequest(r))
            .reduce((n, r) => n + countOf(r), 0),
          errors: [
            ...new Set(
              run.requests
                .filter((r) => r.stepId === o.id && !isExcludedRequest(r))
                .flatMap((r) =>
                  requestProblem(r)
                    ? [
                        r.method +
                          " " +
                          r.url.split("?")[0] +
                          ": " +
                          requestProblem(r),
                      ]
                    : [],
                ),
            ),
          ].slice(0, 6),
          console: [
            ...new Set(
              run.logs
                .filter((l) => l.stepId === o.id && !isExcludedResourceLog(l))
                .map((l) => l.level + ": " + l.text.slice(0, 200)),
            ),
          ].slice(0, 4),
        },
      },
    });
  }
  let omittedResources = 0;
  for (const r of run.requests) {
    if (isExcludedRequest(r)) {
      omittedResources++;
      continue;
    }
    const failed = !!requestProblem(r);
    let responseSignature = r.responseBody;
    let requestSignature = r.requestBody;
    let urlSignature = r.url;
    if (!failed && r.status && r.status < 400) {
      try {
        responseSignature = JSON.stringify(
          shape(JSON.parse(r.responseBody || "null")),
        );
      } catch {
        /* Plain text responses are compared exactly. */
      }
      try {
        requestSignature = JSON.stringify(
          shape(JSON.parse(r.requestBody || "null")),
        );
      } catch {
        /* Non-JSON parameters stay exact. */
      }
      try {
        const url = new URL(r.url);
        urlSignature = `${url.origin}${url.pathname}?${[...new Set(url.searchParams.keys())].sort().join("&")}`;
      } catch {
        /* Preserve nonstandard URLs. */
      }
    }
    add(
      {
        key: `request:${r.id}`,
        kind: "request",
        timestamp: r.startedAt,
        members: [`request:${r.id}`],
        data: {
          id: r.id,
          stepId: r.stepId,
          module: clip(r.module, 120),
          description: clip(r.description, 160),
          method: r.method,
          url: clip(r.url, failed ? 1500 : 500),
          status: r.status,
          failure: clip(r.failure, 1000),
          duration: r.duration,
          occurrences: countOf(r),
          maxDuration: r.maxDuration ?? r.duration,
          resourceType: r.resourceType,
          request: clip(
            responseSummary(r.requestBody, failed),
            failed ? 1000 : 320,
          ),
          response: responseSummary(r.responseBody, failed),
          bodyNote: clip(r.bodyNote, 160),
          completion: r.completion,
          bodyState: r.bodyState,
          businessMarkers: responseMarkers(r),
          association: r.association || "time-candidate",
        },
      },
      digest([
        "request",
        r.method,
        urlSignature,
        r.status,
        r.failure,
        r.module,
        r.description,
        semanticIdentity(r),
        requestSignature,
        responseSignature,
        r.completion,
        r.bodyState,
        responseMarkers(r),
      ]),
    );
  }
  for (const l of run.logs)
    if (!isExcludedResourceLog(l))
      add(
        {
          key: `log:${l.id}`,
          kind: "log",
          timestamp: l.timestamp,
          members: [`log:${l.id}`],
          data: {
            id: l.id,
            stepId: l.stepId,
            timestamp: l.timestamp,
            level: l.level,
            occurrences: countOf(l),
            text: clip(
              l.text,
              [
                "error",
                "pageerror",
                "unhandledrejection",
                "warn",
                "warning",
              ].includes(l.level)
                ? 2000
                : 600,
            ),
            location: clip(l.location, 500),
          },
        },
        digest([
          "log",
          l.level,
          l.text,
          l.location,
          run.operations.find((o) => o.id === l.stepId)?.module,
        ]),
      );
  for (const p of run.pageObservations || [])
    if (p.failure || (p.status && p.status >= 400))
      items.push({
        key: `page:${p.id}`,
        kind: "page",
        timestamp: p.timestamp,
        members: [`page:${p.id}`],
        data: { ...p, url: clip(p.url, 1000), failure: clip(p.failure, 500) },
      });
  const facts = new Map<string, ReturnType<typeof requestFact>>();
  for (const f of run.feedback || [])
    items.push({
      key: `feedback:${f.id}`,
      kind: "feedback",
      timestamp: f.timestamp,
      members: [`feedback:${f.id}`],
      data: {
        ...f,
        text: clip(f.text, 500),
        before: clip(f.before, 1000),
        after: clip(f.after, 1000),
        target: clip(f.target, 200),
        occurrences: countOf(f),
      },
    });
  for (const item of items)
    if (item.kind === "request") {
      const ids = new Set(item.members.map((m) => m.slice(m.indexOf(":") + 1)));
      const fact = requestFact(
        run,
        run.requests.filter((r) => ids.has(r.id)),
        `fact:${item.data.id}`,
      );
      facts.set(fact.id, fact);
      Object.assign(item.data, { scope: fact.scope, factId: fact.id });
      if (fact.scope === "run") delete item.data.stepId;
    }
  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const meta = {
    name: clip(run.name, 200),
    project: clip(run.project, 200),
    environment: clip(run.environment, 100),
    notes: run.notes.slice(-4).map((n) => clip(n, 250)),
  };
  const completeness = evidenceCoverage(run);
  const coverage: NonNullable<Analysis["coverage"]> = {
    steps: run.operations.length,
    requests: requestStats(run).records,
    logs: run.logs.length,
    omittedResources,
    truncatedFields,
    pageObservations: (run.pageObservations || []).length,
    feedbackRecords: (run.feedback || []).length,
    feedbackEvents: (run.feedback || []).reduce((n, f) => n + countOf(f), 0),
    ambiguousFeedback: (run.feedback || []).filter(
      (f) => f.association === "ambiguous",
    ).length,
    diagnosticSteps: completeness.eligibleSteps,
    evidenceSteps: completeness.withEvidence,
    partialEvidenceSteps: completeness.partialSteps,
    missingEvidenceSteps: completeness.withoutEvidence,
    assertedSteps: completeness.assertedSteps,
    bodyLimitedRequests: completeness.requestBodyLimited,
    pendingRequests: completeness.pendingRequests,
    analysisRecords: items.length,
    groupedRecords: items.reduce((sum, i) => sum + i.members.length - 1, 0),
    requestCalls: requestStats(run).calls,
    requestRepresentatives: items.filter((i) => i.kind === "request").length,
    selectedSteps: items.filter((i) => i.kind === "step").length,
    compactedSteps: items
      .filter((i) => i.kind === "context")
      .reduce((n, i) => n + i.members.length, 0),
    inputCharacters: items.reduce(
      (n, i) => n + JSON.stringify(i.data).length,
      0,
    ),
  };
  const byKey = new Map(items.map((item) => [item.key, item]));
  const byStep = new Map(
    items.filter((i) => i.kind === "step").map((i) => [i.data.id, i]),
  );
  function bundle(keys: string[]) {
    const chosen = keys.map((key) => byKey.get(key)!);
    const stepIds = new Set(
      chosen.filter((i) => i.kind === "step").map((i) => i.data.id),
    );
    const contextIds = new Set<string>();
    for (const item of chosen) {
      for (const stepId of [
        item.data.stepId,
        ...((item.data.candidateStepIds as string[] | undefined) || []),
        ...(facts
          .get(String(item.data.factId))
          ?.perStepCounts.map((s) => s.stepId) || []),
      ])
        if (typeof stepId === "string" && !stepIds.has(stepId))
          contextIds.add(stepId);
    }
    const relatedSteps = new Set([...stepIds, ...contextIds]);
    const chosenFeedback = new Set(
      chosen.filter((i) => i.kind === "feedback").map((i) => i.data.id),
    );
    const relatedFeedback = (run.feedback || []).filter(
      (f) =>
        !chosenFeedback.has(f.id) &&
        [f.stepId, ...(f.candidateStepIds || [])].some(
          (id) => id && relatedSteps.has(id),
        ),
    );
    return {
      run: meta,
      scope: {
        ...coverage,
        batchRecords: chosen.length,
        limitations: completeness.limitations,
        note: "这是整次录制的一个批次。scope=run的请求是跨步骤统计，次数不得分配给代表步骤；每步次数以facts.perStepCounts为准。时间归属只是候选；重复总量不证明重复提交。数据是限额样本，contextSteps和navigationContext仅供定位、不生成用例；全部原始操作保留供回放，本机正文亦受采集限额约束。",
      },
      steps: chosen.filter((i) => i.kind === "step").map((i) => i.data),
      requests: chosen.filter((i) => i.kind === "request").map((i) => i.data),
      logs: chosen.filter((i) => i.kind === "log").map((i) => i.data),
      pageObservations: chosen
        .filter((i) => i.kind === "page")
        .map((i) => i.data),
      feedback: chosen.filter((i) => i.kind === "feedback").map((i) => i.data),
      contextFeedback: relatedFeedback
        .slice(0, 4)
        .map((f) => ({
          ...f,
          text: clip(f.text, 300),
          before: clip(f.before, 500),
          after: clip(f.after, 500),
        })),
      omittedContextFeedback: Math.max(0, relatedFeedback.length - 4),
      facts: chosen
        .filter((i) => i.kind === "request")
        .map((i) => {
          const f = facts.get(String(i.data.factId))!;
          return {
            id: f.id,
            scope: f.scope,
            calls: f.calls,
            records: f.records,
            perStepCounts: f.perStepCounts.map((s) => ({
              sequence: s.sequence,
              calls: s.calls,
              ...(s.sequence === undefined
                ? { pageId: s.pageId, stepId: s.stepId }
                : {}),
            })),
            timeWindow:
              f.firstSeen === f.lastSeen
                ? [f.firstSeen]
                : [f.firstSeen, f.lastSeen],
          };
        }),
      navigationContext: chosen
        .filter((i) => i.kind === "context")
        .map((i) => i.data),
      omittedContextSteps: Math.max(0, contextIds.size - 4),
      contextSteps: [...contextIds].slice(0, 4).flatMap((id) => {
        const data = byStep.get(id)?.data;
        return data
          ? [
              {
                id,
                label: data.label,
                module: data.module,
                scene: data.scene,
                status: data.status,
              },
            ]
          : [];
      }),
    };
  }
  function pack(profile: ModelProfile) {
    // Small output limits also require smaller batches of cases/findings.
    const maxRecords = Math.max(
      1,
      Math.min(80, Math.floor(profile.maxTokens / 75)),
    );
    const maxSteps = Math.max(
      1,
      Math.min(18, Math.floor(profile.maxTokens / 260)),
    );
    const batches: string[][] = [];
    let keys: string[] = [];
    let steps = 0;
    for (const item of items) {
      const next = [...keys, item.key];
      if (
        keys.length &&
        (next.length > maxRecords ||
          steps + Number(item.kind === "step") > maxSteps ||
          JSON.stringify(bundle(next)).length > INPUT_CHAR_BUDGET)
      ) {
        batches.push(keys);
        keys = [];
        steps = 0;
      }
      keys.push(item.key);
      steps += Number(item.kind === "step");
    }
    if (keys.length) batches.push(keys);
    if (!batches.length) batches.push([]);
    return batches;
  }
  const aliases = new Map(
    items.map((i) => [
      i.data.id,
      i.members.map((key) => key.slice(key.indexOf(":") + 1)),
    ]),
  );
  const count = (keys: string[]) =>
    keys.reduce((sum, key) => sum + (byKey.get(key)?.members.length || 0), 0);
  return {
    items,
    bundle,
    pack,
    coverage,
    aliases,
    facts,
    count,
    rawRecords: items.reduce((sum, i) => sum + i.members.length, 0),
  };
}

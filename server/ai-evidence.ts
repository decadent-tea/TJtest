import {
  countOf,
  isSuccessfulStaticAsset,
  isStaticAssetUrl,
  requestProblem,
} from "./evidence-quality";
import type { Run, ModelProfile, Analysis } from "../shared/types";
import { createHash } from "node:crypto";

// Budgets apply to individual calls, never to the length of a recording.
export const INPUT_CHAR_BUDGET = 24000;
export type EvidenceItem = {
  key: string;
  kind: "step" | "request" | "log";
  timestamp: string;
  members: string[];
  data: Record<string, unknown> & { id: string };
};
export function prepareEvidence(run: Run) {
  let truncatedFields = 0;
  const clip = (value: string | undefined, length: number) => {
    if (!value || value.length <= length) return value;
    truncatedFields++;
    return `${value.slice(0, length)}…[摘要截断，完整内容保留在本机记录]`;
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
        note: "数据采样，完整数据保留本机",
      };
    if (value && typeof value === "object")
      return Object.fromEntries(
        priorityEntries(value)
          .slice(0, 20)
          .map(([k, v]) => [k, compactJson(v, depth + 1)]),
      );
    return typeof value === "string" ? value.slice(0, 200) : value;
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
    return clip(summary, failed ? 1600 : 700);
  };
  const add = (item: EvidenceItem, signature?: string) => {
    const previous = signature ? groups.get(signature) : undefined;
    if (previous) {
      previous.members.push(...item.members);
      previous.data.occurrences =
        Number(previous.data.occurrences || 1) +
        Number(item.data.occurrences || 1);
      previous.data.lastSeen = item.timestamp;
      previous.data.maxDuration = Math.max(
        Number(previous.data.maxDuration || previous.data.duration || 0),
        Number(item.data.maxDuration || item.data.duration || 0),
      );
      const stepIds = (previous.data.relatedStepIds || []) as string[];
      if (
        typeof item.data.stepId === "string" &&
        !stepIds.includes(item.data.stepId) &&
        stepIds.length < 8
      )
        stepIds.push(item.data.stepId);
      previous.data.relatedStepIds = stepIds;
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
  for (const o of run.operations)
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
          requests: run.requests.filter(
            (r) => r.stepId === o.id && !isStaticAssetUrl(r.url),
          ).length,
          errors: [
            ...new Set(
              run.requests
                .filter((r) => r.stepId === o.id && !isStaticAssetUrl(r.url))
                .flatMap((r) =>
                  requestProblem(r)
                    ? [
                        r.method +
                          " " +
                          new URL(r.url, run.url).pathname +
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
                .filter((l) => l.stepId === o.id)
                .map((l) => l.level + ": " + l.text.slice(0, 200)),
            ),
          ].slice(0, 4),
        },
      },
    });
  let omittedResources = 0;
  for (const r of run.requests) {
    if (isStaticAssetUrl(r.url)) {
      omittedResources++;
      continue;
    }
    // Successful static assets add little business evidence; static failures still enter analysis.
    if (
      (isSuccessfulStaticAsset(r) ||
        r.category === "resource" ||
        (!!r.status &&
          r.status < 400 &&
          [
            "script",
            "stylesheet",
            "image",
            "font",
            "media",
            "manifest",
          ].includes(r.resourceType))) &&
      !r.failure &&
      !(r.status && r.status >= 400)
    ) {
      omittedResources++;
      continue;
    }
    const failed = !!r.failure || !!(r.status && r.status >= 400);
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
          module: clip(r.module, 300),
          description: clip(r.description, 500),
          method: r.method,
          url: clip(r.url, 1500),
          status: r.status,
          failure: clip(r.failure, 1000),
          duration: r.duration,
          occurrences: countOf(r),
          maxDuration: r.maxDuration ?? r.duration,
          resourceType: r.resourceType,
          request: clip(r.requestBody, 1000),
          response: responseSummary(r.responseBody, failed),
          bodyNote: clip(r.bodyNote, 500),
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
        requestSignature,
        responseSignature,
      ]),
    );
  }
  for (const l of run.logs)
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
  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const meta = {
    name: clip(run.name, 200),
    project: clip(run.project, 200),
    environment: clip(run.environment, 100),
    notes: run.notes.slice(-4).map((n) => clip(n, 250)),
  };
  const coverage: NonNullable<Analysis["coverage"]> = {
    steps: run.operations.length,
    requests: run.requests.length - omittedResources,
    logs: run.logs.length,
    omittedResources,
    truncatedFields,
    analysisRecords: items.length,
    groupedRecords: items.reduce((sum, i) => sum + i.members.length - 1, 0),
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
      const stepId = item.data.stepId;
      if (typeof stepId === "string" && !stepIds.has(stepId))
        contextIds.add(stepId);
    }
    return {
      run: meta,
      scope: {
        ...coverage,
        batchRecords: chosen.length,
        note: "这是完整录制中的一个批次，不得把本批当作整次体检。同模块同接口的正常调用按响应结构与业务状态分组合并，重复日志合并，参数及数据为代表采样，不代表每份数据都已验证。异常调用按完整内容比较。引用代表ID会在本机扩展为全部原始记录ID。contextSteps 仅供定位、不生成用例。完整证据保留本机。",
      },
      steps: chosen.filter((i) => i.kind === "step").map((i) => i.data),
      requests: chosen.filter((i) => i.kind === "request").map((i) => i.data),
      logs: chosen.filter((i) => i.kind === "log").map((i) => i.data),
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
    count,
    rawRecords: items.reduce((sum, i) => sum + i.members.length, 0),
  };
}

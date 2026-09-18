import { decrypt } from "./store";
import type { ModelProfile } from "../shared/types";

export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly capacity = false,
  ) {
    super(message);
  }
}
export interface ModelProgress {
  stage: "connecting" | "receiving" | "generating" | "retrying";
  requestStartedAt: string;
  updatedAt: string;
  receivedCharacters: number;
  reasoningCharacters: number;
  attempt?: number;
  lastError?: string;
}
export interface ModelCallOptions {
  signal?: AbortSignal;
  json?: boolean;
  onProgress?: (progress: ModelProgress) => void;
}
export async function callModel(
  profile: ModelProfile,
  messages: { role: string; content: string }[],
  options: ModelCallOptions = {},
) {
  if (!profile.apiKey) throw new Error("尚未配置 API Key。");
  const startedAt = new Date().toISOString();
  let content = "";
  let reasoningCharacters = 0;
  let lastEmit = 0;
  const emit = (stage: ModelProgress["stage"], force = false) => {
    if (!force && Date.now() - lastEmit < 1000) return;
    lastEmit = Date.now();
    options.onProgress?.({
      stage,
      requestStartedAt: startedAt,
      updatedAt: new Date().toISOString(),
      receivedCharacters: content.length,
      reasoningCharacters,
    });
  };
  const controller = new AbortController();
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const totalTimeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, profile.timeout * 1000);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const resetIdle = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.min(profile.timeout, 45) * 1000,
    );
  };
  const hybridQwen =
    profile.provider === "Qwen" &&
    /^qwen(?:3[.-]|-(?:plus|flash)(?:-|$))/i.test(profile.model) &&
    !/coder/i.test(profile.model);
  emit("connecting", true);
  try {
    const response = await fetch(
      `${profile.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${decrypt(profile.apiKey)}`,
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          max_tokens: profile.maxTokens,
          stream: true,
          ...(profile.provider === "Qwen"
            ? { stream_options: { include_usage: true } }
            : {}),
          ...(hybridQwen ? { enable_thinking: profile.thinking ?? false } : {}),
          ...(options.json && profile.provider === "Qwen" && !profile.thinking
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal,
      },
    );
    if (!response.ok) {
      const body = await response.text();
      const capacity =
        response.status === 413 ||
        ([400, 422].includes(response.status) &&
          /context|token|length|too (?:large|long)|maximum|上下文|长度|超长/i.test(
            body,
          ));
      throw new ModelError(
        capacity
          ? "模型上下文容量不足。"
          : `模型服务返回 HTTP ${response.status}，请检查地址、密钥、模型名称或额度。`,
        response.status === 429 || response.status >= 500,
        capacity,
      );
    }
    emit("receiving", true);
    let usage: unknown;
    let finishReason: string | undefined;
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      // Compatible gateways and connection-test fixtures may return ordinary JSON.
      const data = (await response.json()) as {
        choices?: {
          message?: { content?: string; reasoning_content?: string };
          finish_reason?: string;
        }[];
        usage?: unknown;
      };
      content = data.choices?.[0]?.message?.content || "";
      reasoningCharacters =
        data.choices?.[0]?.message?.reasoning_content?.length || 0;
      finishReason = data.choices?.[0]?.finish_reason;
      usage = data.usage;
    } else {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("模型流式响应没有正文。");
      const decoder = new TextDecoder();
      let buffer = "";
      let doneMarker = false;
      function event(frame: string) {
        const text = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!text) return; // SSE keep-alive comments carry no model output.
        if (text.trim() === "[DONE]") {
          doneMarker = true;
          return;
        }
        const data = JSON.parse(text) as {
          error?: { message?: string };
          choices?: {
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string;
          }[];
          usage?: unknown;
        };
        if (data.error)
          throw new ModelError("模型流式响应报告服务错误。", true);
        const choice = data.choices?.[0];
        if (typeof choice?.delta?.content === "string")
          content += choice.delta.content;
        if (typeof choice?.delta?.reasoning_content === "string")
          reasoningCharacters += choice.delta.reasoning_content.length;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (data.usage) usage = data.usage;
        if (content.length > 400000 || buffer.length > 1000000)
          throw new Error("模型输出异常过大，已停止接收。");
        emit(reasoningCharacters > 0 && !content ? "generating" : "receiving");
      }
      resetIdle();
      try {
        while (!doneMarker) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            break;
          }
          resetIdle();
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");
          let separator: number;
          while ((separator = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            event(frame);
            if (doneMarker) break;
          }
          if (buffer.length > 1000000)
            throw new Error("模型流式数据格式异常，已停止接收。");
        }
        if (!doneMarker && buffer.trim()) event(buffer);
        if (!doneMarker && !finishReason)
          throw new ModelError(
            "模型流式响应中途断开，未接收到完成标记。",
            true,
          );
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    emit("receiving", true);
    if (!content && finishReason === "length")
      throw new ModelError("模型输出被截断。", false, true);
    if (!content)
      throw new Error(
        reasoningCharacters
          ? "模型仅返回思考内容，未返回分析结果。可关闭思考模式后重试。"
          : "模型返回空内容或不支持的响应格式。",
      );
    return { content, usage, finishReason };
  } catch (error) {
    if (options.signal?.aborted)
      throw new Error("分析已停止，已完成批次保留。");
    if (timedOut)
      throw new ModelError(
        `模型请求超时（总时限 ${profile.timeout} 秒，流式响应连续无数据时限 ${Math.min(profile.timeout, 45)} 秒）。`,
        true,
      );
    if (error instanceof TypeError) {
      const cause = (error as Error & { cause?: { code?: string } }).cause
        ?.code;
      throw new ModelError(
        `模型连接失败${cause ? `（${cause}）` : ""}，请检查网络或代理。`,
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(totalTimeout);
    clearTimeout(idleTimeout);
  }
}

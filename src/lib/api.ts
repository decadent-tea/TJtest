export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: `服务返回 ${response.status}` }));
    throw new Error(data.error || "请求失败。");
  }
  return response.json();
}
export const time = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export const active = (status: string) =>
  ["RECORDING", "PAUSED", "REPLAYING"].includes(status);
export const labels: Record<string, string> = {
  RECORDING: "正在录制",
  PAUSED: "采集已暂停",
  REPLAYING: "正在复检",
  COMPLETED: "已完成",
  COMPLETED_WITH_ISSUES: "完成 · 有异常",
  INTERRUPTED: "已中断",
  RECORDED: "已录制",
  PASSED: "通过",
  EXECUTED: "执行完成",
  FAILED: "执行失败",
  BLOCKED: "前置阻塞",
  SKIPPED: "已跳过",
  NONE: "未分析",
  RUNNING: "正在分析",
  high: "高",
  medium: "中",
  low: "低",
};

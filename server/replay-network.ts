// Readiness is about the action's first responses, not a globally silent network.
// Real-time dashboards continue polling even when every control is ready.
export class ReplayNetwork<T> {
  private pending = new Map<T, { pageId: string; group: Group; url: string }>();
  private groups = new Map<string, Group>();
  private activity = new Map<string, number>();

  start(
    request: T,
    pageId: string,
    stepId: string,
    method: string,
    url: string,
    at = Date.now(),
  ) {
    const key = JSON.stringify([pageId, stepId, method, url]);
    let group = this.groups.get(key);
    if (!group) {
      group = { pageId, stepId, starts: [], successes: 0, polling: false };
      this.groups.set(key, group);
    }
    group.starts.push(at);
    if (group.starts.length > 3) group.starts.shift();
    if (method === "GET" && group.successes >= 2 && group.starts.length === 3) {
      const [a, b, c] = group.starts;
      const first = b - a;
      const second = c - b;
      // Require separate, regularly recurring successful reads in ONE action.
      // Writes, concurrent fan-out and repeated user searches remain blocking.
      if (
        first >= 100 &&
        second >= 100 &&
        first <= 10_000 &&
        second <= 10_000 &&
        second / first >= 0.5 &&
        second / first <= 2
      )
        group.polling = true;
    }
    this.pending.set(request, { pageId, group, url });
    if (!group.polling) this.activity.set(pageId, at);
  }

  finish(request: T, successful: boolean, at = Date.now()) {
    const entry = this.pending.get(request);
    if (!entry) return;
    this.pending.delete(request);
    if (successful) entry.group.successes++;
    if (!entry.group.polling) this.activity.set(entry.pageId, at);
  }

  state(pageId: string) {
    const pending = [...this.pending.values()].filter(
      (e) => e.pageId === pageId && !e.group.polling,
    );
    return {
      pending: pending.length,
      urls: [...new Set(pending.map((e) => e.url))],
      lastActivity: this.activity.get(pageId) || 0,
      polling: [...this.groups.values()].filter(
        (g) => g.pageId === pageId && g.polling,
      ).length,
    };
  }

  clearPage(pageId: string) {
    for (const [request, entry] of this.pending)
      if (entry.pageId === pageId) this.pending.delete(request);
    for (const [key, group] of this.groups)
      if (group.pageId === pageId) this.groups.delete(key);
    this.activity.delete(pageId);
  }

  navigated(pageId: string, currentStepId?: string) {
    // SPA routes can leave unresolved reads from a previous view. Keep requests
    // triggered by the current navigation action, including its slow data loads.
    for (const [request, entry] of this.pending)
      if (entry.pageId === pageId && entry.group.stepId !== currentStepId)
        this.pending.delete(request);
    for (const [key, group] of this.groups)
      if (group.pageId === pageId && group.stepId !== currentStepId)
        this.groups.delete(key);
  }
}

interface Group {
  pageId: string;
  stepId: string;
  starts: number[];
  successes: number;
  polling: boolean;
}

import { useSessionState } from "@/lib/use-session-state";
import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion, AnimatePresence } from "motion/react";
import {
  Activity,
  LayoutDashboard,
  ScanLine,
  Workflow,
  History,
  Settings2,
  AlertTriangle,
  Plus,
  ChevronRight,
  ArrowUpRight,
  Search,
  Monitor,
  LoaderCircle,
  Menu,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Overview, PageTitle, RunTable, Blank } from "@/components/studio";
import { Workbench } from "@/components/workbench";
import { FlowList, FlowEditor } from "@/components/flows";
import { Pagination, currentPage } from "@/components/pagination";
import { Settings, ModelEditor } from "@/components/settings";
import { WorkspaceAtmosphere } from "@/components/workspace-atmosphere";
import { api, active } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Summary, Run, Flow, ModelProfile } from "../shared/types";
type Health = {
  status: string;
  active: { id: string; status: string }[];
};
const nav = [
  { id: "overview", label: "体检首页", icon: LayoutDashboard },
  { id: "workbench", label: "执行工作台", icon: ScanLine },
  { id: "flows", label: "流程库", icon: Workflow },
  { id: "history", label: "体检记录", icon: History },
  { id: "settings", label: "模型与设置", icon: Settings2 },
];
function currentRoute() {
  const route = location.hash.slice(1) || "overview";
  return route === "issues" ? "history" : route;
}
export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [runs, setRuns] = useState<Summary[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [health, setHealth] = useState<Health>();
  const [connectionError, setConnectionError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [runError, setRunError] = useState("");
  const [retry, setRetry] = useState(0);
  const [recordOrigin, setRecordOrigin] = useSessionState<string>(
    "record-origin",
    "history",
  );
  const [settingsOrigin, setSettingsOrigin] = useState("");
  const [run, setRun] = useState<Run>();
  const [lastRunId, setLastRunId] = useState(
    sessionStorage.getItem("last-run") || "",
  );
  const [busy, setBusy] = useState(false);
  const [newModal, setNewModal] = useState(false);
  const [recordForm, setRecordForm] = useState({
    name: "",
    project: "",
    environment: "测试环境",
    url: "",
  });
  const [replayFlow, setReplayFlow] = useState<Flow>();
  const [replayVars, setReplayVars] = useState<Record<string, string>>({});
  const [editFlow, setEditFlow] = useState<Flow>();
  const [deleteFlow, setDeleteFlow] = useState<Flow>();
  const [deleteRun, setDeleteRun] = useState<Summary>();
  const [modelModal, setModelModal] = useState(false);
  const [editModel, setEditModel] = useState<ModelProfile>();
  const [deleteModel, setDeleteModel] = useState<ModelProfile>();
  const [saveFlowModal, setSaveFlowModal] = useState(false);
  const [flowName, setFlowName] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [recordsPage, setRecordsPage] = useState(0);
  const [recordsPageSize, setRecordsPageSize] = useState(10);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedRunIds(new Set());
  }, [route, search, statusFilter]);
  const [mobileNav, setMobileNav] = useState(false);
  const recordDetail = route.startsWith("record/");
  const recordTab =
    recordDetail &&
    ["network", "console", "screen", "report"].includes(route.split("/")[2])
      ? route.split("/")[2]
      : "network";
  const focusedIssue = recordDetail ? route.split("/")[3] : undefined;
  const recordsArea = recordDetail || ["history", "archive"].includes(route);
  const page = route.startsWith("run/")
    ? "workbench"
    : recordDetail
      ? "history"
      : route;
  const navPage = recordsArea ? "history" : page;
  const runId =
    route.startsWith("run/") || recordDetail
      ? route.split("/")[1]
      : page === "workbench"
        ? runs.find((item) => item.id === lastRunId && active(item.status))
            ?.id ||
          runs.find((item) => active(item.status))?.id ||
          ""
        : "";
  const navigate = (page: string) => {
    location.hash = page;
    setMobileNav(false);
  };
  useEffect(() => {
    let index = Number(history.state?.studioNavigationIndex) || 0;
    history.replaceState(
      { ...history.state, studioNavigationIndex: index },
      "",
    );
    let restoring = false;
    let allowed = false;
    const callback = () => {
      if (restoring) {
        restoring = false;
        return;
      }
      const nextIndex = history.state?.studioNavigationIndex ?? index + 1;
      history.replaceState(
        { ...history.state, studioNavigationIndex: nextIndex },
        "",
      );
      const delta = nextIndex - index;
      if (!allowed && delta) {
        const request = new CustomEvent("studio:before-navigate", {
          cancelable: true,
          detail: () => {
            allowed = true;
            history.go(delta);
          },
        });
        if (!window.dispatchEvent(request)) {
          restoring = true;
          history.go(-delta);
          return;
        }
      }
      allowed = false;
      index = nextIndex;
      setRoute(currentRoute());
    };
    window.addEventListener("hashchange", callback);
    return () => window.removeEventListener("hashchange", callback);
  }, []);
  useEffect(() => {
    if (route === "workbench" && runId) {
      // Bind the workspace to this run before summary polling removes completed runs.
      location.hash = `run/${runId}`;
    }
  }, [route, runId]);
  const refresh = async () => {
    try {
      const [h, r, f, m] = await Promise.all([
        api<Health>("/health"),
        api<Summary[]>("/runs"),
        api<Flow[]>("/flows"),
        api<ModelProfile[]>("/settings/models"),
      ]);
      setLoaded(true);
      setHealth(h);
      setRuns(r);
      setFlows(f);
      setModels(m);
      setConnectionError("");
    } catch (e) {
      setHealth(undefined);
      setConnectionError(e instanceof Error ? e.message : "后端暂时不可用");
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setRun(undefined);
    setRunError("");
    if (!runId) return;
    let disposed = false;
    const load = async () => {
      try {
        const r = await api<Run>(`/runs/${runId}`);
        if (!disposed) {
          setRun(r);
          setRunError("");
          if (location.hash === `#run/${runId}` && !active(r.status))
            location.hash = `record/${runId}`;
        }
      } catch (e) {
        if (!disposed)
          setRunError(e instanceof Error ? e.message : "记录无法读取");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1800);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [runId, retry]);
  const actionPending = useRef(false);
  const action = async (fn: () => Promise<void>) => {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作未完成。");
      return false;
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const openRun = (id: string) => {
    setLastRunId(id);
    sessionStorage.setItem("last-run", id);
    navigate(`run/${id}`);
  };
  const openRecord = (id: string) => {
    setRecordOrigin(
      page === "archive" || runs.find((r) => r.id === id)?.archived
        ? "archive"
        : "history",
    );
    navigate(`record/${id}`);
  };
  const configureModels = () => {
    setSettingsOrigin(route);
    navigate("settings");
  };
  const newRecording = () => {
    setRecordForm({ name: "", project: "", environment: "测试环境", url: "" });
    setNewModal(true);
  };
  const createRecording = () =>
    void action(async () => {
      const r = await api<Run>("/recordings", recordForm);
      setNewModal(false);
      setRun(r);
      openRun(r.id);
      toast.success("浏览器已启动，请开始操作。");
    });
  const activeTask = runs.find((r) => active(r.status));
  const historyCount = runs.filter((r) => !r.archived).length;
  const archiveSelection = runs.filter(
    (r) => selectedRunIds.has(r.id) && !r.archived && !active(r.status),
  );
  const archiveSelected = () => {
    if (!archiveSelection.length) {
      toast.info("请先选择要归档的记录。");
      return;
    }
    void action(async () => {
      const selected = archiveSelection;
      const results = await Promise.allSettled(
        selected.map((r) => api(`/runs/${r.id}/archive`, { archived: true })),
      );
      const succeeded = selected.filter(
        (_, index) => results[index].status === "fulfilled",
      );
      setSelectedRunIds((previous) => {
        const next = new Set(previous);
        succeeded.forEach((r) => next.delete(r.id));
        return next;
      });
      if (succeeded.length)
        toast.success(`已归档 ${succeeded.length} 条记录。`);
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length)
        toast.error(`${failed.length} 条记录归档失败，已保留勾选，可重试。`);
    });
  };
  const title = nav.find((n) => n.id === navPage)?.label || "体检首页";
  const filteredRuns = runs.filter(
    (r) =>
      (page === "archive"
        ? r.archived
        : page === "history"
          ? !r.archived
          : true) &&
      `${r.name} ${r.project} ${r.environment}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (statusFilter === "all" || r.status === statusFilter),
  );
  const shownRecordsPage = currentPage(
    recordsPage,
    filteredRuns.length,
    recordsPageSize,
  );
  const pageRuns = filteredRuns.slice(
    shownRecordsPage * recordsPageSize,
    (shownRecordsPage + 1) * recordsPageSize,
  );
  return (
    <MotionConfig reducedMotion="never">
      <div className="app-shell">
        <aside className={cn("sidebar", mobileNav && "mobile-open")}>
          <a
            className="brand"
            href="#overview"
            onClick={() => setMobileNav(false)}
          >
            <div className="brand-symbol">
              <Activity size={23} />
            </div>
            <div>
              <strong>
                巡检台<span>HEALTH STUDIO</span>
              </strong>
              <small>HEALTH STUDIO</small>
            </div>
          </a>
          <div className="workspace-label">
            <span>北斗天地</span>
            <small>测试工作空间 / LOCAL</small>
          </div>
          <nav aria-label="主导航">
            {nav.map((item) => (
              <div key={item.id}>
                <Button
                  variant="ghost"
                  aria-current={navPage === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                  className={cn(
                    "nav-item",
                    navPage === item.id && "nav-active",
                  )}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.id === "history" && historyCount > 0 && (
                    <span className="nav-count">{historyCount}</span>
                  )}
                  {navPage === item.id && (
                    <motion.span
                      className="nav-marker"
                      layoutId="navigation-indicator"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 38,
                      }}
                    />
                  )}
                </Button>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="agent-status">
              <Monitor size={18} />
              <div>
                <strong>
                  {health
                    ? "执行器已连接"
                    : connectionError
                      ? "执行器未连接"
                      : "执行器连接中"}
                </strong>
                <small>
                  {!health
                    ? "正在尝试连接"
                    : activeTask
                      ? "有活动任务"
                      : "准备就绪 · Chromium"}
                </small>
              </div>
              <span className={cn("signal-dot", !health && "signal-idle")} />
            </div>
            <div className="sidebar-person">
              <div className="person-avatar">测</div>
              <div>
                <strong>测试工程师</strong>
                <small>本机工作空间</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          {page === "overview" && <WorkspaceAtmosphere />}
          <header className="topbar">
            <div className="topbar-path">
              <Button
                variant="ghost"
                size="icon-sm"
                className="mobile-menu"
                onClick={() => setMobileNav(!mobileNav)}
                aria-label={mobileNav ? "收起导航" : "展开导航"}
                aria-expanded={mobileNav}
              >
                {mobileNav ? <X /> : <Menu />}
              </Button>
              <nav className="breadcrumbs" aria-label="面包屑">
                <a className="breadcrumb-home" href="#overview" onClick={() => setMobileNav(false)}>
                  北斗天地 / 工作空间
                </a>
                <ChevronRight className="breadcrumb-home" size={16} aria-hidden="true" />
                {recordDetail || page === "archive" ? (
                  <>
                    <a href="#history" onClick={() => setMobileNav(false)}>体检记录</a>
                    <ChevronRight size={16} aria-hidden="true" />
                    {recordDetail && recordOrigin === "archive" && (
                      <>
                        <a href="#archive" onClick={() => setMobileNav(false)}>已归档记录</a>
                        <ChevronRight size={16} aria-hidden="true" />
                      </>
                    )}
                    <strong aria-current="page">
                      {recordDetail ? "记录详情" : "已归档记录"}
                    </strong>
                  </>
                ) : (
                  <strong aria-current="page">{title}</strong>
                )}
              </nav>
            </div>
            <div className="topbar-right">
              <span className="local-mode">
                <span className="signal-dot" />
                本机模式
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void refresh()}
                aria-label="刷新数据"
              >
                <RefreshCw />
              </Button>
              <div className="top-avatar">测</div>
            </div>
          </header>
          <main className="main-content">
            {connectionError && (
              <Alert variant="destructive" className="mb-6">
                <AlertTriangle />
                <AlertTitle>后端暂时无法连接</AlertTitle>
                <AlertDescription>
                  确认启动命令仍在运行。系统会自动重连。{connectionError}
                </AlertDescription>
              </Alert>
            )}
            {activeTask && page !== "workbench" && (
              <div className="active-task">
                <span>
                  <LoaderCircle size={16} className="animate-spin" />
                  {activeTask.name} ·{" "}
                  {activeTask.status === "PAUSED"
                    ? "已暂停"
                    : activeTask.mode === "record"
                      ? "正在录制"
                      : "正在复检"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openRun(activeTask.id)}
                >
                  返回工作台
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              </div>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={page}
                initial={{
                  opacity: 0,
                  y: 10,
                  filter: "blur(3px)",
                }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{
                  opacity: 0,
                  y: -6,
                  filter: "blur(2px)",
                }}
                transition={{ duration: 0.24 }}
                className="page-content"
              >
                {!loaded && (
                  <Blank
                    title={
                      connectionError ? "工作空间暂不可用" : "正在加载工作空间…"
                    }
                    description="记录、流程和模型读取完成后会显示在这里。"
                    action={
                      <Button variant="outline" onClick={() => void refresh()}>
                        重新连接
                      </Button>
                    }
                  />
                )}
                {loaded && (
                  <>
                    {(recordDetail || page === "workbench") && runError && (
                      <Alert variant="destructive" className="mb-4">
                        <AlertTitle>记录读取失败</AlertTitle>
                        <AlertDescription>
                          {runError}
                          <Button
                            variant="outline"
                            onClick={() => setRetry((v) => v + 1)}
                          >
                            重新读取
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    {page === "overview" && (
                      <Overview
                        runs={runs}
                        flows={flows}
                        onNew={newRecording}
                        onOpen={(id) =>
                          runs.some(
                            (item) => item.id === id && active(item.status),
                          )
                            ? openRun(id)
                            : openRecord(id)
                        }
                        onPage={navigate}
                      />
                    )}
                    {page === "workbench" && (!runId || !!run) && (
                      <Workbench
                        key={runId || "empty"}
                        run={run}
                        models={models}
                        onConfigureModels={configureModels}
                        busy={busy}
                        onNew={() => newRecording()}
                        onAction={(name, body) =>
                          void action(async () => {
                            const updated = await api<Run>(
                              `/runs/${run!.id}/${name}`,
                              body || {},
                            );
                            setRun(updated);
                            if (name === "stop") openRecord(updated.id);
                            toast.success(
                              name === "stop"
                                ? "执行已结束，证据已保存。"
                                : name === "scene"
                                  ? "新场景已标记。"
                                  : name.startsWith("requests/")
                                    ? "接口业务描述已保存。"
                                    : name === "dialog"
                                      ? "对话框选择已记录。"
                                      : name === "analysis/cancel"
                                        ? "分析已停止，已完成批次保留。"
                                        : "采集状态已更新。",
                            );
                          })
                        }
                        onSaveFlow={() => {
                          setFlowName(run?.name || "");
                          setSaveFlowModal(true);
                        }}
                        onAnalyze={(id) =>
                          void action(async () => {
                            await api(`/runs/${run!.id}/analyze`, {
                              profileId: id,
                            });
                            setRun(await api(`/runs/${run!.id}`));
                            toast.success("分析已开始，完成后会显示结果。");
                          })
                        }
                      />
                    )}
                    {page === "flows" && (
                      <FlowList
                        flows={flows}
                        onNew={() => newRecording()}
                        onEdit={setEditFlow}
                        onDelete={setDeleteFlow}
                        onReplay={(f) => {
                          setReplayFlow(f);
                          setReplayVars({});
                        }}
                      />
                    )}
                    {recordDetail && page === "history" && !!run && (
                      <Workbench
                        key={`record-${runId}`}
                        run={run}
                        models={models}
                        busy={busy}
                        readOnly
                        onConfigureModels={configureModels}
                        resultView={route.split("/")[2] === "result"}
                        onOpenResult={() => navigate(`record/${runId}/result`)}
                        onBackToEvidence={() =>
                          navigate(`record/${runId}/report`)
                        }
                        focusedIssue={focusedIssue}
                        initialTab={recordTab}
                        onTabChange={(tab) =>
                          navigate(`record/${runId}/${tab}`)
                        }
                        onNew={() => newRecording()}
                        onAction={(name, body) =>
                          void action(async () => {
                            const updated = await api<Run>(
                              `/runs/${runId}/${name}`,
                              body || {},
                            );
                            setRun(updated);
                            toast.success(
                              name === "analysis/cancel"
                                ? "分析已停止，已完成批次保留。"
                                : name.startsWith("requests/")
                                  ? "接口业务描述已保存。"
                                  : "记录已更新。",
                            );
                          })
                        }
                        onSaveFlow={() => {
                          setFlowName(run?.name || "");
                          setSaveFlowModal(true);
                        }}
                        onAnalyze={(id) =>
                          void action(async () => {
                            await api(`/runs/${runId}/analyze`, {
                              profileId: id,
                            });
                            setRun(await api(`/runs/${runId}`));
                            toast.success("分析已开始，完成后会显示结果。");
                          })
                        }
                      />
                    )}
                    {(recordDetail || page === "workbench") &&
                      runId &&
                      !run &&
                      !runError && (
                        <Blank
                          title="正在读取体检记录…"
                          description="正在加载操作与执行证据。"
                        />
                      )}
                    {!recordDetail && ["history", "archive"].includes(page) && (
                      <>
                        <PageTitle
                          eyebrow={`RECORDS / ${page === "archive" ? "ARCHIVE" : "HISTORY"}`}
                          title="体检记录"
                          description={
                            page === "archive"
                              ? "归档的执行证据与报告，保留每一次体检的结论。"
                              : "查看每次录制和复检，回到问题发生时的业务位置。"
                          }
                          actions={
                            <Button onClick={() => newRecording()}>
                              <Plus data-icon="inline-start" />
                              新建体检
                            </Button>
                          }
                        />
                        <div
                          className="flex gap-2 mb-5"
                          role="group"
                          aria-label="记录归档状态"
                        >
                          <Button
                            variant={page === "history" ? "secondary" : "ghost"}
                            aria-pressed={page === "history"}
                            onClick={() => {
                              setRecordsPage(0);
                              navigate("history");
                            }}
                          >
                            当前记录（{historyCount}）
                          </Button>
                          <Button
                            variant={page === "archive" ? "secondary" : "ghost"}
                            aria-pressed={page === "archive"}
                            onClick={() => {
                              setRecordsPage(0);
                              navigate("archive");
                            }}
                          >
                            已归档（{runs.length - historyCount}）
                          </Button>
                        </div>
                        <Card>
                          <CardHeader>
                            <CardTitle>
                              {page === "archive"
                                ? "已归档记录"
                                : "当前体检记录"}
                            </CardTitle>
                            <CardDescription>
                              人工录制与自动复检分别保存，历史结果不会被覆盖。
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="records-toolbar">
                              <div className="search-wrap">
                                <Search size={17} />
                                <Input
                                  aria-label="搜索体检记录"
                                  placeholder="搜索任务名称、项目或环境"
                                  value={search}
                                  onChange={(e) => {
                                    setSearch(e.target.value);
                                    setRecordsPage(0);
                                  }}
                                />
                              </div>
                              {page === "history" && (
                                <Button
                                  disabled={busy}
                                  onClick={archiveSelected}
                                >
                                  {busy ? "归档中…" : "归档"}
                                  {archiveSelection.length > 0 &&
                                    `（${archiveSelection.length}）`}
                                </Button>
                              )}
                              <Select
                                value={statusFilter}
                                onValueChange={(value) => {
                                  setStatusFilter(value);
                                  setRecordsPage(0);
                                }}
                              >
                                <SelectTrigger className="w-44">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="all">
                                      全部状态
                                    </SelectItem>
                                    <SelectItem value="RECORDING">
                                      正在录制
                                    </SelectItem>
                                    <SelectItem value="PAUSED">
                                      已暂停
                                    </SelectItem>
                                    <SelectItem value="REPLAYING">
                                      正在复检
                                    </SelectItem>
                                    <SelectItem value="COMPLETED">
                                      已完成
                                    </SelectItem>
                                    <SelectItem value="COMPLETED_WITH_ISSUES">
                                      完成 · 有异常
                                    </SelectItem>
                                    <SelectItem value="INTERRUPTED">
                                      已中断
                                    </SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                            {(search || statusFilter !== "all") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSearch("");
                                  setStatusFilter("all");
                                  setRecordsPage(0);
                                }}
                              >
                                清空筛选
                              </Button>
                            )}
                            {filteredRuns.length ? (
                              <RunTable
                                runs={pageRuns}
                                selection={
                                  page === "history"
                                    ? {
                                        ids: new Set(
                                          archiveSelection.map((r) => r.id),
                                        ),
                                        disabled: busy,
                                        onChange: (ids, checked) =>
                                          setSelectedRunIds((previous) => {
                                            const next = new Set(previous);
                                            ids.forEach((id) =>
                                              checked
                                                ? next.add(id)
                                                : next.delete(id),
                                            );
                                            return next;
                                          }),
                                      }
                                    : undefined
                                }
                                onOpen={(id) =>
                                  runs.some(
                                    (r) => r.id === id && active(r.status),
                                  )
                                    ? openRun(id)
                                    : openRecord(id)
                                }
                                actions={(r) =>
                                  !active(r.status) && (
                                    <>
                                      {r.archived && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          disabled={busy}
                                          onClick={() =>
                                            void action(async () => {
                                              await api(
                                                `/runs/${r.id}/archive`,
                                                {},
                                              );
                                              toast.success(
                                                r.archived
                                                  ? "已移出归档。"
                                                  : "已归档。",
                                              );
                                            })
                                          }
                                        >
                                          移出归档
                                        </Button>
                                      )}
                                      {r.archived && (
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          disabled={
                                            busy ||
                                            r.analysisStatus === "RUNNING"
                                          }
                                          title={
                                            r.analysisStatus === "RUNNING"
                                              ? "请先停止模型分析"
                                              : undefined
                                          }
                                          onClick={() => setDeleteRun(r)}
                                        >
                                          彻底删除
                                        </Button>
                                      )}
                                    </>
                                  )
                                }
                              />
                            ) : (
                              <Blank
                                title={
                                  search || statusFilter !== "all"
                                    ? "暂无匹配记录"
                                    : page === "archive"
                                      ? "暂无归档记录"
                                      : "暂无匹配记录"
                                }
                                description={
                                  search || statusFilter !== "all"
                                    ? "请调整或清空筛选条件。"
                                    : page === "archive"
                                      ? "完成体检后，在体检记录中归档，将报告与证据留存。"
                                      : "开始第一次体检，或调整搜索条件。"
                                }
                              />
                            )}
                            <Pagination
                              total={filteredRuns.length}
                              page={shownRecordsPage}
                              pageSize={recordsPageSize}
                              onPageChange={setRecordsPage}
                              onPageSizeChange={(size) => {
                                setRecordsPageSize(size);
                                setRecordsPage(0);
                              }}
                            />
                          </CardContent>
                        </Card>
                      </>
                    )}
                    {page === "settings" && (
                      <>
                        {settingsOrigin && (
                          <Button
                            variant="ghost"
                            className="mb-4"
                            onClick={() => navigate(settingsOrigin)}
                          >
                            ← 返回体检分析
                          </Button>
                        )}
                        <Settings
                          models={models}
                          busy={busy}
                          onDelete={setDeleteModel}
                          onEdit={(m) => {
                            setEditModel(m);
                            setModelModal(true);
                          }}
                          onTest={(id) =>
                            void action(async () => {
                              const result = await api<{ duration: number }>(
                                `/settings/models/${id}/test`,
                                {},
                              );
                              toast.success(
                                `连接成功，耗时 ${result.duration}ms。`,
                              );
                            })
                          }
                        />
                      </>
                    )}
                    {!nav.some((n) => n.id === navPage) && (
                      <Blank
                        title="找不到这个页面"
                        description="入口可能已变更，请返回体检首页。"
                        action={
                          <Button onClick={() => navigate("overview")}>
                            返回首页
                          </Button>
                        }
                      />
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <footer className="page-footer">
              <span>巡检台 · Web 体检工作室</span>
              <span>
                操作有记录，结论有证据。
                <span className="footer-version">v0.1.0</span>
              </span>
            </footer>
          </main>
        </div>
      </div>
      <Dialog
        open={newModal}
        onOpenChange={(open) => {
          if (!busy) setNewModal(open);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>开始一次新的 Web 体检</DialogTitle>
            <DialogDescription>
              启动独立的可见浏览器，你可以登录并按业务流程操作。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createRecording();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="record-name">体检名称</FieldLabel>
                <Input
                  id="record-name"
                  required
                  value={recordForm.name}
                  onChange={(e) =>
                    setRecordForm({ ...recordForm, name: e.target.value })
                  }
                  placeholder="例如：设备管理模块 · 回归体检"
                />
              </Field>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="project-name">工程名称</FieldLabel>
                  <Input
                    id="project-name"
                    required
                    value={recordForm.project}
                    onChange={(e) =>
                      setRecordForm({ ...recordForm, project: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="environment">环境</FieldLabel>
                  <Input
                    id="environment"
                    required
                    value={recordForm.environment}
                    onChange={(e) =>
                      setRecordForm({
                        ...recordForm,
                        environment: e.target.value,
                      })
                    }
                  />
                </Field>
              </FieldGroup>
              <Field>
                <FieldLabel htmlFor="record-url">工程地址</FieldLabel>
                <Input
                  id="record-url"
                  required
                  type="url"
                  value={recordForm.url}
                  onChange={(e) =>
                    setRecordForm({ ...recordForm, url: e.target.value })
                  }
                  placeholder="http://公司测试工程地址"
                />
                <FieldDescription>
                  填写本机可访问的完整 HTTP/HTTPS 工程地址。
                </FieldDescription>
              </Field>
            </FieldGroup>
            {activeTask && (
              <p role="status" className="small-muted mt-4">
                任务“{activeTask.name}
                ”尚未结束，请先返回执行工作台处理后再新建。
              </p>
            )}
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={busy || !!activeTask}>
                {busy ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <ScanLine data-icon="inline-start" />
                )}
                打开浏览器并录制
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={saveFlowModal}
        onOpenChange={(open) => {
          if (!busy) setSaveFlowModal(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为可复用流程</DialogTitle>
            <DialogDescription>
              后续可修改定位器、变量和断言，再用这个流程重新体检。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`/runs/${run!.id}/flow`, { name: flowName });
                setSaveFlowModal(false);
                toast.success("流程已保存，可在流程库中编辑和复检。", {
                  action: {
                    label: "前往流程库",
                    onClick: () => navigate("flows"),
                  },
                });
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="save-flow-name">流程名称</FieldLabel>
                <Input
                  id="save-flow-name"
                  required
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button disabled={busy} type="submit">
                保存流程
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!replayFlow}
        onOpenChange={(open) => {
          if (!open && !busy) setReplayFlow(undefined);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>自动复检 · {replayFlow?.name}</DialogTitle>
            <DialogDescription>
              使用 v{replayFlow?.version}{" "}
              按步骤顺序执行。输入的变量仅用于本次浏览器运行。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const r = await api<Run>(`/flows/${replayFlow!.id}/replay`, {
                  variables: replayVars,
                });
                setReplayFlow(undefined);
                setReplayVars({});
                openRun(r.id);
                toast.success("自动复检已开始。");
              });
            }}
          >
            <FieldGroup>
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2 break-all">
                <p>
                  <strong>执行目标</strong> · {replayFlow?.project}
                </p>
                <p>{replayFlow?.url}</p>
                <p className="small-muted">
                  {replayFlow?.operations.filter((op) => op.enabled).length}{" "}
                  个启用步骤 · v{replayFlow?.version}
                </p>
                <p className="text-sm">
                  复检会实际执行已保存的操作，可能重复提交或修改目标系统数据。请核对目标地址与流程内容。
                </p>
              </div>
              {activeTask && (
                <FieldDescription>
                  已有任务“{activeTask.name}”未结束，请先返回执行工作台处理。
                </FieldDescription>
              )}
              {replayFlow?.variables.length ? (
                replayFlow.variables.map((key) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`var-${key}`}>{key}</FieldLabel>
                    <Input
                      id={`var-${key}`}
                      required
                      type={
                        /password|token|secret/i.test(key) ? "password" : "text"
                      }
                      autoComplete="off"
                      value={replayVars[key] || ""}
                      onChange={(e) =>
                        setReplayVars({ ...replayVars, [key]: e.target.value })
                      }
                    />
                  </Field>
                ))
              ) : (
                <FieldDescription>
                  此流程没有待输入的变量。建议在测试环境执行。
                </FieldDescription>
              )}
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setReplayFlow(undefined)}
              >
                取消
              </Button>
              <Button disabled={busy || !!activeTask} type="submit">
                <Workflow data-icon="inline-start" />
                开始自动复检
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {editFlow && (
        <FlowEditor
          key={`${editFlow.id}@${editFlow.version}`}
          flow={editFlow}
          busy={busy}
          onClose={() => setEditFlow(undefined)}
          onSave={(f) =>
            void action(async () => {
              await api(
                `/flows/${f.id}`,
                { name: f.name, version: f.version, operations: f.operations },
                "PUT",
              );
              setEditFlow(undefined);
              toast.success("新流程版本已保存。");
            })
          }
        />
      )}
      <Dialog
        open={!!deleteRun}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteRun(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>彻底删除“{deleteRun?.name}”？</DialogTitle>
            <DialogDescription>
              将永久删除这次体检的记录、问题、分析结果，以及应用保存在本地的截图和下载文件，无法恢复。
              已保存的流程模板和手动导出到其他位置的文件不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteRun(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!deleteRun) return;
                const id = deleteRun.id;
                void action(async () => {
                  await api(`/runs/${id}`, undefined, "DELETE");
                  if (lastRunId === id) {
                    setLastRunId("");
                    sessionStorage.removeItem("last-run");
                  }
                  if (run?.id === id) setRun(undefined);
                  setDeleteRun(undefined);
                  toast.success("体检记录及对应本地文件已彻底删除。");
                });
              }}
            >
              {busy ? "正在删除…" : "确认彻底删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteFlow}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteFlow(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除流程“{deleteFlow?.name}”？</DialogTitle>
            <DialogDescription>
              流程模板将从流程库移除。已生成的体检记录仍保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteFlow(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!deleteFlow) return;
                const id = deleteFlow.id;
                void action(async () => {
                  await api(`/flows/${id}`, undefined, "DELETE");
                  setDeleteFlow(undefined);
                  toast.success("流程已删除。");
                });
              }}
            >
              删除流程
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {modelModal && (
        <ModelEditor
          profile={editModel}
          busy={busy}
          onClose={() => setModelModal(false)}
          onSave={(m) =>
            void action(async () => {
              await api("/settings/models", { ...m, id: m.id || undefined });
              setModelModal(false);
              toast.success("模型配置已保存。");
            })
          }
        />
      )}
      <Dialog
        open={!!deleteModel}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteModel(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型配置“{deleteModel?.name}”？</DialogTitle>
            <DialogDescription>
              此配置将无法用于后续分析。已有分析结果仍保留在体检记录中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteModel(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!deleteModel) return;
                const id = deleteModel.id;
                void action(async () => {
                  await api(`/settings/models/${id}`, undefined, "DELETE");
                  setDeleteModel(undefined);
                  toast.success("模型配置已删除。");
                });
              }}
            >
              删除配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster position="top-right" richColors />
    </MotionConfig>
  );
}

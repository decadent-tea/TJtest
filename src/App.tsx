import { useEffect, useState } from "react";
import { MotionConfig, motion, AnimatePresence } from "motion/react";
import {
  Activity,
  LayoutDashboard,
  ScanLine,
  Workflow,
  History,
  Archive,
  Settings2,
  AlertTriangle,
  Plus,
  ChevronRight,
  ArrowUpRight,
  Search,
  CircleHelp,
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
import { IssueCenter, type Issue } from "@/components/issues";
import { Pagination, currentPage } from "@/components/pagination";
import { Settings, ModelEditor } from "@/components/settings";
import { WorkspaceAtmosphere } from "@/components/workspace-atmosphere";
import { api, active } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Summary, Run, Flow, ModelProfile } from "../shared/types";
type Health = {
  status: string;
  demoUrl: string;
  active: { id: string; status: string }[];
};
const nav = [
  { id: "overview", label: "体检首页", icon: LayoutDashboard },
  { id: "workbench", label: "录制工作台", icon: ScanLine },
  { id: "flows", label: "流程库", icon: Workflow },
  { id: "history", label: "体检记录", icon: History },
  { id: "issues", label: "问题中心", icon: AlertTriangle },
  { id: "archive", label: "历史档案", icon: Archive },
  { id: "settings", label: "系统维护", icon: Settings2 },
];
function currentRoute() {
  return location.hash.slice(1) || "overview";
}
export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [runs, setRuns] = useState<Summary[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [health, setHealth] = useState<Health>();
  const [connectionError, setConnectionError] = useState("");
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
  const [mobileNav, setMobileNav] = useState(false);
  const recordDetail = route.startsWith("record/");
  const recordTab = recordDetail ? route.split("/")[2] || "network" : "network";
  const page = route.startsWith("run/") ? "workbench" : recordDetail ? "history" : route;
  const runId = route.startsWith("run/") || recordDetail
    ? route.split("/")[1]
    : page === "workbench"
      ? runs.some((item) => item.id === lastRunId && active(item.status)) ? lastRunId : ""
      : "";
  const navigate = (page: string) => {
    location.hash = page;
    setMobileNav(false);
  };
  useEffect(() => {
    const callback = () => {
      setRoute(currentRoute());
      setSearch("");
      setStatusFilter("all");
      setRecordsPage(0);
    };
    window.addEventListener("hashchange", callback);
    return () => window.removeEventListener("hashchange", callback);
  }, []);
  const refresh = async () => {
    try {
      const [h, r, f, m, i] = await Promise.all([
        api<Health>("/health"),
        api<Summary[]>("/runs"),
        api<Flow[]>("/flows"),
        api<ModelProfile[]>("/settings/models"),
        api<Issue[]>("/issues"),
      ]);
      setHealth(h);
      setRuns(r);
      setFlows(f);
      setModels(m);
      setIssues(i);
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
    if (!runId) return;
    let disposed = false;
    const load = async () => {
      try {
        const r = await api<Run>(`/runs/${runId}`);
        if (!disposed) {
          setRun(r);
          if (location.hash === `#run/${runId}` && !active(r.status))
            location.hash = `record/${runId}`;
        }
      } catch (e) {
        if (!disposed)
          toast.error(e instanceof Error ? e.message : "记录无法读取");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1800);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [runId]);
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  };
  const openRun = (id: string) => {
    setLastRunId(id);
    sessionStorage.setItem("last-run", id);
    navigate(`run/${id}`);
  };
  const openRecord = (id: string) => navigate(`record/${id}`);
  const newRecording = (demo = false) => {
    setRecordForm(
      demo
        ? {
            name: "设备与告警 · 演示体检",
            project: "智能化系统演示工程",
            environment: "演示环境",
            url: health?.demoUrl || "http://127.0.0.1:4318/demo",
          }
        : { name: "", project: "", environment: "测试环境", url: "" },
    );
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
  const title = nav.find((n) => n.id === page)?.label || "体检首页";
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
  const shownRecordsPage = currentPage(recordsPage, filteredRuns.length, recordsPageSize);
  const pageRuns = filteredRuns.slice(shownRecordsPage * recordsPageSize, (shownRecordsPage + 1) * recordsPageSize);
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
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
                className={cn("nav-item", page === item.id && "nav-active")}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === "history" && historyCount > 0 && (
                  <span className="nav-count">{historyCount}</span>
                )}
                {page === item.id && (
                  <motion.span
                    className="nav-marker"
                    layoutId="navigation-indicator"
                    transition={{ type: "spring", stiffness: 400, damping: 38 }}
                  />
                )}
              </Button>
              {item.id === "history" && recordDetail && [
                ["network", "操作与接口"], ["console", "Console"], ["screen", "录制画面"], ["report", "分析与用例"],
              ].map(([key, label]) => (
                <Button key={key} variant="ghost" className={cn("nav-item", "nav-subitem", recordTab === key && "nav-active")}
                  onClick={() => navigate(`record/${runId}/${key}`)} aria-current={recordTab === key ? "page" : undefined}>
                  <ChevronRight size={15} /><span>{label}</span>
                </Button>
              ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="agent-status">
              <Monitor size={18} />
              <div>
                <strong>{health ? "执行器已连接" : "执行器连接中"}</strong>
                <small>
                  {activeTask ? "有活动任务" : "准备就绪 · Chromium"}
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
              <span>北斗天地 / 工作空间</span>
              <ChevronRight size={14} />
              <strong>{title}</strong>
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
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href="/demo"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="打开演示工程"
                >
                  <CircleHelp />
                </a>
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
                  {activeTask.name} 正在
                  {activeTask.mode === "record" ? "录制" : "复检"}
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
                {page === "overview" && (
                  <Overview
                    runs={runs}
                    flows={flows}
                    onNew={newRecording}
                    onOpen={(id) => runs.some((item) => item.id === id && active(item.status)) ? openRun(id) : openRecord(id)}
                    onPage={navigate}
                  />
                )}
                {page === "workbench" && (
                  <Workbench
                    key={runId || "empty"}
                    run={run}
                    models={models}
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
                {recordDetail && page === "history" && (
                  <Workbench key={`record-${runId}`} run={run} models={models} busy={busy} readOnly
                    initialTab={recordTab} onTabChange={(tab) => navigate(`record/${runId}/${tab}`)}
                    onNew={() => newRecording()} onAction={(name, body) => void action(async () => {
                      const updated = await api<Run>(`/runs/${runId}/${name}`, body || {});
                      setRun(updated);
                      toast.success(name === "analysis/cancel" ? "分析已停止，已完成批次保留。" : name.startsWith("requests/") ? "接口业务描述已保存。" : "记录已更新。");
                    })} onSaveFlow={() => {
                      setFlowName(run?.name || "");
                      setSaveFlowModal(true);
                    }}
                    onAnalyze={(id) => void action(async () => {
                      await api(`/runs/${runId}/analyze`, { profileId: id });
                      setRun(await api(`/runs/${runId}`));
                      toast.success("分析已开始，完成后会显示结果。");
                    })} />
                )}
                {!recordDetail && ["history", "archive"].includes(page) && (
                  <>
                    <PageTitle
                      eyebrow={`RECORDS / ${page === "archive" ? "ARCHIVE" : "HISTORY"}`}
                      title={page === "archive" ? "历史档案" : "体检记录"}
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
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          {page === "archive" ? "已归档记录" : "全部体检记录"}
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
                              onChange={(e) => { setSearch(e.target.value); setRecordsPage(0); }}
                            />
                          </div>
                          <Select
                            value={statusFilter}
                            onValueChange={(value) => { setStatusFilter(value); setRecordsPage(0); }}
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="all">全部状态</SelectItem>
                                <SelectItem value="RECORDING">
                                  正在录制
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
                        {filteredRuns.length ? (
                          <RunTable runs={pageRuns} onOpen={openRecord} actions={(r) => !active(r.status) && (
                            <>
                              <Button variant="ghost" size="sm" disabled={busy}
                                onClick={() => void action(async () => {
                                  await api(`/runs/${r.id}/archive`, {});
                                  toast.success(r.archived ? "已移出归档。" : "已归档。");
                                })}>
                                {r.archived ? "移出归档" : "归档记录"}
                              </Button>
                              {r.archived && <Button variant="destructive" size="sm"
                                disabled={busy || r.analysisStatus === "RUNNING"}
                                title={r.analysisStatus === "RUNNING" ? "请先停止模型分析" : undefined}
                                onClick={() => setDeleteRun(r)}>彻底删除</Button>}
                            </>
                          )} />
                        ) : (
                          <Blank
                            title={
                              page === "archive"
                                ? "暂无归档记录"
                                : "暂无匹配记录"
                            }
                            description={
                              page === "archive"
                                ? "完成体检后，在体检记录中归档，将报告与证据留存。"
                                : "开始第一次体检，或调整搜索条件。"
                            }
                          />
                        )}
                        <Pagination total={filteredRuns.length} page={shownRecordsPage}
                          pageSize={recordsPageSize} onPageChange={setRecordsPage}
                          onPageSizeChange={(size) => { setRecordsPageSize(size); setRecordsPage(0); }} />
                      </CardContent>
                    </Card>
                  </>
                )}
                {page === "issues" && (
                  <IssueCenter issues={issues} busy={busy} onOpen={openRecord}
                    onSave={(issue, disposition, note) => void action(async () => {
                      await api(`/issues/${issue.runId}/${issue.id}`, { disposition, note }, "PUT");
                      toast.success("问题已更新。");
                    })}
                    onDelete={(issue) => void action(async () => {
                      await api(`/issues/${issue.runId}/${issue.id}`, undefined, "DELETE");
                      toast.success("问题已删除。");
                    })} />
                )}
                {page === "settings" && (
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
                        toast.success(`连接成功，耗时 ${result.duration}ms。`);
                      })
                    }
                  />
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
      <Dialog open={newModal} onOpenChange={setNewModal}>
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
                  也可以先使用演示工程，熟悉录制和回放。
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => newRecording(true)}
              >
                使用演示工程
              </Button>
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
      <Dialog open={saveFlowModal} onOpenChange={setSaveFlowModal}>
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
                toast.success("流程已保存，可在流程库中编辑和复检。");
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
          if (!open) setReplayFlow(undefined);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>再次体检 · {replayFlow?.name}</DialogTitle>
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
      <Dialog open={!!deleteRun} onOpenChange={(open) => { if (!open && !busy) setDeleteRun(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>彻底删除“{deleteRun?.name}”？</DialogTitle>
            <DialogDescription>
              将永久删除这次体检的记录、问题、分析结果，以及应用保存在本地的截图和下载文件，无法恢复。
              已保存的流程模板和手动导出到其他位置的文件不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteRun(undefined)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={() => {
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
            }}>{busy ? "正在删除…" : "确认彻底删除"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleteFlow} onOpenChange={(open) => { if (!open) setDeleteFlow(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除流程“{deleteFlow?.name}”？</DialogTitle>
            <DialogDescription>流程模板将从流程库移除。已生成的体检记录仍保留。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFlow(undefined)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={() => {
              if (!deleteFlow) return;
              const id = deleteFlow.id;
              void action(async () => {
                await api(`/flows/${id}`, undefined, "DELETE");
                setDeleteFlow(undefined);
                toast.success("流程已删除。");
              });
            }}>删除流程</Button>
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
      <Dialog open={!!deleteModel} onOpenChange={(open) => { if (!open) setDeleteModel(undefined); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>删除模型配置“{deleteModel?.name}”？</DialogTitle>
            <DialogDescription>此配置将无法用于后续分析。已有分析结果仍保留在体检记录中。</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteModel(undefined)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={() => {
              if (!deleteModel) return;
              const id = deleteModel.id;
              void action(async () => {
                await api(`/settings/models/${id}`, undefined, "DELETE");
                setDeleteModel(undefined);
                toast.success("模型配置已删除。");
              });
            }}>删除配置</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster position="top-right" richColors />
    </MotionConfig>
  );
}

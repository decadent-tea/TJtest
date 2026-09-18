import {
  finalFindings,
  riskSummary,
  analysisNarrative,
} from "../../server/evidence-quality";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Pause,
  Play,
  Square,
  Save,
  BrainCircuit,
  Download,
  Flag,
  Globe2,
  MousePointer2,
  Terminal,
  Image,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { caseView } from "../../server/case-view";
import {
  findingHasRelevantEvidence,
  isBelowPerformanceThreshold,
} from "../../server/evidence-quality";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { StateBadge, PageTitle, Blank } from "./studio";
import { Pagination, currentPage } from "./pagination";
import { active, time } from "@/lib/api";
import { cn } from "@/lib/utils";
import { downloadName } from "../../server/download-name";
import type {
  Run,
  ModelProfile,
  NetworkCall,
  Finding,
} from "../../shared/types";

const findingCategory: Record<NonNullable<Finding["category"]>, string> = {
  functional: "功能流程",
  interface: "接口",
  frontend: "前端",
  performance: "性能观察",
  security: "安全",
  data: "数据",
  usability: "易用性",
  stability: "稳定性",
};
const confidenceLabel = { high: "高", medium: "中", low: "低" };

export function Workbench({
  run,
  models,
  busy,
  onAction,
  onSaveFlow,
  onAnalyze,
  onNew,
  readOnly = false,
  initialTab = "network",
  onTabChange,
}: {
  run: Run | undefined;
  models: ModelProfile[];
  busy: boolean;
  onAction: (action: string, body?: unknown) => void;
  onSaveFlow: () => void;
  onAnalyze: (id: string) => void;
  onNew: () => void;
  readOnly?: boolean;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const changeTab = (value: string) => {
    setTab(value);
    onTabChange?.(value);
  };
  const [inspected, setInspected] = useState<NetworkCall>();
  const [filter, setFilter] = useState("");
  const [onlyStep, setOnlyStep] = useState(false);
  const [page, setPage] = useState(0);
  const [networkPageSize, setNetworkPageSize] = useState(10);
  const [logPage, setLogPage] = useState(0);
  const [logPageSize, setLogPageSize] = useState(10);
  const [findingPage, setFindingPage] = useState(0);
  const [findingPageSize, setFindingPageSize] = useState(10);
  const [casePage, setCasePage] = useState(0);
  const [casePageSize, setCasePageSize] = useState(10);
  const [notePage, setNotePage] = useState(0);
  const [notePageSize, setNotePageSize] = useState(10);
  const [sceneModal, setSceneModal] = useState(false);
  const [scene, setScene] = useState("");
  const [modelId, setModelId] = useState("");
  const [reportDownloading, setReportDownloading] = useState(false);
  useEffect(() => {
    const available = models.filter((m) => m.enabled && m.hasKey);
    const selected = available.find(
      (m) =>
        m.provider === run?.analysis.provider &&
        m.model === run?.analysis.model,
    );
    if (run?.analysis.status === "RUNNING" && selected) setModelId(selected.id);
    else if (!modelId && (selected || available[0]))
      setModelId((selected || available[0]).id);
  }, [
    models,
    modelId,
    run?.analysis.provider,
    run?.analysis.model,
    run?.analysis.status,
  ]);
  const [dialogInput, setDialogInput] = useState("");
  const operation = run?.operations.find((o) => o.id === selected);
  const requests = useMemo(
    () =>
      run?.requests.filter(
        (r) =>
          (!onlyStep || !selected || r.stepId === selected) &&
          `${r.url} ${r.description} ${r.module} ${r.status || ""}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
      ) || [],
    [run, onlyStep, selected, filter],
  );
  const logs =
    run?.logs.filter((l) => !onlyStep || !selected || l.stepId === selected) ||
    [];
  const findings = (run ? finalFindings(run) : []).filter(
    (f) =>
      !f.deleted &&
      !!run &&
      findingHasRelevantEvidence(run, f) &&
      !isBelowPerformanceThreshold(run, f),
  );
  const highFindings = findings.filter((finding) => finding.severity === "high");
  const downloadReport = async () => {
    if (!run || reportDownloading) return;
    setReportDownloading(true);
    try {
      const response = await fetch(`/api/runs/${run.id}/report`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "报告生成失败。");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(run, "report");
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "报告下载失败。");
    } finally {
      setReportDownloading(false);
    }
  };
  const networkPage = currentPage(page, requests.length, networkPageSize);
  const shownLogPage = currentPage(logPage, logs.length, logPageSize);
  const shownFindingPage = currentPage(
    findingPage,
    findings.length,
    findingPageSize,
  );
  const shownCasePage = currentPage(
    casePage,
    run?.cases.length || 0,
    casePageSize,
  );
  const shownNotePage = currentPage(
    notePage,
    run?.notes.length || 0,
    notePageSize,
  );
  const jump = (finding: Finding) => {
    const op = run?.operations.find((o) => finding.evidenceIds.includes(o.id));
    const req = run?.requests.find((r) => finding.evidenceIds.includes(r.id));
    const log = run?.logs.find((l) => finding.evidenceIds.includes(l.id));
    const targetStepId = op?.id || req?.stepId || log?.stepId;
    setSelected(targetStepId);
    if (req) {
      changeTab("network");
      setInspected(req);
    } else if (log) {
      const targetStep = op?.id || log.stepId;
      const matchingLogs =
        run?.logs.filter(
          (item) => !onlyStep || !targetStep || item.stepId === targetStep,
        ) || [];
      setLogPage(
        Math.max(
          0,
          Math.floor(
            matchingLogs.findIndex((item) => item.id === log.id) / logPageSize,
          ),
        ),
      );
      changeTab("console");
    } else changeTab("screen");
  };
  if (!run)
    return (
      <>
        <PageTitle
          eyebrow={readOnly ? "RECORD / DETAIL" : "RECORD / WORKBENCH"}
          title={readOnly ? "体检记录详情" : "录制工作台"}
          description={
            readOnly
              ? "查看操作、接口、Console 与分析结果。"
              : "浏览器中的操作和证据，在这里汇聚。"
          }
        />
        <Card>
          <CardContent>
            <Blank
              title="还没有打开体检任务"
              description={
                readOnly
                  ? "这条体检记录暂不可用。"
                  : "新建录制任务；历史证据请在体检记录查看。"
              }
              action={<Button onClick={onNew}>开始新体检</Button>}
            />
          </CardContent>
        </Card>
      </>
    );
  const live = active(run.status);
  return (
    <>
      <PageTitle
        eyebrow={
          readOnly
            ? "HISTORY / RECORD DETAIL"
            : `${run.mode === "record" ? "RECORD" : "REPLAY"} / WORKBENCH`
        }
        title={run.name}
        description={`${run.project} · ${run.environment} · ${time(run.startedAt)}`}
        actions={
          <>
            <StateBadge status={run.status} />
            {live && !readOnly ? (
              <>
                <Button
                  disabled={busy || run.mode === "replay"}
                  variant="outline"
                  onClick={() => onAction("pause")}
                >
                  {run.status === "PAUSED" ? (
                    <Play data-icon="inline-start" />
                  ) : (
                    <Pause data-icon="inline-start" />
                  )}
                  {run.status === "PAUSED" ? "恢复录制" : "暂停采集"}
                </Button>
                <Button
                  disabled={busy}
                  variant="destructive"
                  onClick={() => onAction("stop")}
                >
                  <Square data-icon="inline-start" />
                  {run.mode === "replay" ? "中止复检" : "结束录制"}
                </Button>
              </>
            ) : (
              <>
                {run.mode === "record" && (
                  <Button variant="secondary" onClick={onSaveFlow}>
                    <Save data-icon="inline-start" />
                    保存为流程
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <a href={`/api/runs/${run.id}/cases.xlsx`}>
                    <Download data-icon="inline-start" />
                    导出用例
                  </a>
                </Button>
                <Button variant="feature" disabled={reportDownloading} onClick={() => void downloadReport()}>
                  <Download data-icon="inline-start" />
                  {reportDownloading ? "正在生成报告…" : "体检报告"}
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="session-strip">
        <div>
          <Globe2 size={17} />
          <span className="truncate">{run.url}</span>
        </div>
        <div>
          <span className={cn("signal-dot", !live && "signal-idle")} />
          {live ? "本机浏览器会话" : "执行证据已保存"}
          <Badge variant="outline">{run.operations.length} 步骤</Badge>
          <Badge variant="outline">{run.requests.length} 请求</Badge>
          <Badge variant="outline">{run.logs.length} 日志</Badge>
          {run.mode === "record" && live && !readOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScene("");
                setSceneModal(true);
              }}
            >
              <Flag data-icon="inline-start" />
              新场景
            </Button>
          )}
        </div>
      </div>
      {live && !readOnly && (
        <Alert>
          <MousePointer2 />
          <AlertTitle>
            {run.mode === "record"
              ? "请在已打开的 Chromium 浏览器中操作"
              : "正在按保存的流程执行"}
          </AlertTitle>
          <AlertDescription>
            {run.mode === "record"
              ? "这里会同步更新操作和证据。切换独立业务模块时，可以点击“新场景”标记边界。"
              : "独立步骤失败后继续；关键步骤失败会阻塞当前场景，随后继续下一个场景。"}
          </AlertDescription>
        </Alert>
      )}
      {run.pendingDialog && !readOnly && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            浏览器等待处理 {run.pendingDialog.type} 对话框
          </AlertTitle>
          <AlertDescription>
            <p>{run.pendingDialog.message}</p>
            {run.pendingDialog.type === "prompt" && (
              <Input
                aria-label="浏览器对话框输入"
                value={dialogInput}
                onChange={(e) => setDialogInput(e.target.value)}
                className="my-3"
              />
            )}
            <div className="flex gap-2 mt-3">
              <Button
                disabled={busy}
                size="sm"
                onClick={() => {
                  onAction("dialog", { accepted: true, input: dialogInput });
                  setDialogInput("");
                }}
              >
                确认并记录
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                size="sm"
                onClick={() => onAction("dialog", { accepted: false })}
              >
                取消并记录
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <div className="workbench-grid">
        <Card className="timeline-card">
          <CardHeader>
            <CardTitle>操作路径</CardTitle>
            <CardDescription>{run.scene} · 按发生顺序记录</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="timeline">
              {run.operations.length ? (
                run.operations.map((op, i) => (
                  <button
                    key={op.id}
                    onClick={() => {
                      setSelected(op.id);
                      setInspected(undefined);
                    }}
                    className={cn(
                      "timeline-item",
                      selected === op.id && "is-selected",
                    )}
                  >
                    <span
                      className={cn(
                        "step-index",
                        op.status === "FAILED" && "failed-index",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="step-copy">
                      <strong>{op.label}</strong>
                      <small>
                        {op.scene} / {op.module}
                      </small>
                      <StateBadge status={op.status} />
                    </span>
                  </button>
                ))
              ) : (
                <p className="small-muted py-10 text-center">
                  等待第一次页面操作…
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="evidence-main">
          {operation && (
            <div className="selected-operation">
              <div>
                <div className="eyebrow">
                  STEP {operation.sequence.toString().padStart(2, "0")}
                </div>
                <h3>{operation.label}</h3>
                <p>
                  {operation.module} · {operation.pageId}
                  {operation.framePath.length ? " · iframe" : ""}
                </p>
                {operation.error && (
                  <p className="issue-text">{operation.error.split("\n")[0]}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(undefined);
                  setOnlyStep(false);
                }}
              >
                显示全部证据
              </Button>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>执行证据</CardTitle>
              <CardDescription>
                关联操作、接口和错误，定位问题发生的位置。
              </CardDescription>
              <CardAction>
                <Button
                  size="sm"
                  variant={onlyStep ? "secondary" : "outline"}
                  disabled={!selected}
                  onClick={() => {
                    setOnlyStep(!onlyStep);
                    setPage(0);
                  }}
                >
                  {onlyStep ? "仅所选步骤" : "全部步骤"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={changeTab}>
                <TabsList>
                  <TabsTrigger value="network">
                    <Globe2 />
                    接口 {requests.length}
                  </TabsTrigger>
                  <TabsTrigger value="console">
                    <Terminal />
                    日志 {logs.length}
                  </TabsTrigger>
                  <TabsTrigger value="screen">
                    <Image />
                    画面
                  </TabsTrigger>
                  <TabsTrigger value="report">
                    <BrainCircuit />
                    分析与用例
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="network">
                  <div className="evidence-toolbar">
                    <Input
                      aria-label="搜索接口"
                      placeholder="搜索接口描述、模块、URL 或状态码…"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(0);
                      }}
                    />
                    <span className="small-muted">
                      正常资源与后台请求过滤，重复项合并计数
                    </span>
                  </div>
                  {requests.length ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>业务描述 / 请求</TableHead>
                            <TableHead>方法</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>耗时</TableHead>
                            <TableHead>归属</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {requests
                            .slice(
                              networkPage * networkPageSize,
                              networkPage * networkPageSize + networkPageSize,
                            )
                            .map((req) => (
                              <TableRow
                                key={req.id}
                                className="cursor-pointer"
                                onClick={() => setInspected(req)}
                              >
                                <TableCell>
                                  <button
                                    className="table-name"
                                    onClick={() => setInspected(req)}
                                  >
                                    {req.description}
                                  </button>
                                  <div className="request-url">{req.url}</div>
                                  <small>出现 {req.occurrences || 1} 次</small>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">{req.method}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      req.failure ||
                                      (req.status && req.status >= 400)
                                        ? "destructive"
                                        : "secondary"
                                    }
                                  >
                                    {req.failure
                                      ? "失败"
                                      : req.status || "进行中"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="tabular">
                                  {req.duration !== undefined
                                    ? `${req.maxDuration ?? req.duration}ms`
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="small-muted">
                                    {req.module}
                                  </div>
                                  <small className="small-muted">
                                    {Math.round(req.confidence * 100)}% ·{" "}
                                    {
                                      {
                                        business: "动作关联",
                                        background: "后台",
                                        resource: "资源",
                                        initialization: "初始化",
                                      }[req.category]
                                    }
                                  </small>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      <Pagination
                        total={requests.length}
                        page={networkPage}
                        pageSize={networkPageSize}
                        onPageChange={setPage}
                        onPageSizeChange={(size) => {
                          setNetworkPageSize(size);
                          setPage(0);
                        }}
                      />
                    </>
                  ) : (
                    <Blank
                      title="暂无匹配的网络请求"
                      description="请求发起后会显示在这里，也可以调整搜索条件。"
                    />
                  )}
                </TabsContent>
                <TabsContent value="console">
                  <div className="console-view">
                    {logs.length ? (
                      logs
                        .slice(
                          shownLogPage * logPageSize,
                          (shownLogPage + 1) * logPageSize,
                        )
                        .map((log) => (
                          <div
                            key={log.id}
                            className={cn(
                              "console-row",
                              [
                                "error",
                                "pageerror",
                                "unhandledrejection",
                              ].includes(log.level) && "console-error",
                            )}
                          >
                            <span className="console-time">
                              {new Date(log.timestamp).toLocaleTimeString(
                                "zh-CN",
                              )}
                            </span>
                            <Badge
                              variant={
                                ["error", "pageerror"].includes(log.level)
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {log.level}
                            </Badge>
                            <pre>
                              {log.text}
                              <small>出现 {log.occurrences || 1} 次</small>
                            </pre>
                            <small>{log.location}</small>
                          </div>
                        ))
                    ) : (
                      <Blank
                        title="暂无控制台日志"
                        description="Console、页面错误和 WebSocket 生命周期会记录在这里。"
                      />
                    )}
                  </div>
                  <Pagination
                    total={logs.length}
                    page={shownLogPage}
                    pageSize={logPageSize}
                    onPageChange={setLogPage}
                    onPageSizeChange={(size) => {
                      setLogPageSize(size);
                      setLogPage(0);
                    }}
                  />
                </TabsContent>
                <TabsContent value="screen">
                  {operation?.screenshot ||
                  run.operations.at(-1)?.screenshot ? (
                    <div className="screen-evidence">
                      <img
                        src={
                          operation?.screenshot ||
                          run.operations.at(-1)?.screenshot
                        }
                        alt="所选操作之后的浏览器画面"
                      />
                      <p className="small-muted">
                        动作后的可用画面 · 密码输入框已遮盖 · 点击坐标{" "}
                        {operation?.position
                          ? `${Math.round(operation.position.x)}, ${Math.round(operation.position.y)}`
                          : "—"}
                      </p>
                      {operation && (
                        <pre className="code-panel">
                          {JSON.stringify(
                            {
                              locators: operation.locators,
                              framePath: operation.framePath,
                              variable: operation.variable,
                              position: operation.position,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <Blank
                      title="暂无可用截图"
                      description="动作后的画面会保存为证据；页面导航期间截图可能不可用。"
                    />
                  )}
                </TabsContent>
                <TabsContent value="report">
                  <div className="analysis-controls">
                    <Select
                      value={modelId}
                      onValueChange={setModelId}
                      disabled={run.analysis.status === "RUNNING"}
                    >
                      <SelectTrigger className="w-60">
                        <SelectValue placeholder="选择分析模型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {models
                            .filter((m) => m.enabled && m.hasKey)
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name} · {m.model}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={
                        live ||
                        busy ||
                        !modelId ||
                        run.analysis.status === "RUNNING"
                      }
                      onClick={() => onAnalyze(modelId)}
                    >
                      <BrainCircuit data-icon="inline-start" />
                      {run.analysis.status === "RUNNING"
                        ? "正在分析"
                        : run.analysis.status === "FAILED" && run.analysis.jobId
                          ? "继续未完成分析"
                          : "AI 分析本次体检"}
                    </Button>
                    {run.analysis.status === "RUNNING" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => onAction("analysis/cancel")}
                      >
                        <Square data-icon="inline-start" />
                        停止分析
                      </Button>
                    )}
                  </div>
                  <p className="small-muted mb-4">
                    结束录制或复检后，手动点击分析。需先在系统维护配置模型。AI 合并重复证据后最多并行分析 3
                    批，并按业务流程、接口链路、前端异常和数据风险生成带事实、影响、复现、原因、处置及验证建议的报告。原始记录全部保留；不可用时，规则发现和执行用例仍可查看。
                  </p>
                  {run.analysis.progress && (
                    <div
                      className="analysis-summary"
                      role="status"
                      aria-live="polite"
                    >
                      <h3>
                        {run.analysis.status === "RUNNING"
                          ? run.analysis.progress.phase === "summary"
                            ? "证据分析完成，正在汇总体检报告"
                            : "正在分批分析体检证据"
                          : "证据分析进度"}
                      </h3>
                      <div
                        className="analysis-progress"
                        role="progressbar"
                        aria-label="已完成证据批次"
                        aria-valuemin={0}
                        aria-valuemax={Math.max(1, run.analysis.progress.total)}
                        aria-valuenow={run.analysis.progress.completed}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, (run.analysis.progress.completed / Math.max(1, run.analysis.progress.total)) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="small-muted">
                        已完成 {run.analysis.progress.completed} /{" "}
                        {run.analysis.progress.total} 批 · 已处理{" "}
                        {run.analysis.progress.processedRecords} /{" "}
                        {run.analysis.progress.totalRecords} 条证据
                        {run.analysis.progress.resumed &&
                          " · 已恢复之前完成的批次"}
                      </p>
                      {run.analysis.status === "RUNNING" &&
                        !!run.analysis.activeRequests?.length && (
                          <div className="analysis-activity-list">
                            {run.analysis.activeRequests.map((request) => (
                              <div
                                key={`${request.batch}-${request.requestStartedAt}`}
                              >
                                <strong>{request.label}</strong>
                                <span>
                                  本次请求已等待{" "}
                                  {Math.max(
                                    0,
                                    Math.floor(
                                      (Date.now() -
                                        Date.parse(request.requestStartedAt)) /
                                        1000,
                                    ),
                                  )}{" "}
                                  秒 · 第 {request.attempt} 次尝试 · 已接收{" "}
                                  {request.receivedCharacters} 字符
                                  {request.reasoningCharacters > 0
                                    ? ` · 思考输出 ${request.reasoningCharacters} 字符`
                                    : ""}
                                </span>
                                {request.lastError && (
                                  <span>{request.lastError}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      {run.analysis.coverage && (
                        <small>
                          覆盖 {run.analysis.coverage.steps} 个步骤、
                          {run.analysis.coverage.requests} 次接口调用、
                          {run.analysis.coverage.logs} 条日志。
                          静态资源在采集入口过滤，不发送给 AI；长正文采用摘要。
                          {run.analysis.coverage.analysisRecords !==
                            undefined &&
                            ` 合并后 ${run.analysis.coverage.analysisRecords} 项分析证据，减少 ${run.analysis.coverage.groupedRecords || 0} 条重复/同类输入。`}
                        </small>
                      )}
                    </div>
                  )}
                  {!!run.analysis.warnings?.length && (
                    <Alert>
                      <AlertTriangle />
                      <AlertTitle>分析说明</AlertTitle>
                      <AlertDescription>
                        {run.analysis.warnings.map((warning, index) => (
                          <p key={index}>{warning}</p>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                  {run.analysis.error && (
                    <Alert variant="destructive">
                      <AlertTriangle />
                      <AlertTitle>AI 分析未完成</AlertTitle>
                      <AlertDescription>{run.analysis.error}</AlertDescription>
                    </Alert>
                  )}
                  {run.analysis.summary && (
                    <div className="analysis-summary">
                      <h3>AI 分析摘要</h3>
                      <p>{riskSummary(run)}</p>
                      <p>{analysisNarrative(run)}</p>
                      {!!highFindings.length && (
                        <div className="high-risk-summary">
                          <h4>高风险内容</h4>
                          <ol>
                            {highFindings.map((finding) => (
                              <li key={finding.id}>
                                <strong>{finding.title}</strong>
                                <span>{finding.module}</span>
                                <p>{finding.observation || finding.detail}</p>
                                {finding.impact && <p>业务影响：{finding.impact}</p>}
                                {finding.suggestion && <p>处置建议：{finding.suggestion}</p>}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <small>
                        {run.analysis.provider} / {run.analysis.model} ·{" "}
                        {time(run.analysis.generatedAt)}
                      </small>
                    </div>
                  )}
                  <div className="section-line">
                    <h3>风险问题</h3>
                    <Badge variant="secondary">{findings.length}</Badge>
                  </div>
                  {findings
                    .slice(
                      shownFindingPage * findingPageSize,
                      (shownFindingPage + 1) * findingPageSize,
                    )
                    .map((f) => (
                      <div className="finding-card" key={f.id}>
                        <div>
                          <StateBadge status={f.severity} />
                          <Badge variant="outline">
                            {f.source === "ai" ? "AI 分析" : "规则发现"}
                          </Badge>
                          <strong>{f.title}</strong>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => jump(f)}
                          >
                            定位证据
                            <ArrowUpRight data-icon="inline-end" />
                          </Button>
                        </div>
                        <small>{f.module}</small>
                        {f.category && (
                          <div className="finding-meta">
                            <Badge variant="secondary">
                              {findingCategory[f.category]}
                            </Badge>
                            {f.confidence && (
                              <span>
                                结论置信度：{confidenceLabel[f.confidence]}
                              </span>
                            )}
                          </div>
                        )}
                        {f.observation ? (
                          <div className="finding-detail-grid">
                            <section>
                              <h4>观察事实</h4>
                              <p>{f.observation}</p>
                            </section>
                            <section>
                              <h4>业务影响</h4>
                              <p>{f.impact}</p>
                            </section>
                            <section>
                              <h4>复现路径</h4>
                              {f.reproductionSteps?.length ? (
                                <ol>
                                  {f.reproductionSteps.map((step, index) => (
                                    <li key={index}>{step}</li>
                                  ))}
                                </ol>
                              ) : (
                                <p>请通过“定位证据”查看关联操作。</p>
                              )}
                            </section>
                            <section>
                              <h4>原因判断</h4>
                              <p>{f.possibleCause}</p>
                            </section>
                            <section>
                              <h4>处置建议</h4>
                              <p>{f.suggestion}</p>
                            </section>
                            <section>
                              <h4>验证建议</h4>
                              {f.validationSteps?.length ? (
                                <ol>
                                  {f.validationSteps.map((step, index) => (
                                    <li key={index}>{step}</li>
                                  ))}
                                </ol>
                              ) : (
                                <p>结合关联证据和业务预期补充断言。</p>
                              )}
                            </section>
                          </div>
                        ) : (
                          <>
                            <p>{f.detail}</p>
                            {f.suggestion && (
                              <p className="small-muted">
                                建议：{f.suggestion}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  <Pagination
                    total={findings.length}
                    page={shownFindingPage}
                    pageSize={findingPageSize}
                    onPageChange={setFindingPage}
                    onPageSizeChange={(size) => {
                      setFindingPageSize(size);
                      setFindingPage(0);
                    }}
                  />
                  {!findings.length && (
                    <p className="small-muted p-5">
                      未发现规则命中的异常；不代表业务功能全部通过。
                    </p>
                  )}
                  <div className="section-line">
                    <h3>本次执行用例</h3>
                    <span className="small-muted">
                      通过表示本步操作目标达成
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>操作</TableHead>
                        <TableHead>接口 / Console</TableHead>
                        <TableHead>是否通过</TableHead>
                        <TableHead>问题描述 / 解决方案</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.cases
                        .slice(
                          shownCasePage * casePageSize,
                          (shownCasePage + 1) * casePageSize,
                        )
                        .map((c) => {
                          const view = caseView(run, c);
                          return (
                            <TableRow key={c.id}>
                              <TableCell>
                                <strong>{c.title}</strong>
                                <p>{view.operation}</p>
                              </TableCell>
                              <TableCell>
                                <p>{view.interface}</p>
                                <p className="small-muted">{view.console}</p>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{view.result}</Badge>
                              </TableCell>
                              <TableCell>
                                <p>{view.problem}</p>
                                <p className="small-muted">
                                  建议：{view.solution}
                                </p>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  <Pagination
                    total={run.cases.length}
                    page={shownCasePage}
                    pageSize={casePageSize}
                    onPageChange={setCasePage}
                    onPageSizeChange={(size) => {
                      setCasePageSize(size);
                      setCasePage(0);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <details className="capture-notes">
            <summary>采集范围与说明（{run.notes.length}）</summary>
            {run.notes
              .slice(
                shownNotePage * notePageSize,
                (shownNotePage + 1) * notePageSize,
              )
              .map((note, i) => (
                <p key={shownNotePage * notePageSize + i}>{note}</p>
              ))}
            <Pagination
              total={run.notes.length}
              page={shownNotePage}
              pageSize={notePageSize}
              onPageChange={setNotePage}
              onPageSizeChange={(size) => {
                setNotePageSize(size);
                setNotePage(0);
              }}
            />
          </details>
        </div>
      </div>
      <Dialog open={sceneModal} onOpenChange={setSceneModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>标记新业务场景</DialogTitle>
            <DialogDescription>
              后续操作归入新场景。复检时按场景边界处理失败。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAction("scene", { scene });
              setSceneModal(false);
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="scene-name">场景名称</FieldLabel>
                <Input
                  id="scene-name"
                  required
                  value={scene}
                  onChange={(e) => setScene(e.target.value)}
                  placeholder="例如：历史告警查询与导出"
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button type="submit" disabled={busy}>
                开始记录该场景
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!inspected}
        onOpenChange={(open) => {
          if (!open) setInspected(undefined);
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inspected?.description}</DialogTitle>
            <DialogDescription>
              {inspected?.module} · 归属置信度{" "}
              {Math.round((inspected?.confidence || 0) * 100)}%（规则推断）
            </DialogDescription>
          </DialogHeader>
          {inspected && (
            <>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="request-description">
                    接口业务描述
                  </FieldLabel>
                  <Input
                    id="request-description"
                    value={inspected.description}
                    onChange={(event) =>
                      setInspected({
                        ...inspected,
                        description: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="request-module">
                    所属菜单 / 模块
                  </FieldLabel>
                  <Input
                    id="request-module"
                    value={inspected.module}
                    onChange={(event) =>
                      setInspected({ ...inspected, module: event.target.value })
                    }
                  />
                </Field>
              </FieldGroup>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    busy ||
                    !inspected.description.trim() ||
                    !inspected.module.trim()
                  }
                  onClick={() =>
                    onAction(`requests/${inspected.id}`, {
                      description: inspected.description,
                      module: inspected.module,
                    })
                  }
                >
                  保存描述
                </Button>
              </div>
              <div className="request-title">
                <Badge variant="outline">{inspected.method}</Badge>
                <code>{inspected.url}</code>
                <Badge
                  variant={
                    inspected.status && inspected.status >= 400
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {inspected.status || inspected.failure || "未结束"}
                </Badge>
              </div>
              {inspected.bodyNote && (
                <p className="small-muted">{inspected.bodyNote}</p>
              )}
              <div className="payload-grid">
                <div>
                  <h3>请求头</h3>
                  <pre className="code-panel">
                    {JSON.stringify(inspected.requestHeaders, null, 2)}
                  </pre>
                  <h3>请求正文</h3>
                  <pre className="code-panel">
                    {inspected.requestBody || "无请求正文"}
                  </pre>
                </div>
                <div>
                  <h3>响应头</h3>
                  <pre className="code-panel">
                    {JSON.stringify(inspected.responseHeaders || {}, null, 2)}
                  </pre>
                  <h3>响应正文</h3>
                  <pre className="code-panel">
                    {inspected.responseBody ||
                      inspected.failure ||
                      inspected.bodyNote ||
                      "无响应正文"}
                  </pre>
                </div>
              </div>
              <p className="small-muted">
                请求 ID：{inspected.id} · 操作 ID：
                {inspected.stepId || "未关联具体操作"}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

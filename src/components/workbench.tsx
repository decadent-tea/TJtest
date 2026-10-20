import { InspectionResult } from "./inspection-result";
import { OwnershipEditor } from "./ownership-editor";
import {
  requestStats,
  ownershipText,
  countOf,
  evidenceCoverage,
  operationEvidence,
  feedbackText,
  feedbackKindLabels,
  isAnalysisCurrent,
} from "../../shared/inspection-evidence";
import { useUnsavedChanges } from "./unsaved-changes";
import { finalFindings } from "../../server/evidence-quality";
import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Pause,
  Play,
  Square,
  Save,
  BrainCircuit,
  FileCheck2,
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
import { requestProblem } from "../../server/evidence-quality";
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
import { actualOperations } from "@/lib/run-path";
import { downloadName } from "../../server/download-name";
import type {
  Run,
  ModelProfile,
  NetworkCall,
  Finding,
} from "../../shared/types";

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
  onConfigureModels,
  focusedIssue,
  resultView = false,
  onOpenResult,
  onBackToEvidence,
}: {
  run: Run | undefined;
  models: ModelProfile[];
  busy: boolean;
  onAction: (action: string, body?: unknown) => Promise<boolean> | void;
  onSaveFlow: () => void;
  onAnalyze: (id: string) => void;
  onNew: () => void;
  readOnly?: boolean;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  onConfigureModels?: () => void;
  focusedIssue?: string;
  resultView?: boolean;
  onOpenResult?: () => void;
  onBackToEvidence?: () => void;
}) {
  const focusedOnce = useRef("");
  const [stopConfirm, setStopConfirm] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [pathOrder, setPathOrder] = useState<"desc" | "asc">("desc");
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const changeTab = (value: string) => {
    setTab(value);
    onTabChange?.(value);
  };
  const [inspected, setInspected] = useState<NetworkCall>();
  const originalRequest = run?.requests.find(
    (request) => request.id === inspected?.id,
  );
  const requestGuard = useUnsavedChanges(
    !!inspected &&
      !!originalRequest &&
      (inspected.description !== originalRequest.description ||
        inspected.module !== originalRequest.module),
    busy,
    () => setInspected(undefined),
  );
  const [filter, setFilter] = useState("");
  const [onlyStep, setOnlyStep] = useState(false);
  const [page, setPage] = useState(0);
  const [networkPageSize, setNetworkPageSize] = useState(10);
  const [logPage, setLogPage] = useState(0);
  const [logPageSize, setLogPageSize] = useState(10);
  const [findingPage, setFindingPage] = useState(0);
  const [findingPageSize, setFindingPageSize] = useState(10);
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
  const pathOperations = useMemo(
    () => (run ? actualOperations(run) : []),
    [run],
  );
  const orderedPath = useMemo(
    () =>
      pathOrder === "desc" ? [...pathOperations].reverse() : pathOperations,
    [pathOperations, pathOrder],
  );
  const failedSteps =
    run?.mode === "replay"
      ? run.operations.filter((op) => op.status === "FAILED")
      : [];
  const failedStep = failedSteps[0];
  const interruptionStep = run?.interruption?.stepId
    ? run.operations.find((op) => op.id === run.interruption?.stepId)
    : undefined;
  const issueStep =
    interruptionStep ||
    failedStep ||
    (run?.status === "INTERRUPTED" ? pathOperations.at(-1) : undefined);
  const blockedCount =
    run?.operations.filter((op) => op.status === "BLOCKED").length || 0;
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
  const feedback = (run?.feedback || []).filter(
    (f) =>
      !onlyStep ||
      !selected ||
      f.stepId === selected ||
      f.candidateStepIds?.includes(selected),
  );
  const [feedbackPage, setFeedbackPage] = useState(0);
  const [feedbackPageSize, setFeedbackPageSize] = useState(20);
  const currentFeedbackPage = currentPage(
    feedbackPage,
    feedback.length,
    feedbackPageSize,
  );
  const selectStep = (id?: string) => {
    setSelected(id);
    setOnlyStep(!!id);
    setFilter("");
    setPage(0);
    setLogPage(0);
    setFeedbackPage(0);
  };
  const findings = useMemo(() => (run ? finalFindings(run) : []), [run]);
  const runRequestStats = useMemo(
    () => (run ? requestStats(run) : undefined),
    [run],
  );
  const shownRequestStats = useMemo(
    () =>
      run ? requestStats(run, new Set(requests.map((r) => r.id))) : undefined,
    [run, requests],
  );
  const captureCoverage = useMemo(
    () => (run ? evidenceCoverage(run) : undefined),
    [run],
  );
  const selectedEvidence = useMemo(
    () => (run && operation ? operationEvidence(run, operation) : undefined),
    [run, operation],
  );
  const reviewedAnalysis = findings.some(
    (finding) => finding.explanationSource === "ai",
  );
  const analysisCompleted = run?.analysis.status === "COMPLETED";
  const downloadReport = async () => {
    if (!run || reportDownloading) return;
    setReportDownloading(true);
    try {
      const response = await fetch(`/api/runs/${run.id}/report`);
      if (!response.ok) {
        if (response.status === 401)
          window.dispatchEvent(new Event("studio:auth-expired"));
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
  const shownNotePage = currentPage(
    notePage,
    run?.notes.length || 0,
    notePageSize,
  );
  const jump = (finding: Finding) => {
    const op = run?.operations.find((o) => finding.evidenceIds.includes(o.id));
    const referencedRequests =
      run?.requests.filter((r) => finding.evidenceIds.includes(r.id)) || [];
    const req =
      referencedRequests.find(requestProblem) || referencedRequests[0];
    const log = run?.logs.find((l) => finding.evidenceIds.includes(l.id));
    const observation = run?.feedback?.find((f) =>
      finding.evidenceIds.includes(f.id),
    );
    const targetStepId =
      req?.stepId || log?.stepId || observation?.stepId || op?.id;
    selectStep(targetStepId);
    if (req) {
      changeTab("network");
      setInspected(req);
    } else if (log) {
      const targetStep = log.stepId || op?.id;
      const matchingLogs =
        run?.logs.filter((item) => !targetStep || item.stepId === targetStep) ||
        [];
      setLogPage(
        Math.max(
          0,
          Math.floor(
            matchingLogs.findIndex((item) => item.id === log.id) / logPageSize,
          ),
        ),
      );
      changeTab("console");
    } else if (observation) {
      changeTab("feedback");
      const matching = (run?.feedback || []).filter(
        (f) =>
          !targetStepId ||
          f.stepId === targetStepId ||
          f.candidateStepIds?.includes(targetStepId),
      );
      setFeedbackPage(
        Math.max(
          0,
          Math.floor(
            matching.findIndex((f) => f.id === observation.id) /
              feedbackPageSize,
          ),
        ),
      );
    } else changeTab("screen");
  };
  useEffect(() => {
    if (
      !run ||
      !focusedIssue ||
      focusedOnce.current === `${run.id}/${focusedIssue}`
    )
      return;
    const finding = [...run.findings, ...run.analysis.findings].find(
      (item) => item.id === focusedIssue,
    );
    if (!finding) return;
    focusedOnce.current = `${run.id}/${focusedIssue}`;
    jump(finding);
  }, [run, focusedIssue]);
  if (!run || !runRequestStats || !shownRequestStats || !captureCoverage)
    return (
      <>
        <PageTitle
          eyebrow={readOnly ? "RECORD / DETAIL" : "RECORD / WORKBENCH"}
          title={readOnly ? "体检记录详情" : "执行工作台"}
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
  if (resultView)
    return (
      <InspectionResult
        run={run}
        onBack={() => onBackToEvidence?.()}
        onEvidence={jump}
        onDownload={() => void downloadReport()}
        downloading={reportDownloading}
        busy={busy}
        onOwnership={(f, owners) =>
          onAction(`findings/${f.id}/ownership`, { owners })
        }
      />
    );
  return (
    <>
      <Dialog
        open={stopConfirm}
        onOpenChange={(open) => {
          if (!busy) setStopConfirm(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {run.mode === "replay" ? "中止本次自动复检？" : "结束本次录制？"}
            </DialogTitle>
            <DialogDescription>
              已采集的操作与证据会保留。
              {run.mode === "replay"
                ? "尚未执行的步骤将停止，已在目标系统提交的操作不会撤销。"
                : "结束后无法继续追加录制；如果只是暂时离开，可以取消并暂停采集。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStopConfirm(false)}
            >
              继续当前任务
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !live}
              onClick={() => {
                onAction("stop");
                setStopConfirm(false);
              }}
            >
              {run.mode === "replay" ? "确认中止复检" : "结束并保存证据"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                  onClick={() => setStopConfirm(true)}
                >
                  <Square data-icon="inline-start" />
                  {run.mode === "replay" ? "中止复检" : "结束录制"}
                </Button>
              </>
            ) : (
              <>
                {run.mode === "record" && (
                  <Button
                    variant="secondary"
                    disabled={busy || live || !run.operations.length}
                    onClick={onSaveFlow}
                  >
                    <Save data-icon="inline-start" />
                    保存为流程
                  </Button>
                )}
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
          <Badge variant="outline">
            {runRequestStats.calls} 次接口调用 · {runRequestStats.records}{" "}
            条证据
          </Badge>
          <Badge variant="outline">
            {run.logs.reduce((n, l) => n + countOf(l), 0)} 次日志 ·{" "}
            {run.logs.length} 条记录
          </Badge>
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
      {!!captureCoverage.eligibleSteps && (
        <Alert>
          <FileCheck2 />
          <AlertTitle>取证完整性与结果验证</AlertTitle>
          <AlertDescription>
            <p>
              {captureCoverage.eligibleSteps} 个关键操作中，
              {captureCoverage.withEvidence} 个已保留证据（含截图，其中{" "}
              {captureCoverage.partialSteps} 个证据受限），
              {captureCoverage.withoutEvidence} 个页面效果未取证；
              {captureCoverage.assertedSteps} 个已执行明确断言。
            </p>
            <p>{captureCoverage.limitations.join(" ")}</p>
          </AlertDescription>
        </Alert>
      )}
      {live && !readOnly && (
        <Alert>
          <MousePointer2 />
          <AlertTitle>
            {run.status === "PAUSED"
              ? "采集已暂停，请先恢复录制"
              : run.mode === "record"
                ? "请在已打开的 Chromium 浏览器中操作"
                : "正在按保存的流程执行"}
          </AlertTitle>
          <AlertDescription>
            {run.status === "PAUSED"
              ? "暂停期间的操作不会作为正常录制步骤采集。点击“恢复录制”后继续业务流程。"
              : run.mode === "record"
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
      {run.mode === "replay" &&
        (run.status === "INTERRUPTED" || failedStep) && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>
              {run.status === "INTERRUPTED" ? "复检已中断" : "复检步骤失败"}
            </AlertTitle>
            <AlertDescription>
              <p>
                {failedSteps.length
                  ? `失败步骤：第 ${failedSteps.map((step) => step.sequence).join("、")} 步（共 ${failedSteps.length} 步）。`
                  : issueStep
                    ? `第 ${issueStep.sequence} 步：${issueStep.label}。`
                    : "中断时没有正在执行的步骤。"}
                {blockedCount > 0 ? ` 后续 ${blockedCount} 步未执行。` : ""}
              </p>
              {run.status === "INTERRUPTED" && (
                <p>
                  {run.interruption?.reason ||
                    run.notes.findLast((note) => note.includes("中断")) ||
                    "请查看步骤错误和截图。"}
                </p>
              )}
              {(failedSteps.length
                ? failedSteps
                : issueStep
                  ? [issueStep]
                  : []
              ).map((step) => (
                <Button
                  key={step.id}
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    selectStep(step.id);
                    document
                      .getElementById(`path-step-${step.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  第 {step.sequence} 步
                </Button>
              ))}
            </AlertDescription>
          </Alert>
        )}
      <section
        className="analysis-deck"
        aria-label="AI 体检分析"
        data-running={run.analysis.status === "RUNNING"}
      >
        <div className="analysis-deck-heading">
          <div className="analysis-orbit">
            <BrainCircuit size={25} />
          </div>
          <div>
            <div className="eyebrow">INTELLIGENCE / 体检分析</div>
            <h2>
              {run.analysis.status === "COMPLETED"
                ? isAnalysisCurrent(run)
                  ? "分析已完成，查看本次体检结论"
                  : reviewedAnalysis
                    ? "历史AI分析已按现有证据复核"
                    : "历史AI分析需要更新"
                : run.analysis.status === "RUNNING"
                  ? "正在从执行证据中识别风险"
                  : "从执行证据，到质量结论"}
            </h2>
            <p>
              {live
                ? "结束录制或复检后，即可启动 AI 分析。"
                : run.analysis.status === "COMPLETED" && !isAnalysisCurrent(run)
                  ? reviewedAnalysis
                    ? "保留有录制证据支持的详细分析，接口次数以采集记录为准；缺少依据的旧结论未纳入风险。"
                    : "历史AI结论缺少当前可核实的结果证据，暂不计入风险；原始记录保留，可重新分析。"
                  : "选择模型分析本次执行，汇总风险、处置建议与测试结论。"}
            </p>
          </div>
        </div>
        <div className="analysis-controls">
          <Select
            value={modelId}
            onValueChange={setModelId}
            disabled={run.analysis.status === "RUNNING"}
          >
            <SelectTrigger className="w-60" aria-label="分析模型">
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
          <div
            className="analysis-trigger-shell"
            data-running={run.analysis.status === "RUNNING"}
            data-unavailable={
              live ||
              !models.some((m) => m.id === modelId && m.enabled && m.hasKey)
            }
          >
            <span className="analysis-particles" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <i
                  key={index}
                  style={{ "--particle": index } as React.CSSProperties}
                />
              ))}
            </span>
            <Button
              variant="launch"
              className="analysis-trigger"
              disabled={
                live ||
                busy ||
                !models.some(
                  (m) => m.id === modelId && m.enabled && m.hasKey,
                ) ||
                run.analysis.status === "RUNNING"
              }
              onClick={() => onAnalyze(modelId)}
            >
              <BrainCircuit data-icon="inline-start" />
              {analysisCompleted ? (
                <span>
                  <span className="analysis-trigger-completed">分析完成</span>
                  <span className="analysis-trigger-repeat">再次分析</span>
                </span>
              ) : (
                <span>
                  {run.analysis.status === "RUNNING"
                    ? "正在分析"
                    : run.analysis.status === "FAILED" && run.analysis.jobId
                      ? "继续未完成分析"
                      : "AI 分析本次体检"}
                </span>
              )}
              <span className="analysis-trigger-signal" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </Button>
          </div>
          {!live && (
            <Button
              variant="outline"
              size="lg"
              className="inspection-result-trigger"
              data-ai-complete={analysisCompleted}
              onClick={onOpenResult}
            >
              <span className="result-trigger-paper" aria-hidden="true">
                <FileCheck2 />
              </span>
              <span className="result-trigger-label">
                {analysisCompleted ? "体检结果（AI分析完成）" : "体检结果"}
              </span>
              <span className="result-trigger-arrow" aria-hidden="true">
                <ArrowUpRight />
              </span>
            </Button>
          )}
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
        {!models.some((m) => m.enabled && m.hasKey) && (
          <Alert className="mb-4">
            <AlertTitle>尚无可用分析模型</AlertTitle>
            <AlertDescription>
              添加并启用模型后可运行 AI 分析，现有证据和规则发现仍可查看。
              <Button variant="outline" onClick={onConfigureModels}>
                配置分析模型
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {run.analysis.status === "RUNNING" && (
          <div className="analysis-live-scan" role="status">
            <div className="analysis-wave" aria-hidden="true">
              {Array.from({ length: 24 }, (_, index) => (
                <i
                  key={index}
                  style={{ "--bar": index } as React.CSSProperties}
                />
              ))}
            </div>
            <div>
              <strong>
                {run.analysis.progress?.phase === "summary"
                  ? "正在汇总结论"
                  : "正在分析执行证据"}
              </strong>
              <p>
                {run.analysis.activity?.label ||
                  "正在处理接口、日志与操作路径，请稍候…"}
              </p>
            </div>
            <span className="analysis-live-dot" />
          </div>
        )}
        {run.analysis.progress && run.analysis.status !== "COMPLETED" && (
          <div className="analysis-summary" role="status" aria-live="polite">
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
              {run.analysis.progress.resumed && " · 已恢复之前完成的批次"}
            </p>
            {run.analysis.status === "RUNNING" &&
              !!run.analysis.activeRequests?.length && (
                <div className="analysis-activity-list">
                  {run.analysis.activeRequests.map((request) => (
                    <div key={`${request.batch}-${request.requestStartedAt}`}>
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
                      {request.lastError && <span>{request.lastError}</span>}
                    </div>
                  ))}
                </div>
              )}
            {run.analysis.coverage && (
              <small>
                分析输入包含 {run.analysis.coverage.steps} 个步骤、
                {run.analysis.coverage.requests} 条接口记录（
                {run.analysis.coverage.requestCalls ??
                  runRequestStats.calls}{" "}
                次调用）、
                {run.analysis.coverage.logs} 条日志。
                静态资源在采集入口过滤，不发送给 AI；长正文采用摘要。
                {` 详细分析${run.analysis.coverage.selectedSteps ?? run.analysis.coverage.steps}个关键步骤，${run.analysis.coverage.compactedSteps || 0}个过程动作压缩为上下文；最多${run.analysis.concurrency || 7}路并行。`}
                {run.analysis.coverage.analysisRecords !== undefined &&
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
      </section>
      <div className="workbench-grid">
        <Card className="timeline-card">
          <CardHeader>
            <CardTitle>操作路径</CardTitle>
            <CardDescription>
              {run.mode === "replay"
                ? `本次实际尝试 ${pathOperations.length} 步${run.operations.length > pathOperations.length ? ` · ${run.operations.length - pathOperations.length} 步未执行` : ""}`
                : `${run.scene} · 按发生顺序记录`}
            </CardDescription>
            <CardAction>
              <Select
                value={pathOrder}
                onValueChange={(value) => setPathOrder(value as "desc" | "asc")}
              >
                <SelectTrigger aria-label="操作路径排序" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="desc">逆序</SelectItem>
                    <SelectItem value="asc">顺序</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="timeline">
              {orderedPath.length ? (
                orderedPath.map((op) => (
                  <button
                    key={op.id}
                    id={`path-step-${op.id}`}
                    onClick={() => {
                      selectStep(selected === op.id ? undefined : op.id);
                      setInspected(undefined);
                    }}
                    aria-pressed={selected === op.id}
                    title={
                      selected === op.id
                        ? "再次点击显示全部证据"
                        : "查看本步执行证据"
                    }
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
                      {op.sequence}
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
                  selectStep(undefined);
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
                    setLogPage(0);
                    setFeedbackPage(0);
                  }}
                >
                  {onlyStep ? "查看全部步骤" : "只看所选步骤"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {selectedEvidence && (
                <p className="small-muted mb-4">
                  所选步骤取证状态：{selectedEvidence.reason}
                </p>
              )}
              <Tabs value={tab} onValueChange={changeTab}>
                <TabsList className="max-w-full flex-wrap gap-y-1 group-data-horizontal/tabs:h-auto [&>[data-slot=tabs-trigger]]:h-7">
                  <TabsTrigger value="network">
                    <Globe2 />
                    接口 {shownRequestStats.calls} 次 ·{" "}
                    {shownRequestStats.records} 条
                  </TabsTrigger>
                  <TabsTrigger value="console">
                    <Terminal />
                    日志 {logs.reduce((n, l) => n + countOf(l), 0)} 次 ·{" "}
                    {logs.length} 条
                  </TabsTrigger>
                  <TabsTrigger value="screen">
                    <Image />
                    画面
                  </TabsTrigger>
                  <TabsTrigger value="feedback">
                    <FileCheck2 />
                    页面反馈 {feedback.reduce((n, f) => n + countOf(f), 0)} 次 ·{" "}
                    {feedback.length} 条
                  </TabsTrigger>
                  <TabsTrigger value="report">
                    <BrainCircuit />
                    风险 {findings.length}
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
                      静态资源排除，重复项保留合并次数
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
                <TabsContent value="feedback">
                  <p className="small-muted mb-4">
                    页面反馈是观察事实。时间候选不证明因果；关联不确定时不分配给最后一次操作。成功提示不等于业务通过。
                  </p>
                  {feedback.length ? (
                    <div className="table-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead>类型</TableHead>
                            <TableHead>反馈与关联</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {feedback
                            .slice(
                              currentFeedbackPage * feedbackPageSize,
                              (currentFeedbackPage + 1) * feedbackPageSize,
                            )
                            .map((f) => (
                              <TableRow key={f.id}>
                                <TableCell>
                                  {new Date(f.timestamp).toLocaleTimeString(
                                    "zh-CN",
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {feedbackKindLabels[f.kind]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="whitespace-pre-wrap break-all">
                                  {feedbackText(run, f)}
                                  {f.target && (
                                    <p className="small-muted">
                                      区域：{f.target}
                                    </p>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <Blank
                      title="暂无页面反馈"
                      description={
                        run.feedback === undefined
                          ? "此历史记录未采集页面反馈，需重新录制获得，旧页面状态不会补造。"
                          : "常见提示、网页弹窗、页面位置变化和加载/空状态出现后会记录在这里。"
                      }
                    />
                  )}
                  <Pagination
                    total={feedback.length}
                    page={currentFeedbackPage}
                    pageSize={feedbackPageSize}
                    onPageChange={setFeedbackPage}
                    onPageSizeChange={(size) => {
                      setFeedbackPageSize(size);
                      setFeedbackPage(0);
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
                            {f.explanationSource === "ai"
                              ? f.source === "rule"
                                ? "规则发现 · AI分析"
                                : "AI 分析"
                              : "规则发现"}
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
                        <p>
                          问题归属：{ownershipText(f)}
                          {f.ownershipSource === "manual"
                            ? "（人工确认）"
                            : "（建议）"}
                        </p>
                        {
                          <OwnershipEditor
                            finding={f}
                            busy={busy}
                            onSave={(owners) =>
                              onAction(`findings/${f.id}/ownership`, { owners })
                            }
                          />
                        }
                        <p>{f.observation || f.detail}</p>
                        {f.suggestion && (
                          <p className="small-muted">建议：{f.suggestion}</p>
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
          if (!open) requestGuard.requestClose();
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{inspected?.description}</DialogTitle>
            <DialogDescription>
              {inspected?.module} ·{" "}
              {inspected?.association === "action-context"
                ? "回放动作上下文关联"
                : "页面/时间关联候选"}
              （不能据此确认触发原因）
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
                    disabled={busy}
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
                    disabled={busy}
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
      {requestGuard.confirmation}
    </>
  );
}

import type { ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  FileSearch,
  LoaderCircle,
  Check,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TraceMap } from "@/components/trace-map";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { labels, time, active } from "@/lib/api";
import type { Summary, Flow } from "../../shared/types";
export function StateBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        ["FAILED", "COMPLETED_WITH_ISSUES", "INTERRUPTED", "high"].includes(
          status,
        )
          ? "destructive"
          : active(status)
            ? "default"
            : "secondary"
      }
    >
      {active(status) ? (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      ) : status === "PASSED" ? (
        <Check data-icon="inline-start" />
      ) : null}
      {labels[status] || status}
    </Badge>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function Blank({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="empty-area">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSearch />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
export function RunTable({
  runs,
  onOpen,
  actions,
}: {
  runs: Summary[];
  onOpen: (id: string) => void;
  actions?: (run: Summary) => ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>体检任务</TableHead>
          <TableHead>模式 / 环境</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>采集情况</TableHead>
          <TableHead>开始时间</TableHead>
          <TableHead className={actions ? "text-right" : "w-12"}>
            {actions ? "操作" : <span className="sr-only">查看</span>}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            className="cursor-pointer"
            onClick={() => onOpen(run.id)}
          >
            <TableCell>
              <Button
                variant="link"
                className="table-name"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(run.id);
                }}
              >
                {run.name}
              </Button>
              <div className="small-muted">{run.project}</div>
            </TableCell>
            <TableCell>
              <span>{run.mode === "record" ? "人工录制" : "自动复检"}</span>
              <div className="small-muted">{run.environment}</div>
            </TableCell>
            <TableCell>
              <StateBadge status={run.status} />
            </TableCell>
            <TableCell>
              <div className="tabular">
                {run.operationCount} 步 · {run.requestCount} 请求
              </div>
              <div className="small-muted">
                {run.issueCount > 0 ? (
                  <span className="issue-text">{run.issueCount} 项待处理</span>
                ) : (
                  "暂无规则异常"
                )}
              </div>
            </TableCell>
            <TableCell className="small-muted">{time(run.startedAt)}</TableCell>
            <TableCell>
              <div
                className="flex items-center justify-end gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                {actions?.(run)}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`查看${run.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(run.id);
                  }}
                >
                  <ArrowUpRight data-icon="inline-start" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function Overview({
  runs,
  flows,
  onNew,
  onOpen,
  onPage,
}: {
  runs: Summary[];
  flows: Flow[];
  onNew: (demo?: boolean) => void;
  onOpen: (id: string) => void;
  onPage: (page: string) => void;
}) {
  const completed = runs.filter((r) => !active(r.status));
  const stats = [
    {
      title: "体检记录",
      label: "INSPECTIONS",
      value: runs.length,
      page: "history",
    },
    {
      title: "可复用流程",
      label: "REUSABLE FLOWS",
      value: flows.length,
      page: "flows",
    },
    {
      title: "采集接口调用",
      label: "API TRACES",
      value: runs.reduce((n, r) => n + r.requestCount, 0),
    },
    {
      title: "规则发现",
      label: "FINDINGS",
      value: completed.reduce((n, r) => n + r.issueCount, 0),
      page: "issues",
    },
  ];
  return (
    <div className="workspace-overview">
      <section className="workspace-intro" aria-labelledby="workspace-title">
        <div className="workspace-copy">
          <div className="eyebrow">WORKSPACE / OVERVIEW</div>
          <h1 id="workspace-title">
            让每一次测试，
            <br />
            都留下<span>完整线索。</span>
          </h1>
          <p>
            从页面操作到接口调用，串联异常与证据。
            <br />
            探索一次，留存一条可复检的业务路径。
          </p>
          <div className="workspace-actions">
            <Button variant="launch" size="lg" onClick={() => onNew()}>
              <Plus data-icon="inline-start" />
              开始新体检
            </Button>
            <Button variant="ghost" size="lg" onClick={() => onPage("flows")}>
              查看流程库
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <div className="workspace-method">
            <span />
            人工探索
            <span className="method-line" />
            自动复检
          </div>
        </div>
        <div className="trace-depth-stage">
          <span className="trace-depth-word" aria-hidden="true">
            TRACE
          </span>
          <div className="trace-depth-material" aria-hidden="true" />
          <TraceMap />
        </div>
      </section>
      <Separator />
      <dl className="metrics-strip" aria-label="工作空间统计">
        {stats.map((item) => (
          <div className="metric" key={item.label}>
            <dt>
              {item.title}
              <span>{item.label}</span>
            </dt>
            <dd>
              {item.value.toLocaleString("en-US", { minimumIntegerDigits: 2 })}
            </dd>
            {item.page && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="metric-link"
                aria-label={`查看${item.title}`}
                onClick={() => onPage(item.page!)}
              >
                <ArrowUpRight />
              </Button>
            )}
          </div>
        ))}
      </dl>
      <Separator />
      <motion.div
        className="workspace-body"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.45 }}
      >
        <section className="recent-inspections" aria-labelledby="recent-title">
          <div className="section-heading">
            <div>
              <div className="eyebrow">RECENT INSPECTIONS</div>
              <h2 id="recent-title">
                最近体检<span>{runs.length.toString().padStart(2, "0")}</span>
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onPage("history")}>
              全部记录
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </div>
          <p className="section-description">
            回到测试发生的位置，继续追踪每一条线索。
          </p>
          {runs.length ? (
            <RunTable runs={runs.slice(0, 5)} onOpen={onOpen} />
          ) : (
            <Blank
              title="第一条测试路径，从这里开始"
              description="输入工程地址，打开浏览器进行测试；操作、请求和异常将同步记录。"
              action={
                <Button variant="outline" onClick={() => onNew()}>
                  创建体检任务
                </Button>
              }
            />
          )}
          <div className="evidence-note">
            <FileSearch size={15} />
            <span>原始调用、操作轨迹与异常证据，随每次体检一同留存。</span>
          </div>
        </section>
        <aside className="quick-start" aria-labelledby="prepare-title">
          <div className="eyebrow">
            BEFORE YOU INSPECT <span>↗</span>
          </div>
          <h2 id="prepare-title">
            准备好，
            <br />
            开始下一次探索。
          </h2>
          <ol className="preparation-list">
            <li>
              <span>01</span>
              <div>
                <strong>连接测试工程</strong>
                <p>从测试环境开始，确认工程地址。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>划分业务场景</strong>
                <p>切换模块时标记场景，方便失败恢复。</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>配置分析模型</strong>
                <p>接入模型 API，让分析关联原始证据。</p>
              </div>
            </li>
          </ol>
          <Button variant="outline" onClick={() => onPage("settings")}>
            前往系统维护
            <ArrowUpRight data-icon="inline-end" />
          </Button>
          <Separator />
          <div className="demo-entry">
            <span>第一次使用？</span>
            <Button variant="link" size="sm" onClick={() => onNew(true)}>
              体验演示工程
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </aside>
      </motion.div>
    </div>
  );
}

import { useState } from "react";
import { Pencil, Search, Trash2, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Blank, PageTitle } from "./studio";
import { Pagination, currentPage } from "./pagination";
import type { Finding } from "../../shared/types";

export type Issue = Finding & {
  runId: string;
  runName: string;
  project: string;
  startedAt: string;
};

export function IssueCenter({
  issues,
  busy,
  onOpen,
  onSave,
  onDelete,
}: {
  issues: Issue[];
  busy: boolean;
  onOpen: (id: string) => void;
  onSave: (
    issue: Issue,
    disposition: "open" | "investigating" | "resolved",
    note: string,
  ) => void;
  onDelete: (issue: Issue) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<Issue>();
  const [deleting, setDeleting] = useState<Issue>();
  const [disposition, setDisposition] = useState<
    "open" | "investigating" | "resolved"
  >("open");
  const [note, setNote] = useState("");
  const visible = issues.filter(
    (issue) =>
      `${issue.title} ${issue.module} ${issue.runName} ${issue.project} ${issue.detail}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (filter === "all" || (issue.disposition || "open") === filter),
  );
  const shownPage = currentPage(page, visible.length, pageSize);
  const edit = (issue: Issue) => {
    setEditing(issue);
    setDisposition(issue.disposition || "open");
    setNote(issue.note || "");
  };
  return (
    <>
      <PageTitle
        eyebrow="DIAGNOSTICS / ISSUES"
        title="问题中心"
        description="查询异常，记录核查结论和处理状态，并回到原始证据。"
      />
      <Card>
        <CardHeader>
          <CardTitle>问题列表</CardTitle>
          <CardDescription>
            规则与 AI 发现均保留在对应体检记录中。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="records-toolbar">
            <div className="search-wrap">
              <Search size={17} />
              <Input
                aria-label="搜索问题"
                placeholder="搜索标题、模块、工程或记录"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              value={filter}
              onValueChange={(value) => {
                setFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="open">待处理</SelectItem>
                  <SelectItem value="investigating">处理中</SelectItem>
                  <SelectItem value="resolved">已解决</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {visible.length ? (
            <div className="space-y-3 mt-5">
              {visible
                .slice(shownPage * pageSize, (shownPage + 1) * pageSize)
                .map((issue) => (
                  <div
                    key={`${issue.runId}:${issue.id}`}
                    className="rounded-xl border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          issue.severity === "high"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {
                          { high: "高", medium: "中", low: "低" }[
                            issue.severity
                          ]
                        }
                      </Badge>
                      <Badge variant="outline">
                        {
                          {
                            open: "待处理",
                            investigating: "处理中",
                            resolved: "已解决",
                          }[issue.disposition || "open"]
                        }
                      </Badge>
                      <strong>{issue.title}</strong>
                    </div>
                    <p className="small-muted mt-2">
                      {issue.project} · {issue.runName} · {issue.module} ·{" "}
                      {issue.source === "ai" ? "AI 分析" : "规则发现"}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap">{issue.detail}</p>
                    {issue.note && (
                      <p className="small-muted mt-2">处理备注：{issue.note}</p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpen(issue.runId)}
                      >
                        <ArrowUpRight data-icon="inline-start" />
                        查看证据
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => edit(issue)}
                      >
                        <Pencil data-icon="inline-start" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(issue)}
                      >
                        <Trash2 data-icon="inline-start" />
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <Blank
              title={issues.length ? "没有匹配的问题" : "暂无问题"}
              description={
                issues.length
                  ? "调整搜索或状态条件。"
                  : "完成体检后，异常会汇总到这里。"
              }
            />
          )}
          <Pagination
            total={visible.length}
            page={shownPage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        </CardContent>
      </Card>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑问题</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2">
            处理状态
            <Select
              value={disposition}
              onValueChange={(value) =>
                setDisposition(value as typeof disposition)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="open">待处理</SelectItem>
                  <SelectItem value="investigating">处理中</SelectItem>
                  <SelectItem value="resolved">已解决</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2">
            处理备注
            <Textarea
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="记录核查结果、修复说明或回归结论"
            />
          </label>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                if (editing) {
                  onSave(editing, disposition, note);
                  setEditing(undefined);
                }
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条问题？</DialogTitle>
            <DialogDescription>
              问题将从问题中心移除。原始操作、请求和日志证据仍保留在体检记录中。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting) {
                  onDelete(deleting);
                  setDeleting(undefined);
                }
              }}
            >
              删除问题
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

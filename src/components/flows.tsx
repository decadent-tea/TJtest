import { useState } from "react";
import {
  Workflow,
  Play,
  Pencil,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Save,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Blank, PageTitle } from "./studio";
import { Pagination, currentPage } from "./pagination";
import { time } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Flow, Operation } from "../../shared/types";

export function FlowList({
  flows,
  onReplay,
  onEdit,
  onNew,
  onDelete,
}: {
  flows: Flow[];
  onReplay: (f: Flow) => void;
  onEdit: (f: Flow) => void;
  onNew: () => void;
  onDelete: (f: Flow) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const visible = flows.filter((flow) =>
    `${flow.name} ${flow.project} ${flow.url}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shownPage = currentPage(page, visible.length, pageSize);
  return (
    <>
      <PageTitle
        eyebrow="ASSETS / FLOWS"
        title="把测试经验，保存成下一次的起点。"
        description="维护步骤、输入变量和检查条件，让录制流程可以持续复用。"
        actions={
          <Button onClick={onNew}>
            <Plus data-icon="inline-start" />
            录制新流程
          </Button>
        }
      />
      {flows.length > 0 && (
        <div className="search-wrap mb-5 max-w-md">
          <Search size={17} />
          <Input aria-label="搜索流程" placeholder="搜索流程名称、工程或地址" value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        </div>
      )}
      {visible.length ? (
        <div className="flow-grid">
          {visible.slice(shownPage * pageSize, (shownPage + 1) * pageSize).map((flow) => (
            <Card key={flow.id}>
              <CardHeader>
                <CardTitle>{flow.name}</CardTitle>
                <CardDescription>{flow.project}</CardDescription>
                <CardAction>
                  <Badge variant="outline">v{flow.version}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="flow-symbol">
                  <Workflow size={28} />
                  <span>{flow.operations.length} 个步骤</span>
                </div>
                <div className="flow-scenes">
                  {[...new Set(flow.operations.map((o) => o.scene))].map(
                    (scene) => (
                      <Badge key={scene} variant="secondary">
                        {scene}
                      </Badge>
                    ),
                  )}
                </div>
                <p className="small-muted truncate mt-4">{flow.url}</p>
                <p className="small-muted mt-2">
                  {flow.variables.length} 个运行变量 · 更新{" "}
                  {time(flow.updatedAt)}
                </p>
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => onEdit(flow)}>
                  <Pencil data-icon="inline-start" />
                  编辑流程
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(flow)}
                  aria-label={`删除流程${flow.name}`}>
                  <Trash2 data-icon="inline-start" />删除
                </Button>
                <Button size="sm" onClick={() => onReplay(flow)}>
                  <Play data-icon="inline-start" />
                  再次体检
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent>
            <Blank
              title={flows.length ? "没有匹配的流程" : "还没有可复用流程"}
              description={flows.length ? "调整搜索条件后重试。" : "完成一次录制后，在工作台选择“保存为流程”。你可以编辑步骤并添加验证条件。"}
              action={
                <Button variant="outline" onClick={onNew}>
                  开始录制
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}
      <Pagination total={visible.length} page={shownPage} pageSize={pageSize} onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0); }} />
    </>
  );
}

export function FlowEditor({
  flow,
  busy,
  onClose,
  onSave,
}: {
  flow: Flow;
  busy: boolean;
  onClose: () => void;
  onSave: (flow: Flow) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(flow));
  const [selected, setSelected] = useState<string | undefined>(
    flow.operations[0]?.id,
  );
  const [locatorText, setLocatorText] = useState("");
  const [locatorError, setLocatorError] = useState("");
  const op = draft.operations.find((o) => o.id === selected);
  const update = (patch: Partial<Operation>) =>
    setDraft((d) => ({
      ...d,
      operations: d.operations.map((o) =>
        o.id === selected ? { ...o, ...patch } : o,
      ),
    }));
  const choose = (o: Operation) => {
    setSelected(o.id);
    setLocatorText(JSON.stringify(o.locators, null, 2));
    setLocatorError("");
  };
  const move = (id: string, delta: number) => {
    const ops = [...draft.operations];
    const i = ops.findIndex((o) => o.id === id);
    if (i + delta < 0 || i + delta >= ops.length) return;
    [ops[i], ops[i + delta]] = [ops[i + delta], ops[i]];
    setDraft({
      ...draft,
      operations: ops.map((o, i) => ({ ...o, sequence: i + 1 })),
    });
  };
  const add = (kind: "assert" | "goto" | "hover") => {
    const next: Operation = {
      id: crypto.randomUUID(),
      sequence: draft.operations.length + 1,
      pageId: op?.pageId || "page-1",
      framePath: kind === "hover" ? [...(op?.framePath || [])] : [],
      timestamp: new Date().toISOString(),
      kind,
      label: kind === "hover" ? "鼠标悬浮 · 请设置父菜单定位器" : kind === "assert" ? "验证页面文本" : "恢复到场景入口",
      module: op?.module || draft.project,
      scene: op?.scene || "新场景",
      url: draft.url,
      value: kind === "goto" ? draft.url : "",
      locators: [],
      status: "RECORDED",
      dependsOn: [],
      timeout: 8000,
      effect: "read",
      enabled: true,
    };
    const operations = [...draft.operations];
    const index = kind === "hover" && op ? operations.indexOf(op) : operations.length;
    operations.splice(index, 0, next);
    setDraft({ ...draft, operations: operations.map((step, i) => ({ ...step, sequence: i + 1 })) });
    choose(next);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑流程 · v{flow.version}</DialogTitle>
          <DialogDescription>
            保存生成新版本，历史执行仍绑定原版本。关键步骤失败将阻塞当前场景，后续独立场景继续。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="flow-title">流程名称</FieldLabel>
            <Input
              id="flow-title"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
        </FieldGroup>
        <div className="flow-editor-grid">
          <div className="flow-editor-list">
            {draft.operations.map((o, i) => (
              <div
                className={cn(
                  "editor-step",
                  selected === o.id && "is-selected",
                )}
                key={o.id}
              >
                <button onClick={() => choose(o)}>
                  <span className="tabular">{i + 1}.</span> {o.label}
                  <small>{o.scene}</small>
                </button>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="上移步骤"
                    onClick={() => move(o.id, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="下移步骤"
                    onClick={() => move(o.id, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="删除步骤"
                    onClick={() => {
                      setDraft({
                        ...draft,
                        operations: draft.operations.filter(
                          (p) => p.id !== o.id,
                        ),
                      });
                      if (selected === o.id) setSelected(undefined);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => add("hover")}>
                <Plus data-icon="inline-start" />
                鼠标悬浮
              </Button>
              <Button variant="outline" size="sm" onClick={() => add("assert")}>
                <Plus data-icon="inline-start" />
                文本断言
              </Button>
              <Button variant="outline" size="sm" onClick={() => add("goto")}>
                <Plus data-icon="inline-start" />
                入口导航
              </Button>
            </div>
          </div>
          <div className="flow-editor-fields">
            {op ? (
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="enabled">执行该步骤</FieldLabel>
                  <Switch
                    id="enabled"
                    checked={op.enabled}
                    onCheckedChange={(value) => update({ enabled: value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="op-label">步骤描述</FieldLabel>
                  <Input
                    id="op-label"
                    value={op.label}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                </Field>
                <FieldGroup className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="op-scene">场景名称</FieldLabel>
                    <Input
                      id="op-scene"
                      value={op.scene}
                      onChange={(e) => update({ scene: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="op-module">模块名称</FieldLabel>
                    <Input
                      id="op-module"
                      value={op.module}
                      onChange={(e) => update({ module: e.target.value })}
                    />
                  </Field>
                </FieldGroup>
                <FieldGroup className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>动作类型</FieldLabel>
                    <Select
                      value={op.kind}
                      onValueChange={(v) =>
                        update({ kind: v as Operation["kind"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(
                            [
                              "goto",
                              "click",
                              "hover",
                              "fill",
                              "press",
                              "check",
                              "select",
                              "scroll",
                              "assert",
                              "upload",
                              "dialog",
                            ] as const
                          ).map((k) => (
                            <SelectItem value={k} key={k}>
                              {k === "hover" ? "鼠标悬浮" : k}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>失败策略</FieldLabel>
                    <Select
                      value={op.effect}
                      onValueChange={(v) =>
                        update({ effect: v as Operation["effect"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="read">失败后尝试下一步</SelectItem>
                          <SelectItem value="write">
                            关键步骤：失败后阻塞本场景
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <Field>
                  <FieldLabel htmlFor="op-value">输入值 / 导航地址</FieldLabel>
                  <Input
                    id="op-value"
                    value={op.value || ""}
                    onChange={(e) => update({ value: e.target.value })}
                    placeholder={
                      op.kind === "goto" ? op.url : "支持 {{变量名称}}"
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="op-variable">运行变量名称</FieldLabel>
                  <Input
                    id="op-variable"
                    value={op.variable || ""}
                    onChange={(e) =>
                      update({ variable: e.target.value || undefined })
                    }
                    placeholder="例如 LOGIN_PASSWORD；填写后从运行时取值"
                  />
                </Field>
                {op.kind === "press" && (
                  <Field>
                    <FieldLabel htmlFor="op-key">按键组合</FieldLabel>
                    <Input
                      id="op-key"
                      value={op.key || ""}
                      onChange={(e) => update({ key: e.target.value })}
                    />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="op-assertion">预期页面文本</FieldLabel>
                  <Input
                    id="op-assertion"
                    value={op.assertion || ""}
                    onChange={(e) =>
                      update({ assertion: e.target.value || undefined })
                    }
                    placeholder="操作后必须出现的可见文本"
                  />
                  <FieldDescription>
                    只有配置的断言成立，才标记验证通过。
                  </FieldDescription>
                </Field>
                <FieldGroup className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="op-timeout">超时（毫秒）</FieldLabel>
                    <Input
                      id="op-timeout"
                      type="number"
                      min={500}
                      max={60000}
                      value={op.timeout}
                      onChange={(e) =>
                        update({ timeout: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="op-dependencies">
                      依赖步骤 ID
                    </FieldLabel>
                    <Input
                      id="op-dependencies"
                      value={op.dependsOn.join(",")}
                      onChange={(e) =>
                        update({
                          dependsOn: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="多个 ID 用逗号分隔"
                    />
                  </Field>
                </FieldGroup>
                <Field data-invalid={!!locatorError}>
                  <FieldLabel htmlFor="op-locators">元素定位器候选</FieldLabel>
                  <Textarea
                    id="op-locators"
                    rows={6}
                    aria-invalid={!!locatorError}
                    value={locatorText || JSON.stringify(op.locators, null, 2)}
                    onChange={(e) => {
                      setLocatorText(e.target.value);
                      try {
                        const parsed = JSON.parse(e.target.value);
                        if (!Array.isArray(parsed)) throw new Error();
                        update({ locators: parsed, hoverPosition: undefined });
                        setLocatorError("");
                      } catch {
                        setLocatorError("请填写有效 JSON 数组。");
                      }
                    }}
                  />
                  <FieldDescription>
                    {locatorError || (op.kind === "hover"
                      ? "填写需要悬浮的父菜单定位器；此步骤应位于子菜单点击之前。支持 testId、role、label 或 css。"
                      : "按顺序寻找唯一匹配的 testId、role、label 或 css 定位器。")}
                  </FieldDescription>
                </Field>
                <p className="small-muted">步骤 ID：{op.id}</p>
              </FieldGroup>
            ) : (
              <Blank
                title="选择一个步骤"
                description="编辑它的场景、输入、断言或定位信息。"
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy || !!locatorError || !draft.name.trim()}
            onClick={() => onSave(draft)}
          >
            <Save data-icon="inline-start" />
            保存为 v{flow.version + 1}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

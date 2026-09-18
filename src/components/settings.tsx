import { useState } from "react";
import {
  BrainCircuit,
  Plus,
  Pencil,
  Cable,
  ShieldCheck,
  Database,
  Monitor,
  Save,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { PageTitle, Blank } from "./studio";
import type { ModelProfile } from "../../shared/types";
export function Settings({
  models,
  busy,
  onEdit,
  onTest,
  onDelete,
}: {
  models: ModelProfile[];
  busy: boolean;
  onEdit: (m?: ModelProfile) => void;
  onTest: (id: string) => void;
  onDelete: (m: ModelProfile) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="SYSTEM / MAINTENANCE"
        title="系统维护"
        description="配置分析模型，查看本机执行与数据存储状态。"
      />
      <Card>
        <CardHeader>
          <CardTitle>分析模型</CardTitle>
          <CardDescription>
            支持 DeepSeek、Qwen、GLM 与自定义兼容服务。密钥在本机后端加密保存。
          </CardDescription>
          <CardAction>
            <Button onClick={() => onEdit()}>
              <Plus data-icon="inline-start" />
              添加模型
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {models.length ? (
            <div className="model-list">
              {models.map((m) => (
                <div className="model-row" key={m.id}>
                  <div className="model-icon">
                    <BrainCircuit size={23} />
                  </div>
                  <div className="model-info">
                    <strong>{m.name}</strong>
                    <p>
                      {m.provider} · {m.model}
                    </p>
                    <small>{m.baseUrl}</small>
                  </div>
                  <Badge variant={m.enabled ? "default" : "secondary"}>
                    {m.enabled ? "已启用" : "未启用"}
                  </Badge>
                  <Badge variant="outline">
                    {m.hasKey ? "密钥已配置" : "缺少密钥"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !m.hasKey}
                    onClick={() => onTest(m.id)}
                  >
                    <Cable data-icon="inline-start" />
                    测试连接
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`编辑${m.name}`}
                    onClick={() => onEdit(m)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除${m.name}`}
                    onClick={() => onDelete(m)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Blank
              title="接入你的第一个分析模型"
              description="添加服务地址、API Key 和模型名称，保存后测试连接，再到体检工作台发起分析。"
              action={
                <Button variant="outline" onClick={() => onEdit()}>
                  添加模型配置
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
      <div className="system-grid">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Monitor size={18} />
                本机执行器
              </span>
            </CardTitle>
            <CardDescription>独立的 Chromium 浏览器会话。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="system-detail">
              <span>运行模式</span>
              <strong>本机 / 单会话</strong>
              <span>浏览器</span>
              <strong>Playwright Chromium</strong>
              <span>录制时操作</span>
              <strong>独立可见浏览器</strong>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Database size={18} />
                证据存储
              </span>
            </CardTitle>
            <CardDescription>执行记录在重启后仍可查看。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="system-detail">
              <span>数据库</span>
              <strong>SQLite / WAL</strong>
              <span>附件目录</span>
              <strong>data/artifacts</strong>
              <span>响应正文限额</span>
              <strong>256 KB / 调用</strong>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <ShieldCheck size={18} />
                数据处理
              </span>
            </CardTitle>
            <CardDescription>分析只使用脱敏的文本证据。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="system-detail">
              <span>密码录制</span>
              <strong>运行变量引用</strong>
              <span>截图送模</span>
              <strong>关闭</strong>
              <span>报告与用例字体</span>
              <strong>黑色宋体</strong>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
const endpoints: Record<ModelProfile["provider"], string> = {
  DeepSeek: "https://api.deepseek.com",
  Qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  GLM: "https://open.bigmodel.cn/api/paas/v4",
  Custom: "",
};
export function ModelEditor({
  profile,
  busy,
  onClose,
  onSave,
}: {
  profile?: ModelProfile;
  busy: boolean;
  onClose: () => void;
  onSave: (m: ModelProfile) => void;
}) {
  const [draft, setDraft] = useState<ModelProfile>(
    profile
      ? { ...profile, apiKey: "" }
      : {
          id: "",
          name: "",
          provider: "DeepSeek",
          baseUrl: endpoints.DeepSeek,
          model: "",
          apiKey: "",
          enabled: true,
          timeout: 90,
          maxTokens: 4096,
        },
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{profile ? "编辑模型配置" : "添加分析模型"}</DialogTitle>
          <DialogDescription>
            模型名称按服务商实际提供的 ID 填写。保存后可测试连接。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <FieldGroup>
            <FieldGroup className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="model-name">配置名称</FieldLabel>
                <Input
                  id="model-name"
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="例如：团队分析模型"
                />
              </Field>
              <Field>
                <FieldLabel>服务商</FieldLabel>
                <Select
                  value={draft.provider}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      provider: v as ModelProfile["provider"],
                      baseUrl: endpoints[v as ModelProfile["provider"]],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.keys(endpoints).map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="model-url">Base URL</FieldLabel>
              <Input
                id="model-url"
                type="url"
                required
                value={draft.baseUrl}
                onChange={(e) =>
                  setDraft({ ...draft, baseUrl: e.target.value })
                }
              />
              <FieldDescription>
                填写兼容接口的基础地址，不包括 /chat/completions。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-key">API Key</FieldLabel>
              <Input
                id="model-key"
                type="password"
                autoComplete="new-password"
                required={!profile?.hasKey}
                value={draft.apiKey || ""}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder={
                  profile?.hasKey ? "留空保留原密钥" : "仅在后端加密保存"
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-id">模型 ID</FieldLabel>
              <Input
                id="model-id"
                required
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="填写你账号可调用的模型名称"
              />
            </Field>
            <FieldGroup className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="model-timeout">超时（秒）</FieldLabel>
                <Input
                  id="model-timeout"
                  required
                  type="number"
                  min={5}
                  max={300}
                  value={draft.timeout}
                  onChange={(e) =>
                    setDraft({ ...draft, timeout: Number(e.target.value) })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="model-tokens">最大输出 Token</FieldLabel>
                <Input
                  id="model-tokens"
                  required
                  type="number"
                  min={100}
                  max={32000}
                  value={draft.maxTokens}
                  onChange={(e) =>
                    setDraft({ ...draft, maxTokens: Number(e.target.value) })
                  }
                />
              </Field>
            </FieldGroup>
            {draft.provider === "Qwen" && (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="model-thinking">Qwen 思考模式</FieldLabel>
                <Switch
                  id="model-thinking"
                  checked={draft.thinking ?? false}
                  onCheckedChange={(thinking) =>
                    setDraft({ ...draft, thinking })
                  }
                />
              </Field>
            )}
            {draft.provider === "Qwen" && (
              <FieldDescription>
                支持该参数的 Qwen
                混合思考模型默认关闭思考，减少批量分析等待；开启会增加时间和
                Token 消耗。
              </FieldDescription>
            )}
            <FieldDescription>
              体检结束后可在“分析与用例”中手动选择模型并启动分析；分析过程中可随时停止。汇总仅使用精简的问题信息，避免重复发送原始证据。
            </FieldDescription>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="model-enabled">启用该模型</FieldLabel>
              <Switch
                id="model-enabled"
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              <Save data-icon="inline-start" />
              保存模型配置
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

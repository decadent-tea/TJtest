export type RunStatus =
  | "RECORDING"
  | "PAUSED"
  | "REPLAYING"
  | "COMPLETED"
  | "COMPLETED_WITH_ISSUES"
  | "INTERRUPTED";
export type StepStatus =
  | "RECORDED"
  | "RUNNING"
  | "PASSED"
  | "EXECUTED"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED";
export type ActionKind =
  | "goto"
  | "click"
  | "hover"
  | "fill"
  | "press"
  | "check"
  | "select"
  | "scroll"
  | "assert"
  | "upload"
  | "dialog";
export interface LocatorHint {
  kind: "testId" | "role" | "label" | "css" | "xpath" | "text" | "placeholder";
  value: string;
  name?: string;
}
export interface Operation {
  id: string;
  sequence: number;
  pageId: string;
  openerPageId?: string;
  navigationMode?: "navigate" | "observe";
  framePath: string[];
  timestamp: string;
  kind: ActionKind;
  label: string;
  module: string;
  scene: string;
  url: string;
  locators: LocatorHint[];
  value?: string;
  variable?: string;
  key?: string;
  checked?: boolean;
  position?: { x: number; y: number; width: number; height: number };
  hoverPosition?: { x: number; y: number };
  clickPosition?: { x: number; y: number };
  clickButton?: "left" | "middle" | "right";
  clickModifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
  scroll?: { x: number; y: number };
  status: StepStatus;
  error?: string;
  screenshot?: string;
  duration?: number;
  dependsOn: string[];
  timeout: number;
  assertion?: string;
  effect: "read" | "write";
  enabled: boolean;
}
export interface NetworkCall {
  occurrences?: number;
  lastSeen?: string;
  maxDuration?: number;
  id: string;
  pageId: string;
  stepId?: string;
  startedAt: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  duration?: number;
  failure?: string;
  bodyNote?: string;
  description: string;
  module: string;
  category: "business" | "background" | "resource" | "initialization";
  confidence: number;
}
export interface LogEvent {
  occurrences?: number;
  lastSeen?: string;
  id: string;
  timestamp: string;
  pageId: string;
  stepId?: string;
  level: string;
  text: string;
  location?: string;
}
export interface Finding {
  id: string;
  disposition?: "open" | "investigating" | "resolved";
  note?: string;
  deleted?: boolean;
  severity: "high" | "medium" | "low";
  title: string;
  module: string;
  detail: string;
  evidenceIds: string[];
  source: "rule" | "ai";
  category?:
    | "functional"
    | "interface"
    | "frontend"
    | "performance"
    | "security"
    | "data"
    | "usability"
    | "stability";
  confidence?: "high" | "medium" | "low";
  observation?: string;
  impact?: string;
  reproductionSteps?: string[];
  possibleCause?: string;
  suggestion?: string;
  validationSteps?: string[];
}
export interface TestCase {
  id: string;
  module: string;
  title: string;
  steps: string[];
  expected: string;
  actual: string;
  status: StepStatus;
  evidenceIds: string[];
}
export interface Analysis {
  status: "NONE" | "RUNNING" | "COMPLETED" | "FAILED";
  summary?: string;
  conclusion?: string;
  error?: string;
  provider?: string;
  model?: string;
  generatedAt?: string;
  usage?: unknown;
  jobId?: string;
  startedAt?: string;
  activity?: {
    stage:
      | "connecting"
      | "receiving"
      | "generating"
      | "retrying"
      | "validating"
      | "splitting";
    label: string;
    batch: number;
    attempt: number;
    requestStartedAt: string;
    updatedAt: string;
    receivedCharacters: number;
    reasoningCharacters: number;
    timeoutSeconds: number;
    lastError?: string;
  };
  activeRequests?: NonNullable<Analysis["activity"]>[];
  progress?: {
    phase: "batches" | "summary";
    completed: number;
    total: number;
    processedRecords: number;
    totalRecords: number;
    resumed: boolean;
  };
  coverage?: {
    steps: number;
    requests: number;
    logs: number;
    omittedResources: number;
    truncatedFields: number;
    analysisRecords?: number;
    groupedRecords?: number;
  };
  warnings?: string[];
  findings: Finding[];
  caseDescriptions?: {
    stepId: string;
    title: string;
    expected: string;
    verdict?: "passed" | "failed" | "limited";
    reason?: string;
  }[];
}
export interface Run {
  captureStats?: {
    requests: number;
    logs: number;
    filteredRequests: number;
    filteredLogs: number;
    mergedRequests: number;
    mergedLogs: number;
  };
  id: string;
  name: string;
  project: string;
  environment: string;
  url: string;
  mode: "record" | "replay";
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  flowId?: string;
  flowVersion?: number;
  viewport?: { width: number; height: number };
  interruption?: {
    reason: string;
    at: string;
    stepId?: string;
    sequence?: number;
    label?: string;
  };
  scene: string;
  archived: boolean;
  operations: Operation[];
  requests: NetworkCall[];
  logs: LogEvent[];
  notes: string[];
  findings: Finding[];
  cases: TestCase[];
  analysis: Analysis;
  pendingDialog?: { id: string; pageId: string; type: string; message: string };
}
export interface Flow {
  id: string;
  name: string;
  project: string;
  url: string;
  version: number;
  sourceRunId: string;
  viewport?: { width: number; height: number };
  createdAt: string;
  updatedAt: string;
  operations: Operation[];
  variables: string[];
}
export interface ModelProfile {
  id: string;
  name: string;
  provider: "DeepSeek" | "Qwen" | "GLM" | "Custom";
  baseUrl: string;
  model: string;
  apiKey?: string;
  hasKey?: boolean;
  enabled: boolean;
  timeout: number;
  maxTokens: number;
  thinking?: boolean;
  aiSynthesis?: boolean;
}
export interface Summary {
  id: string;
  name: string;
  project: string;
  environment: string;
  mode: Run["mode"];
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  operationCount: number;
  requestCount: number;
  issueCount: number;
  archived: boolean;
  analysisStatus: Analysis["status"];
}

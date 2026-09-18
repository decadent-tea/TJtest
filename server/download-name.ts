import type { Run } from "../shared/types";

function filenamePart(value: string) {
  return value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 48);
}

export function downloadName(run: Run, kind: "report" | "cases" | "html") {
  const parts = [filenamePart(run.project), filenamePart(run.name)].filter(Boolean);
  const label = kind === "report" ? "体检报告" : "体检用例";
  const extension = kind === "report" ? "docx" : kind === "html" ? "html" : "xlsx";
  return `${parts.join("-") || "Web体检"}-${label}.${extension}`;
}

export function attachmentHeader(name: string, fallback: string) {
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

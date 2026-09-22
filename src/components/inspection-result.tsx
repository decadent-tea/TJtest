import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  FileCheck2,
  ListTree,
} from "lucide-react";
import { Button } from "./ui/button";
import { Blank, PageTitle } from "./studio";
import { reportContent } from "../../shared/report-content";
import { finalFindings } from "../../server/evidence-quality";
import { caseView } from "../../server/case-view";
import type { Finding, Run } from "../../shared/types";
import { time } from "@/lib/api";

export function InspectionResult({
  run,
  onBack,
  onEvidence,
  onDownload,
  downloading,
}: {
  run: Run;
  onBack: () => void;
  onEvidence: (finding: Finding) => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [run.id]);
  const blocks = useMemo(() => reportContent(run), [run]);
  const findings = finalFindings(run);
  const headings = blocks.flatMap((block, index) =>
    block.kind === "heading"
      ? [{ ...block, id: `result-section-${index}` }]
      : [],
  );
  const [current, setCurrent] = useState("");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLElement>("[data-report-anchor]"),
        );
        const target =
          anchors
            .filter((item) => item.getBoundingClientRect().top <= 190)
            .at(-1) || anchors[0];
        if (target) setCurrent(target.id);
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, [run.id, blocks.length]);
  const jump = (id: string) => {
    setCurrent(id);
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  };
  if (run.analysis.status !== "COMPLETED")
    return (
      <Blank
        title="体检结果尚未生成"
        description={
          run.analysis.status === "RUNNING"
            ? "分析正在进行，请返回执行证据查看进度。"
            : "完成 AI 分析后，即可阅读完整体检结果。"
        }
        action={<Button onClick={onBack}>返回执行证据</Button>}
      />
    );
  return (
    <motion.div
      className="inspection-result"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <Button variant="ghost" onClick={onBack} className="mb-5">
        <ArrowLeft data-icon="inline-start" />
        返回执行证据
      </Button>
      <PageTitle
        eyebrow="INSPECTION / RESULTS"
        title="体检结果"
        description={`${run.name} · ${run.project} · ${run.environment}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/runs/${run.id}/cases.xlsx`}>
                <Download data-icon="inline-start" />
                导出用例
              </a>
            </Button>
            <Button
              variant="feature"
              disabled={downloading}
              onClick={onDownload}
            >
              <Download data-icon="inline-start" />
              {downloading ? "正在生成报告…" : "下载体检报告"}
            </Button>
          </>
        }
      />
      <div className="result-status">
        <span>
          <FileCheck2 size={17} />
          分析已完成
        </span>
        <span>
          {run.analysis.provider} / {run.analysis.model} ·{" "}
          {time(run.analysis.generatedAt)}
        </span>
      </div>
      <div className="result-risk-overview" aria-label="风险分布">
        {(["high", "medium", "low"] as const).map((severity, index) => {
          const label = { high: "高风险", medium: "中风险", low: "低风险" }[
            severity
          ];
          const count = findings.filter((f) => f.severity === severity).length;
          const heading = headings.find(
            (h) => h.text === `4.3.${index + 1} ${label}`,
          );
          return (
            <motion.button
              type="button"
              key={severity}
              className="risk-overview-item"
              data-severity={severity}
              onClick={() => heading && jump(heading.id)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="risk-overview-label">
                <i />
                {label}
                <ArrowUpRight size={16} />
              </span>
              <span className="risk-overview-count">
                {count}
                <small>项</small>
              </span>
              <span className="risk-overview-caption">
                {
                  [
                    "优先确认影响，安排修复",
                    "结合业务路径逐项验证",
                    "纳入后续优化与观察",
                  ][index]
                }
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="result-reader">
        <aside className="result-outline">
          <div className="result-outline-title">
            <ListTree size={17} />
            报告章节
          </div>
          <nav aria-label="报告章节导航">
            {headings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                data-level={heading.level}
                aria-current={current === heading.id ? "location" : undefined}
                title={heading.text}
                onClick={() => jump(heading.id)}
              >
                {heading.text}
              </button>
            ))}
            <button
              type="button"
              aria-current={current === "result-cases" ? "location" : undefined}
              onClick={() => jump("result-cases")}
            >
              执行用例明细
            </button>
          </nav>
          <p>
            点击章节快速定位
            <br />
            结论仅适用于本次采集范围
          </p>
        </aside>
        <article className="result-document" aria-label="体检报告正文">
          {blocks.map((block, index) => {
            if (block.kind === "heading") {
              const Tag = `h${block.level + 1}` as "h2" | "h3" | "h4" | "h5";
              const match = block.text.match(/^4\.3\.(\d+)\.(\d+) /);
              const finding = match
                ? findings.filter(
                    (f) =>
                      f.severity ===
                      ["high", "medium", "low"][Number(match[1]) - 1],
                  )[Number(match[2]) - 1]
                : undefined;
              return (
                <div
                  key={index}
                  className="result-heading"
                  data-level={block.level}
                  id={`result-section-${index}`}
                  data-report-anchor
                  tabIndex={-1}
                >
                  <Tag>{block.text}</Tag>
                  {finding && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEvidence(finding)}
                    >
                      定位证据
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                  )}
                </div>
              );
            }
            if (block.kind === "paragraph")
              return (
                <p key={index}>
                  {block.boldPrefix ? (
                    <>
                      <strong>{block.boldPrefix}</strong>
                      {block.text.slice(block.boldPrefix.length)}
                    </>
                  ) : (
                    block.text
                  )}
                </p>
              );
            return (
              <div className="result-table-wrap" key={index}>
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((header) => (
                        <th key={header} scope="col">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <div
            className="result-heading"
            data-level={1}
            id="result-cases"
            data-report-anchor
            tabIndex={-1}
          >
            <h2>执行用例明细</h2>
          </div>
          <p>
            通过表示本步操作目标达成。完整用例可通过页面上方“导出用例”下载。
          </p>
          {run.cases.length ? (
            <div className="result-table-wrap">
              <table>
                <thead>
                  <tr>
                    {["操作", "接口 / Console", "是否通过", "问题与建议"].map(
                      (text) => (
                        <th key={text} scope="col">
                          {text}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {run.cases.map((item) => {
                    const view = caseView(run, item);
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.title}</strong>
                          <br />
                          {view.operation}
                        </td>
                        <td>
                          {view.interface}
                          <br />
                          {view.console}
                        </td>
                        <td>{view.result}</td>
                        <td>
                          {view.problem}
                          <br />
                          {view.solution}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>本次没有执行用例。</p>
          )}
        </article>
      </div>
    </motion.div>
  );
}

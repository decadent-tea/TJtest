import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import type { Run } from "../shared/types";
import { finalizeReport } from "./report";
import { caseView } from "./case-view";
import { countOf } from "./evidence-quality";

const template = fileURLToPath(
  new URL("../templates/yonglimoban.xlsx", import.meta.url),
);
const headers = [
  "序号",
  "功能模块",
  "用例名称",
  "操作",
  "接口",
  "Console",
  "预期结果",
  "实际结果",
  "是否通过",
  "问题描述",
  "解决方案",
  "接口调用数",
  "Console 条数",
  "执行时间",
];
const widths = [10, 20, 28, 36, 48, 48, 34, 38, 18, 46, 46, 14, 16, 22];

export async function casesWorkbook(run: Run) {
  finalizeReport(run);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(template);
  workbook.creator = "北斗天地 Web 体检平台";
  workbook.created = new Date();
  const sheet = workbook.worksheets[0];
  for (const other of workbook.worksheets.slice(1))
    workbook.removeWorksheet(other.id);
  sheet.unMergeCells("A1:P1");
  sheet.unMergeCells("A5:P5");
  sheet.spliceColumns(16, 1);
  sheet.spliceColumns(14, 1);
  (sheet as unknown as { _columns: unknown[] })._columns.length = headers.length;
  sheet.mergeCells("A1:N1");
  sheet.mergeCells("A5:N5");
  if (sheet.rowCount > 6) sheet.spliceRows(7, sheet.rowCount - 6);
  // ExcelJS retains template-only formatted tail rows after spliceRows.
  (sheet as unknown as { _rows: unknown[] })._rows.length = 6;
  sheet.name = "体检用例清单";
  sheet.getCell("A1").value = `${run.project} Web 体检用例`;
  sheet.getCell("C2").value = run.project;
  sheet.getCell("K3").value = "数据来源";
  sheet.getCell("L3").value = "本次体检记录";
  sheet.getCell("A5").value = "操作、接口与 Console 执行用例";
  sheet.getCell("A3").value = "执行总数";
  sheet.getCell("B3").value = run.cases.length;
  sheet.getCell("C3").value = "通过";
  sheet.getCell("D3").value = {
    formula: `COUNTIF(I7:I${Math.max(7, run.cases.length + 6)},"通过")`,
    result: run.cases.filter((item) => item.status === "PASSED").length,
  };
  sheet.getCell("E3").value = "失败";
  sheet.getCell("F3").value = {
    formula: `COUNTIF(I7:I${Math.max(7, run.cases.length + 6)},"失败")`,
    result: run.cases.filter((item) => item.status === "FAILED").length,
  };
  sheet.getCell("G3").value = "待分析/阻塞/跳过";
  sheet.getCell("H3").value = run.cases.filter(
    (item) => !["PASSED", "FAILED"].includes(item.status),
  ).length;
  sheet.getCell("I3").value = "通过率";
  sheet.getCell("J3").value = {
    formula: "IF(B3=0,0,D3/B3)",
    result: run.cases.length
      ? run.cases.filter((item) => item.status === "PASSED").length /
        run.cases.length
      : 0,
  };
  sheet.getCell("J3").numFmt = "0.0%";
  headers.forEach((heading, index) => {
    const cell = sheet.getRow(6).getCell(index + 1);
    cell.value = heading;
    sheet.getColumn(index + 1).width = widths[index];
    cell.font = {
      name: "宋体",
      size: 11,
      bold: true,
      color: { argb: "FF000000" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD6E5F3" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });
  for (const [index, testCase] of run.cases.entries()) {
    const view = caseView(run, testCase);
    const requests = run.requests.filter((item) =>
      testCase.evidenceIds.includes(item.id),
    );
    const logs = run.logs.filter((item) =>
      testCase.evidenceIds.includes(item.id),
    );
    const row = sheet.getRow(index + 7);
    row.values = [
      index + 1,
      testCase.module,
      testCase.title,
      view.operation,
      view.interface,
      view.console,
      testCase.expected,
      testCase.actual,
      view.result,
      view.problem,
      view.solution,
      requests.reduce((sum, item) => sum + countOf(item), 0),
      logs.reduce((sum, item) => sum + countOf(item), 0),
      run.operations.find((item) => testCase.evidenceIds.includes(item.id))
        ?.timestamp || "",
    ];
    const longFields = [
      view.operation,
      view.interface,
      view.console,
      testCase.expected,
      testCase.actual,
      view.problem,
      view.solution,
    ];
    const longColumns = [4, 5, 6, 7, 8, 10, 11];
    const displayWidth = (value: string) =>
      [...value].reduce(
        (sum, character) => sum + (character.charCodeAt(0) > 255 ? 2 : 1),
        0,
      );
    const lines = Math.max(
      ...longFields.map((value, fieldIndex) =>
        value
          .split("\n")
          .reduce(
            (sum, line) =>
              sum +
              Math.max(
                1,
                Math.ceil(
                  displayWidth(line) /
                    Math.max(10, widths[longColumns[fieldIndex] - 1] - 4),
                ),
              ),
            0,
          ),
      ),
    );
    row.height = Math.min(409, Math.max(58, lines * 16 + 12));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        name: "宋体",
        size: 11,
        color: { argb: "FF000000" },
        bold: Number(cell.col) === 9,
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: [1, 9, 12, 13].includes(Number(cell.col))
          ? "center"
          : "left",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      if (Number(cell.col) === 9)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb:
              testCase.status === "PASSED"
                ? "FFE2F0D9"
                : testCase.status === "FAILED"
                  ? "FFFCE8E6"
                  : "FFF2F2F2",
          },
        };
    });
  }
  for (const rowNumber of [1, 2, 3, 5])
    sheet.getRow(rowNumber).eachCell((cell) => {
      const prior = cell.font;
      cell.font = {
        name: "宋体",
        size: prior.size || 11,
        bold: prior.bold || false,
        color: { argb: "FF000000" },
      };
    });
  sheet.views = [{ state: "frozen", ySplit: 6, xSplit: 2 }];
  sheet.autoFilter = {
    from: "A6",
    to: `N${Math.max(6, run.cases.length + 6)}`,
  };
  sheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:6",
    printArea: `A1:N${Math.max(6, run.cases.length + 6)}`,
  };
  return workbook.xlsx.writeBuffer();
}

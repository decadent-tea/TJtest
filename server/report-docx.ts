import { refreshReportFields } from "./report-fields";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Run } from "../shared/types";
import { finalizeReport, reportText, reportBlocks } from "./report";

const template = fileURLToPath(
  new URL("../templates/baogaomoban.docx", import.meta.url),
);
const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character]!,
    );
const font = (size = 28, bold = false) =>
  `<w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/><w:b w:val="${bold ? 1 : 0}"/><w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
const run = (value: string, size = 28, bold = false) =>
  `<w:r>${font(size, bold)}<w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
function paragraph(
  value: string,
  role:
    | "body"
    | "conclusion"
    | "title"
    | "h1"
    | "h2"
    | "h3"
    | "case"
    | "toc"
    | "contents"
    | "table" = "body",
  boldPrefix?: string,
) {
  const configuration = {
    body: {
      size: 28,
      before: 0,
      after: 160,
      line: 560,
      indent: 560,
      bold: false,
      align: "left",
      style: "",
    },
    conclusion: {
      size: 28,
      before: 0,
      after: 160,
      line: 560,
      indent: 560,
      bold: false,
      align: "left",
      style: "",
    },
    title: {
      size: 44,
      before: 900,
      after: 520,
      line: 600,
      indent: 0,
      bold: true,
      align: "center",
      style: "44",
    },
    h1: {
      size: 32,
      before: 260,
      after: 120,
      line: 480,
      indent: 0,
      bold: true,
      align: "left",
      style: "2",
    },
    h2: {
      size: 30,
      before: 180,
      after: 80,
      line: 440,
      indent: 0,
      bold: true,
      align: "left",
      style: "3",
    },
    h3: {
      size: 28,
      before: 180,
      after: 80,
      line: 440,
      indent: 0,
      bold: true,
      align: "left",
      style: "4",
    },
    case: {
      size: 28,
      before: 180,
      after: 80,
      line: 440,
      indent: 0,
      bold: true,
      align: "left",
      style: "5",
    },
    toc: {
      size: 24,
      before: 0,
      after: 70,
      line: 380,
      indent: 0,
      bold: false,
      align: "left",
      style: "",
    },
    contents: {
      size: 32,
      before: 260,
      after: 120,
      line: 480,
      indent: 0,
      bold: true,
      align: "center",
      style: "248",
    },
    table: {
      size: 22,
      before: 0,
      after: 0,
      line: 360,
      indent: 0,
      bold: false,
      align: "left",
      style: "",
    },
  }[role];
  const properties = `<w:pPr>${configuration.style ? `<w:pStyle w:val="${configuration.style}"/>` : ""}${["h1", "h2", "h3", "case"].includes(role) ? '<w:numPr><w:numId w:val="0"/></w:numPr><w:keepNext/><w:keepLines/>' : ""}<w:spacing w:before="${configuration.before}" w:after="${configuration.after}" w:line="${configuration.line}" w:lineRule="exact"/><w:ind w:firstLine="${configuration.indent}"/><w:jc w:val="${configuration.align}"/>${role === "conclusion" ? "<w:keepLines/>" : ""}</w:pPr>`;
  return `<w:p>${properties}${String(value)
    .split("\n")
    .map((line, index) => {
      const content =
        index === 0 && boldPrefix && line.startsWith(boldPrefix)
          ? run(boldPrefix, configuration.size, true) +
            run(
              line.slice(boldPrefix.length),
              configuration.size,
              configuration.bold,
            )
          : run(line, configuration.size, configuration.bold);
      return `${index ? "<w:r><w:br/></w:r>" : ""}${content}`;
    })
    .join("")}</w:p>`;
}
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
function table(headers: string[], rows: string[][]) {
  const widths =
    headers.length === 2
      ? [2700, 5800]
      : headers.length === 3
        ? [2400, 3500, 2600]
        : Array.from({ length: headers.length }, () =>
            Math.floor(8500 / headers.length),
          );
  const cell = (value: string, width: number, heading: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>${heading ? '<w:shd w:fill="E7E7E7"/>' : ""}</w:tcPr>${paragraph(value, "table")}</w:tc>`;
  const row = (values: string[], heading: boolean) =>
    `<w:tr><w:trPr>${heading ? "<w:tblHeader/>" : ""}</w:trPr>${values.map((value, index) => cell(value, widths[index], heading)).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="8500" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="B0B0B0"/><w:insideV w:val="single" w:sz="4" w:color="B0B0B0"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${row(headers, true)}${rows.map((values) => row(values, false)).join("")}</w:tbl>`;
}

export async function reportDocx(runData: Run): Promise<Buffer> {
  finalizeReport(runData);
  const safe = (value: unknown) => reportText(runData, value);
  const output: string[] = [];
  const add = (value: string) => output.push(value);
  const blocks = reportBlocks(runData);
  // Cover paragraphs and TOC geometry come directly from the retained reference.
  const zip = await JSZip.loadAsync(await readFile(template));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("报告模板缺少 document.xml");
  const source = await documentFile.async("string");
  const sourceParagraphs = [
    ...source.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
  ].map((m) => m[0]);
  const normalizeFont = (value: string) =>
    value
      .replace(
        /<w:rFonts[^>]*\/>/g,
        '<w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体" w:cs="SimSun"/>',
      )
      .replace(/<w:color[^>]*\/>/g, '<w:color w:val="000000"/>');
  const slot = (source: string, value: string) => {
    let first = true;
    return source.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
      const out = first
        ? '<w:t xml:space="preserve">' + xml(value) + "</w:t>"
        : "";
      first = false;
      return out;
    });
  };
  for (let i = 0; i <= 20; i++) {
    let part = sourceParagraphs[i];
    if (i === 5) part = slot(part, safe(runData.project));
    if (i === 6) part = slot(part, "Web 体检报告");
    if (i === 20)
      part = slot(
        part,
        "编制日期：" +
          new Date().getFullYear() +
          "年" +
          (new Date().getMonth() + 1) +
          "月",
      );
    add(normalizeFont(part).replace(/<w:bookmark(?:Start|End)[^>]*\/>/g, ""));
  }
  const templateSections = [
    ...source.matchAll(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g),
  ].map((m) => m[0]);
  add("<w:p><w:pPr>" + templateSections[0] + "</w:pPr></w:p>");
  add(paragraph("目录", "contents"));
  add(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
  );
  for (const [i, b] of blocks.entries())
    if (b.kind === "heading" && b.level <= 3) {
      add(
        '<w:p><w:pPr><w:pStyle w:val="' +
          { 1: "30", 2: "38", 3: "22" }[b.level as 1 | 2 | 3] +
          '"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8504"/></w:tabs></w:pPr>' +
          run(b.text, 24) +
          '<w:r><w:tab/></w:r><w:fldSimple w:instr=" PAGEREF HealthHeading' +
          i +
          ' \\h "><w:r>' +
          font(24) +
          "<w:t> </w:t></w:r></w:fldSimple></w:p>",
      );
    }
  add('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  add("<w:p><w:pPr>" + templateSections[1] + "</w:pPr></w:p>");
  for (const [i, b] of blocks.entries()) {
    if (b.kind === "heading")
      add(
        paragraph(
          b.text,
          ({ 1: "h1", 2: "h2", 3: "h3", 4: "case" } as const)[b.level],
        )
          .replace(
            "</w:pPr>",
            '</w:pPr><w:bookmarkStart w:id="' +
              (10000 + i) +
              '" w:name="HealthHeading' +
              i +
              '"/>',
          )
          .replace(
            "</w:p>",
            '<w:bookmarkEnd w:id="' + (10000 + i) + '"/></w:p>',
          ),
      );
    else if (b.kind === "paragraph")
      add(paragraph(b.text, "body", b.boldPrefix));
    else add(table(b.headers, b.rows));
  }
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile)
    zip.file(
      "word/styles.xml",
      normalizeFont(await stylesFile.async("string")).replace(
        /<w:style\b[^>]*w:styleId="44"[^>]*>[\s\S]*?<\/w:style>/g,
        (style) => style.replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/g, ""),
      ),
    );
  const prefix = source.slice(
    0,
    source.indexOf("<w:body>") + "<w:body>".length,
  );
  const sectionStart = source.lastIndexOf(
    "<w:sectPr>",
    source.lastIndexOf("</w:body>"),
  );
  const sectionEnd =
    source.indexOf("</w:sectPr>", sectionStart) + "</w:sectPr>".length;
  let section =
    sectionStart >= 0 && sectionEnd > sectionStart
      ? source.slice(sectionStart, sectionEnd)
      : undefined;
  if (!section) throw new Error("报告模板缺少页面设置");
  const headerRef =
    source.match(/<w:headerReference[^>]*w:type="default"[^>]*\/>/)?.[0] || "";
  const footerRef =
    templateSections[2]?.match(/<w:footerReference[^>]*\/>/)?.[0] || "";
  section = section.replace(
    "<w:sectPr>",
    "<w:sectPr>" +
      headerRef +
      footerRef +
      '<w:pgNumType w:fmt="decimal" w:start="1"/>',
  );
  zip.file(
    "word/document.xml",
    `${prefix}${output.join("")}${section}</w:body></w:document>`,
  );
  const settingsFile = zip.file("word/settings.xml");
  if (settingsFile) {
    let settings = await settingsFile.async("string");
    settings = settings.replace(/<w:updateFields[^>]*\/>/g, "");
    settings = settings.replace(
      "</w:settings>",
      '<w:updateFields w:val="true"/></w:settings>',
    );
    zip.file("word/settings.xml", settings);
  }
  // Keep template page furniture, replacing only its project title and fonts.
  for (const name of Object.keys(zip.files)) {
    if (/^word\/header\d+\.xml$/.test(name))
      zip.file(
        name,
        normalizeFont(
          slot(
            await zip.file(name)!.async("string"),
            safe(runData.project) + " Web 体检报告",
          ),
        ),
      );
    if (/^word\/footer\d+\.xml$/.test(name))
      zip.file(name, normalizeFont(await zip.file(name)!.async("string")));
  }
  const now = new Date().toISOString();
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(runData.project)} Web 体检报告</dc:title><dc:creator>北斗天地股份有限公司</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>北斗天地 Web 体检平台</Application></Properties>',
  );
  return refreshReportFields(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

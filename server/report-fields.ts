import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
let queue: Promise<unknown> = Promise.resolve();
// Serialize Word automation: exports never share a document or application state.
export function refreshReportFields(buffer: Buffer): Promise<Buffer> {
  const task = queue
    .catch(() => {})
    .then(async () => {
      if (process.platform !== "win32") return buffer;
      const folder = await mkdtemp(join(tmpdir(), "health-report-"));
      try {
        const path = join(folder, "report.docx");
        await writeFile(path, buffer);
        await execute(
          "pwsh",
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            fileURLToPath(
              new URL("../scripts/refresh-report-fields.ps1", import.meta.url),
            ),
            "-DocumentPath",
            path,
          ],
          { windowsHide: true, timeout: 90000 },
        );
        return await readFile(path);
      } catch (error) {
        throw new Error(
          "报告目录页码自动更新失败：" +
            (error instanceof Error ? error.message : String(error)),
        );
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  queue = task;
  return task;
}

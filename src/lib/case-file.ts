/**
 * 用例文件（.playflow.json）导出。
 *
 * 平台把用例导出成一个可离线编辑的 JSON 文件，客户端工作台可以直接导入，
 * 断网时在本机继续编排调试，联网后再「上传到平台」同步成新版本。
 */
import { generatePlaywrightCode } from "./keywords";
import type { TestCase } from "./store";

export const CASE_FILE_KIND = "playflow-case";
export const CASE_FILE_VERSION = 1;

export type CaseFilePayload = {
  kind: typeof CASE_FILE_KIND;
  fileVersion: number;
  exportedAt: string;
  cases: Array<{
    id: string;
    name: string;
    module: string;
    priority: string;
    status: string;
    startUrl: string;
    module_tags: string[];
    isTemplate: boolean;
    params: unknown[];
    steps: unknown[];
    script: string;
  }>;
};

export function buildCaseFile(cases: TestCase[]): CaseFilePayload {
  return {
    kind: CASE_FILE_KIND,
    fileVersion: CASE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    cases: cases.map((c) => ({
      id: c.id,
      name: c.name,
      module: c.module,
      priority: c.priority,
      status: c.status,
      startUrl: c.startUrl ?? "",
      module_tags: c.tags ?? [],
      isTemplate: c.isTemplate ?? false,
      params: c.params ?? [],
      steps: c.steps ?? [],
      script: generatePlaywrightCode(c.name, c.steps ?? []),
    })),
  };
}

/** 文件名里不能出现的字符统一替换掉，避免不同系统保存失败 */
function safeName(name: string): string {
  return (name || "case").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 60);
}

export function downloadCaseFile(cases: TestCase[], fileName?: string): void {
  const payload = buildCaseFile(cases);
  const name =
    fileName ??
    (cases.length === 1
      ? `${safeName(cases[0]!.name)}.playflow.json`
      : `playflow-cases-${cases.length}.playflow.json`);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

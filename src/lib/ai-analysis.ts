type StepResult = {
  index?: number;
  keyword?: string;
  target?: string;
  status?: string;
  durationMs?: number;
  error?: string;
};

type RunRow = Record<string, unknown>;

const safeSteps = (value: unknown): StepResult[] => (Array.isArray(value) ? (value as StepResult[]) : []);

export function normalizeError(value: unknown) {
  return String(value ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "<URL>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<ID>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)?\b/gi, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function analyzeStepResults(rows: RunRow[], limit = 20) {
  const failures = new Map<string, Record<string, unknown>>();
  const slow = new Map<string, { keyword: string; count: number; totalDurationMs: number; maxDurationMs: number; cases: Set<string> }>();

  for (const row of rows) {
    const caseId = String(row["case_id"] ?? "");
    const caseName = String(row["case_name"] ?? "未知用例");
    const runId = String(row["id"] ?? "");
    for (const step of safeSteps(row["steps"])) {
      const keyword = String(step.keyword || "未知步骤");
      const durationMs = Number(step.durationMs ?? 0);
      const duration = slow.get(keyword) ?? {
        keyword,
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        cases: new Set<string>(),
      };
      duration.count += 1;
      duration.totalDurationMs += Math.max(0, durationMs);
      duration.maxDurationMs = Math.max(duration.maxDurationMs, durationMs);
      duration.cases.add(caseName);
      slow.set(keyword, duration);

      if (step.status !== "failed") continue;
      const signature = normalizeError(step.error ?? row["error"]);
      const key = `${keyword}\n${signature}`;
      const item = failures.get(key) ?? {
        keyword,
        target: String(step.target ?? ""),
        signature,
        count: 0,
        caseIds: new Set<string>(),
        caseNames: new Set<string>(),
        runIds: new Set<string>(),
      };
      item.count = Number(item.count) + 1;
      (item.caseIds as Set<string>).add(caseId);
      (item.caseNames as Set<string>).add(caseName);
      (item.runIds as Set<string>).add(runId);
      failures.set(key, item);
    }
  }

  return {
    failures: [...failures.values()]
      .map((item) => ({
        ...item,
        caseIds: [...(item.caseIds as Set<string>)].filter(Boolean),
        caseNames: [...(item.caseNames as Set<string>)],
        runIds: [...(item.runIds as Set<string>)].filter(Boolean),
      }))
      .sort((a, b) => Number(b.count) - Number(a.count))
      .slice(0, limit),
    slowSteps: [...slow.values()]
      .map((item) => ({
        keyword: item.keyword,
        count: item.count,
        totalDurationMs: item.totalDurationMs,
        avgDurationMs: Math.round(item.totalDurationMs / Math.max(1, item.count)),
        maxDurationMs: item.maxDurationMs,
        caseNames: [...item.cases],
      }))
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
      .slice(0, limit),
  };
}

function stepTokens(value: unknown) {
  return new Set(
    (Array.isArray(value) ? value : []).map((raw) => {
      const step = (raw ?? {}) as Record<string, unknown>;
      return ["keyword", "target", "value"]
        .map((key) => String(step[key] ?? "").trim().toLowerCase().replace(/\s+/g, " "))
        .join("|");
    }),
  );
}

export function findSimilarCases(cases: RunRow[], threshold = 0.8, limit = 20) {
  const groups = [];
  for (let i = 0; i < cases.length; i += 1) {
    const left = stepTokens(cases[i]?.["steps"]);
    if (!left.size) continue;
    for (let j = i + 1; j < cases.length; j += 1) {
      const right = stepTokens(cases[j]?.["steps"]);
      if (!right.size) continue;
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size;
      const similarity = union ? intersection / union : 0;
      if (similarity < threshold) continue;
      groups.push({
        similarity: Math.round(similarity * 100),
        left: { id: cases[i]?.["id"], name: cases[i]?.["name"], module: cases[i]?.["module"] },
        right: { id: cases[j]?.["id"], name: cases[j]?.["name"], module: cases[j]?.["module"] },
        sharedSteps: intersection,
        totalDistinctSteps: union,
      });
    }
  }
  return groups.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
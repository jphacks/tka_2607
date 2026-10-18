import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  aCompanyApi,
  clinicResultsApi,
  partnerPortalApi,
} from "../eval/golden";
import { score } from "../eval/score";
import { readConfig, readSources, scan } from "../src/scanner";
import type { Project } from "../src/types";

const dir = resolve(import.meta.dir, "../../../samples/a_company_api");
const partnerPortalDir = resolve(
  import.meta.dir,
  "../../../samples/partner_portal_api",
);
const clinicResultsDir = resolve(
  import.meta.dir,
  "../../../samples/clinic_results_api",
);

test("サンプルの指摘が golden と1対1に対応する", () => {
  const findings = scan(dir);
  const checks = score(
    {
      findings,
      issues: [],
      dismissed: [],
      architecture: { nodes: [], edges: [] },
      flows: [],
      uncovered_features: [],
    } as unknown as Project,
    aCompanyApi,
  );
  expect(checks.find((c) => c.name === "findings_match")).toMatchObject({
    ok: true,
  });
  expect(findings).toHaveLength(aCompanyApi.findings.length);
});

test("スキャナが拾わない既知の欠陥(known_gaps)が、題材に実在する", () => {
  for (const g of aCompanyApi.known_gaps ?? [])
    expect(readFileSync(resolve(dir, g.file), "utf8")).toContain(g.match);
});

test("AI に渡る文面に、題材だと明かす言葉がない", () => {
  const text = readSources(dir, 60_000, scan(dir)) + readConfig(dir);
  for (const w of ["わざと", "サンプル", "デモ", "故意"])
    expect(text).not.toContain(w);
});

test("実践的な複数ファイルAPIで複合した欠陥だけを検出する", () => {
  const findings = scan(partnerPortalDir);
  const checks = score(
    {
      findings,
      issues: [],
      dismissed: [],
      architecture: { nodes: [], edges: [] },
      flows: [],
      uncovered_features: [],
    } as unknown as Project,
    partnerPortalApi,
  );
  expect(checks.find((check) => check.name === "findings_match")).toMatchObject(
    { ok: true },
  );
  expect(findings).toHaveLength(partnerPortalApi.findings.length);
  expect(
    findings.some((finding) => finding.file === "src/routes/safe-preview.ts"),
  ).toBe(false);
});

test("情報漏洩デモAPIの欠陥が正解表と1対1に対応する", () => {
  const findings = scan(clinicResultsDir);
  const checks = score(
    {
      findings,
      issues: [],
      dismissed: [],
      architecture: { nodes: [], edges: [] },
      flows: [],
      uncovered_features: [],
    } as unknown as Project,
    clinicResultsApi,
  );
  expect(checks.find((check) => check.name === "findings_match")).toMatchObject(
    { ok: true },
  );
  expect(findings).toHaveLength(clinicResultsApi.findings.length);
});

test("情報漏洩デモAPIにAI向けの既知の欠陥が実在する", () => {
  for (const gap of clinicResultsApi.known_gaps ?? []) {
    expect(readFileSync(resolve(clinicResultsDir, gap.file), "utf8")).toContain(
      gap.match,
    );
  }
});

test("情報漏洩デモAPIの検査入力にデモだと明かす言葉がない", () => {
  const text =
    readSources(clinicResultsDir, 60_000, scan(clinicResultsDir)) +
    readConfig(clinicResultsDir) +
    readFileSync(resolve(clinicResultsDir, "background.json"), "utf8");
  for (const word of ["わざと", "サンプル", "デモ", "故意", "退職", "委託"]) {
    expect(text).not.toContain(word);
  }
  expect(text).toContain("自分のものではない患者IDでも検査結果が表示された");
});

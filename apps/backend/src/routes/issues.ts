import { attackScenariosResultSchema, SIM_DAYS } from "@tka/shared";
import { Hono } from "hono";
import { z } from "zod";
import { generate } from "../ai/client";
import { chatTurn, opening } from "../chat";
import { ifIgnoredFor, uniqueDay } from "../clean";
import { applyFix } from "../fix";
import { HttpError, readBody } from "../http";
import {
  currentDir,
  findIssue,
  loadProject,
  nextIssueId,
  projectPayload,
  saveLesson,
  unskip,
} from "../project";
import { attackPrompt, attackSystem } from "../prompts/attack";
import * as repo from "../repo";
import { readSources, relocate } from "../scanner";
import type { Issue } from "../types";

// 他のルートと同じく /api/projects に繋ぐ。パスは /:pid/issues/:iid/...
export default new Hono()
  .post("/:pid/issues/:iid/chat/start", (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    if (issue.chat.length === 0) {
      issue.chat = opening(issue);
      issue.phase = "investigate";
      repo.saveProject(p);
    }
    return c.json(issue);
  })
  .post("/:pid/issues/:iid/chat", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    const body = await readBody(
      c,
      z.object({
        text: z.string().default(""),
        hint: z.boolean().default(false),
      }),
    );
    await chatTurn(p, issue, body);
    return c.json(issue);
  })
  // 会話で決めた方針を確定して、コードと構成に反映する
  .post("/:pid/issues/:iid/commit", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    const body = await readBody(
      c,
      z.object({ plan: z.string(), reason: z.string().default("") }),
    );
    const plan = body.plan.trim();
    if (plan.length < 5) throw new HttpError(400, "どう直すかを書いてください");
    if (issue.skipped) unskip(p, issue);
    issue.chosen = {
      label: plan.split("。")[0]?.slice(0, 30) ?? "",
      change_summary: plan,
    };
    issue.decision = {
      option_index: null,
      plan,
      reason: body.reason.trim() || issue.plan_draft?.reason || "",
      at: repo.now(),
    };
    if (issue.chat.length === 0) issue.chat = opening(issue);
    issue.chat.push({ role: "event", kind: "decided", text: plan });
    delete issue.plan_draft;
    repo.saveProject(p);
    await applyFix(p, issue);
    repo.saveProject(p);
    return c.json({ issue, project: projectPayload(p) });
  })
  .post("/:pid/issues/:iid/skip", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    const { reason: raw } = await readBody(c, z.object({ reason: z.string() }));
    if (issue.feedback)
      throw new HttpError(400, "対応済みの出来事は見送れません");
    if (issue.prevented_by)
      throw new HttpError(400, "この出来事は修正で回避されています");
    const reason = raw.trim();
    if (reason.length < 2)
      throw new HttpError(400, "見送る理由を一言書いてください");
    unskip(p, issue);
    const ii = ifIgnoredFor(issue);
    issue.skipped = {
      reason,
      at: repo.now(),
      impact: ii.impact,
      impact_reason: ii.reason,
    };
    // 見送ったことが原因で、あとから悪化した出来事を足す
    if (ii.impact === "escalate" && issue.day < SIM_DAYS) {
      const day = uniqueDay(
        Math.max(
          issue.day + 1,
          Math.min(SIM_DAYS, issue.day + (ii.after_days || 21)),
        ),
        p.issues.map((o) => o.day),
        SIM_DAYS,
      );
      const esc: Issue = {
        id: nextIssueId(p),
        day,
        chat: [],
        title: issue.title,
        category: issue.category,
        severity: "高",
        what_happens: issue.what_happens,
        who_is_affected: issue.who_is_affected,
        background_link: issue.background_link,
        view: issue.view,
        incident_title: ii.incident_title,
        incident_story: ii.incident_story,
        signals: ii.signals,
        affected_nodes: [...issue.affected_nodes],
        finding_ids: [...issue.finding_ids],
        _rule: issue._rule,
        escalated_from: issue.id,
        stance: "",
        decision: null,
        feedback: null,
        lesson: "",
      };
      p.issues.push(esc);
      p.issues.sort((a, b) => a.day - b.day);
      issue.skipped.escalation_id = esc.id;
    }
    repo.saveProject(p);
    repo.addLesson({
      id: `${p.id}-${issue.id}`,
      project_id: p.id,
      project_title: p.background.title,
      issue_title: issue.title,
      rule: issue._rule ?? null,
      category: issue.category,
      stance: "",
      chosen: "今回は対応しない（見送り）",
      reason,
      lesson: "",
      created_at: repo.now(),
    });
    return c.json(projectPayload(p));
  })
  .post("/:pid/issues/:iid/unskip", (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    unskip(p, issue);
    p.sim_day = Math.min(p.sim_day, issue.day);
    repo.saveProject(p);
    return c.json(projectPayload(p));
  })
  .post("/:pid/issues/:iid/lesson", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    const { lesson } = await readBody(c, z.object({ lesson: z.string() }));
    if (!issue.decision) throw new HttpError(400, "先に修正案を選んでください");
    issue.lesson = lesson.trim();
    repo.saveProject(p);
    saveLesson(p, issue);
    return c.json(issue);
  })
  .post("/:pid/issues/:iid/attack-scenarios", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const issue = findIssue(p, c.req.param("iid"));
    const evidence = p.findings.filter((f) => issue.finding_ids.includes(f.id));
    const cur = currentDir(p.id);
    const result = await generate({
      task: "attack_scenarios",
      system: attackSystem({
        bg: p.background,
        issue,
        evidence,
        sources: readSources(cur, 60_000, relocate(cur, evidence)),
      }),
      prompt: attackPrompt(),
      schema: attackScenariosResultSchema,
    });
    issue.attack_scenarios = result.scenarios.slice(0, 4);
    repo.saveProject(p);
    return c.json(issue);
  });

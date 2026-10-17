import { chatResultSchema } from "@tka/shared";
import { generate } from "./ai/client";
import { HttpError } from "./http";
import { saveLesson } from "./project";
import { chatPrompt, chatSystem } from "./prompts/chat";
import * as repo from "./repo";
import type { ChatMessage, Issue, Project } from "./types";

/** 会話の最初。AI を待たずにテンプレートで出す */
export function opening(issue: Issue): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const s of issue.signals) {
    if (s.source.endsWith("から") && s.text) {
      msgs.push({
        role: "stakeholder",
        name: `${s.source.slice(0, -2)}の担当`,
        text: s.text.replace(/^[「」]+|[「」]+$/g, ""),
      });
      break;
    }
  }
  const lead = issue.escalated_from
    ? "前に見送ったあの件、やっぱり表に出てきたね。"
    : issue.caused_by
      ? "この前入れた修正のあとから、これが起きてる。"
      : "これ、ちょっと一緒に見ようか。";
  msgs.push({
    role: "senior",
    name: "先輩",
    text: `${lead}左のログとコード、構成図を見てみて。まず、何が起きてると思う？`,
  });
  return msgs;
}

/** 発言 (またはヒント) を受けて、AI に続きを作らせる。保存は呼び出し側 */
export async function chatTurn(
  p: Project,
  issue: Issue,
  input: { text: string; hint: boolean },
): Promise<void> {
  if (issue.prevented_by)
    throw new HttpError(400, "この出来事は修正で回避されています");
  const text = input.text.trim();
  if (!text && !input.hint)
    throw new HttpError(400, "メッセージを書いてください");
  if (issue.chat.length === 0) issue.chat = opening(issue);

  let phase = issue.phase ?? "investigate";
  // 確認を出したあとで話し続けた → もう一度考える段階に戻す
  if (phase === "ready" && text) {
    phase = "decide";
    delete issue.plan_draft;
  }
  if (text) {
    issue.chat.push({ role: "user", text });
    if (!issue.stance) issue.stance = text;
  }
  if (input.hint) {
    issue.chat.push({ role: "event", kind: "hint", text: "ヒントを求めた" });
    issue.hints = (issue.hints ?? 0) + 1;
  }

  const result = await generate({
    task: "chat",
    system: chatSystem({
      bg: p.background,
      issue,
      evidence: p.findings.filter((f) => issue.finding_ids.includes(f.id)),
      arch: p.architecture,
      attack: issue.attack_scenarios,
      fix: issue.fix
        ? {
            summary: issue.fix.summary,
            chosen_summary: issue.chosen?.change_summary ?? "",
          }
        : undefined,
    }),
    prompt: chatPrompt({
      history: issue.chat.map((m) => ({
        role: m.role === "event" ? "system" : m.role,
        name: m.name,
        text: m.text,
      })),
      phase,
      hint: input.hint,
    }),
    schema: chatResultSchema,
  });

  for (const m of result.messages.slice(0, 3)) {
    const body = m.text.trim();
    if (!body) continue;
    issue.chat.push({
      role: m.role,
      name: m.name.trim() || (m.role === "senior" ? "先輩" : "関係者"),
      text: body,
    });
  }

  let next = result.phase;
  if (issue.fix) {
    // 修正を反映したあとは、振り返りより前には戻らない
    if (next !== "reflect" && next !== "done") next = "reflect";
  } else if (next === "reflect" || next === "done") {
    next = phase;
  }
  if (next === "ready") {
    const plan = (result.plan ?? "").trim();
    if (plan) {
      issue.plan_draft = { plan, reason: (result.reason ?? "").trim() };
    } else {
      next = "decide";
    }
  }
  issue.phase = next;

  const lesson = (result.lesson ?? "").trim();
  if (next === "done" && lesson && issue.decision) {
    issue.lesson = lesson;
    saveLesson(p, issue);
  }
  repo.saveProject(p);
}

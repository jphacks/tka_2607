import type { Fix } from "#/lib/types";
import { ArchDiagram } from "./ArchDiagram";
import { DiffView } from "./DiffView";

// ノード・線のすべての項目で比べる（名前や向きだけが変わっても「変わった」と出す）
function archKeys(a: Fix["arch_before"]): Set<string> {
  return new Set([
    ...a.nodes.map((n) => JSON.stringify(["n", n.id, n.label, n.kind])),
    ...a.edges.map((e) =>
      JSON.stringify(["e", e.from, e.to, e.label, e.direction, e.kind]),
    ),
  ]);
}

function archChanged(fix: Fix): boolean {
  const before = archKeys(fix.arch_before);
  const after = archKeys(fix.arch_after);
  return before.size !== after.size || [...before].some((k) => !after.has(k));
}

export function FixView({ fix }: { fix: Fix }) {
  const changed = archChanged(fix);

  return (
    <div className="grid gap-4">
      <p className="font-medium">{fix.summary}</p>

      <h3 className="text-sm font-semibold">コードの変化</h3>
      <DiffView diffs={fix.diffs} />

      <h3 className="text-sm font-semibold">構成の変化</h3>
      {changed ? (
        <div className="grid gap-3 md:grid-cols-2">
          <figure className="grid gap-1">
            <figcaption className="text-xs text-muted-foreground">
              修正前
            </figcaption>
            <ArchDiagram compact arch={fix.arch_before} />
          </figure>
          <figure className="grid gap-1">
            <figcaption className="text-xs text-muted-foreground">
              修正後
            </figcaption>
            <ArchDiagram compact arch={fix.arch_after} />
          </figure>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">構成は変わりません。</p>
      )}
      {fix.arch_notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {fix.arch_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h3 className="text-sm font-semibold">この先の運用への影響</h3>
      {/* 起きなくなる・新しく起きる出来事の件数は、先のネタバレになるので出さない */}
      <p className="text-sm text-muted-foreground">
        どの出来事がどう変わったかは、運用を再開して、その日になるとわかります。シークバーに「回避」や新しい出来事として現れます。
      </p>
    </div>
  );
}

/**
 * Pure text→record extraction: the transparent rule-based structurer and the
 * JSON repair helper. No SDK / browser dependencies so they are unit-testable
 * in plain node and reusable by the simulated-answer path in ai.ts.
 */

export interface DefectJson {
  component: string;
  defectType: string;
  quantity: string;
  severity: string;
  notes: string;
}

/**
 * Deterministic keyword extraction so the capture loop still works in a
 * signal-dead browser with no model downloaded. Clearly labelled in the UI
 * (badge says "Rule-based"); never presented as AI output.
 */
export function ruleBasedStructure(note: string): DefectJson {
  const n = note.toLowerCase();
  const defectVocab: [RegExp, string][] = [
    [/efflorescence|white deposit/, "efflorescence"],
    [/seepage|leak|water stain|damp/, "seepage"],
    [/spall|spalling|concrete break/, "spalling"],
    [/delamination|hollow sound/, "delamination"],
    [/corrosion|rust|reinforc\w* expos/, "corrosion / exposed reinforcement"],
    [/crack.*longitudinal|longitudinal.*crack/, "longitudinal crack"],
    [/crack.*transverse|transverse.*crack/, "transverse crack"],
    [/crack/, "crack"],
    [/deflection|sag/, "excessive deflection"],
    [/settlement/, "settlement"],
  ];
  const defectType = defectVocab.find(([re]) => re.test(n))?.[1] ?? "unclassified observation";
  const qty = (note.match(/~?\d+(\.\d+)?\s*(mm|cm|m|sq\.?m|m2)\b/gi) ?? []).join(", ") || "not stated";
  const comp = (note.match(/(?:on|near|at|of)\s+(?:the\s+)?(?:web of\s+)?(girder \w+|deck slab\w*|pier \w+|abutment\w*|bearing\w*|girder \w+|slab\w*|wall\w*|segment \w+)/i) ?? [])[1] ?? "unspecified component";
  let severity: DefectJson["severity"] = "unknown";
  if (/expos\w* (rebar|reinforcement)|severe|large/.test(n)) severity = "severe";
  else if (/\d+(\.\d+)?\s*mm/.test(n) && parseFloat((n.match(/(\d+(\.\d+)?)\s*mm/) ?? ["0"])[0]) > 0.5) severity = "moderate";
  else if (/hairline|minor|small/.test(n)) severity = "minor";
  return { component: comp, defectType, quantity: qty, severity, notes: note.slice(0, 200) };
}

/** Models occasionally wrap JSON in fences; extract the first {...} block. */
export function repairJson(text: string): DefectJson {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * F4 fallback: deterministic severity cross-check against the same reference
 * card the model prompt uses. Produces an honest, clearly-labelled answer
 * when no AI engine is reachable (offline, no device model).
 */
export function ruleBasedCrossCheck(record: DefectJson): string {
  const widths = [...(record.quantity ?? "").matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)].map((m) => parseFloat(m[1]));
  const maxW = widths.length ? Math.max(...widths) : null;
  const lines: string[] = [];
  if (/expos\w* (rebar|reinforcement)|corrosion/i.test(`${record.defectType} ${record.notes}`)) {
    lines.push("Exposed reinforcement → reference says SEVERE regardless of width.");
  }
  if (maxW != null) {
    if (maxW < 0.15) lines.push(`Width ${maxW} mm → hairline (<0.15 mm): monitor at next visit.`);
    else if (maxW <= 0.5) lines.push(`Width ${maxW} mm → minor (0.15–0.5 mm): monitor, measure again next visit.`);
    else lines.push(`Width ${maxW} mm → moderate–severe (>0.5 mm): specialist review recommended.`);
  } else {
    lines.push("No width recorded — measure crack width (crack gauge/comparator) at next visit.");
  }
  const recorded = String(record.severity ?? "unknown").toLowerCase();
  lines.push(`Recorded severity: ${recorded}. (Rule-based check — no AI engine was reachable.)`);
  return lines.join(" ");
}

/**
 * Buyer questions for a category, from fixed templates: no model call, no
 * network, no cost, and the same input always gives the same questions.
 *
 * The product's own name never appears in a question — the point of a check
 * is whether the engines name it unprompted — so anything that would contain
 * it is dropped.
 */

export type SuggestInput = { domain: string; category: string; description?: string; count?: number };

const TEMPLATES: { intent: string; text: (c: string, d: string) => string }[] = [
  { intent: "best_in_category", text: (c) => `what is the best ${c} tool right now?` },
  { intent: "recommendation", text: (c) => `which ${c} software would you recommend for a small team?` },
  { intent: "recommendation", text: (c) => `what ${c} tools do startups use in 2026?` },
  { intent: "use_case", text: (c, d) => (d ? `i need something for ${d}. what ${c} tool should i use?` : `what ${c} tool is easiest to set up?`) },
  { intent: "alternatives", text: (c) => `what are good alternatives to the most popular ${c} tools?` },
  { intent: "use_case", text: (c) => `best ${c} tool for a solo founder on a budget?` },
  { intent: "comparison", text: (c) => `compare the top 5 ${c} tools for features and price` },
  { intent: "use_case", text: (c) => `which ${c} tool works best for agencies with many clients?` },
  { intent: "recommendation", text: (c) => `what ${c} software has the best free plan?` },
  { intent: "use_case", text: (c) => `best ${c} tool for enterprise security and compliance?` },
  { intent: "comparison", text: (c) => `which ${c} tool has the best integrations?` },
  { intent: "best_in_category", text: (c) => `top rated ${c} apps according to reviews` },
];

function brandOf(domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return host.split(".")[0] ?? host;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function suggestPrompts(input: SuggestInput): { text: string; intent: string }[] {
  const category = clean(input.category).replace(/\b(software|tools?|apps?)$/, "").trim() || clean(input.category);
  const description = clean(input.description ?? "").replace(/[.?!]+$/, "");
  const brand = brandOf(input.domain);
  const count = Math.min(Math.max(input.count ?? 10, 1), TEMPLATES.length);
  const seen = new Set<string>();
  const out: { text: string; intent: string }[] = [];
  for (const t of TEMPLATES) {
    const text = clean(t.text(category, description));
    if ((brand.length >= 3 && text.includes(brand)) || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, intent: t.intent });
    if (out.length === count) break;
  }
  return out;
}

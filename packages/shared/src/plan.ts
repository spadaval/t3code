export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`;
}

export function buildPlanToBeadsPrompt(planMarkdown: string): string {
  return [
    "PLEASE CONVERT THIS PLAN INTO BEADS ISSUES.",
    "Generate the necessary beads issues with `bd` for this plan instead of implementing it.",
    planMarkdown.trim(),
  ].join("\n\n");
}

export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (!heading || heading.length === 0) {
    return "Implement plan";
  }
  return `Implement ${heading}`;
}

export function buildPlanToBeadsThreadTitle(planMarkdown: string): string {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (!heading || heading.length === 0) {
    return "Convert plan to beads";
  }
  return `Convert ${heading} to beads`;
}

export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`;
}

export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (!heading || heading.length === 0) {
    return "Implement plan";
  }
  return `Implement ${heading}`;
}

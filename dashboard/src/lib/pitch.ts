import type { Lead } from "./types";

/**
 * Whether this message came from the built-in template rather than the writer.
 *
 * The obvious test, "is there a fallback reason", is wrong, and wrong in the
 * direction that hides the problem. A message written while no AI provider was
 * configured records no reason, because nothing failed: it stores
 * `template/builtin` in `pitchModel` and nothing else. The queue used to fall
 * back to printing `pitchModel` whenever there was no reason, so those leads
 * wore a purple "AI · template/builtin" badge claiming the model had written
 * them. A whole scan's worth of template messages was invisible that way.
 *
 * The model name is the marker. The missing case covers leads saved before the
 * pipeline recorded a writer at all.
 */
export function isTemplatePitch(lead: Pick<Lead, "pitchModel" | "pitchFallbackReason">): boolean {
  if (lead.pitchFallbackReason) return true;
  return !lead.pitchModel || lead.pitchModel.startsWith("template/");
}

/**
 * Why this lead has a template message, in the operator's terms.
 *
 * Two genuinely different situations wear the same badge. One is an outage, in
 * which case the provider said something and that sentence is the only thing
 * worth reading. The other is that the message predates the AI writer entirely,
 * where there is nothing to diagnose and the answer is simply to rewrite it.
 */
export function templatePitchExplanation(
  lead: Pick<Lead, "pitchModel" | "pitchFallbackReason">,
): { headline: string; detail: string | null } {
  if (lead.pitchFallbackReason) {
    return {
      headline: "This lead has the built-in template message, not an AI-written one.",
      detail: lead.pitchFallbackReason,
    };
  }
  return {
    headline: "This message was written before an AI provider was connected.",
    detail: null,
  };
}

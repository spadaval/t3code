import { AsyncResult } from "effect/reactivity";

import type { ComposerDraft } from "../../state/use-composer-drafts";

export const DICTATION_NOTE =
  "(Dictated with speech-to-text, so expect sound-alike errors: words that sound right but are wrong.)";

/** The text to send for a draft; dictated drafts end with a note so the agent reads them charitably. */
export function withDictationNote(
  text: string,
  draft: Pick<ComposerDraft, "dictated">,
  preferences: AsyncResult.AsyncResult<{ readonly dictationNoteEnabled?: boolean }, unknown>,
): string {
  if (draft.dictated !== true || text.length === 0) return text;
  // Unset, or preferences still loading, means on.
  if (AsyncResult.isSuccess(preferences) && preferences.value.dictationNoteEnabled === false) {
    return text;
  }
  return `${text}\n\n${DICTATION_NOTE}`;
}

# @deepseek-ai/dsh-client-ui-user-questions

English | [中文](README.zh.md)

Web question feature plugin: its browser half registers the `question` entry in the conversation-owned `conversation.composer` keyed slot. Its host half is empty on purpose — mounting `dsh-tool-ask-user` there put the tool in the registry's GLOBAL layer, which merges into every agent regardless of the preset that composed it, so a two-tool benchmark preset really presented three. Rendering a question is a host UI capability; having the tool is an agent capability, so the `tool-ask-user` row belongs to the presets that want it (and to the TUI composition, which has no presets).

The component renders one question at a time with progress navigation, single- and multi-select choices, recommendation badges derived from label suffixes, and custom answers. A multi-select draft keeps its selected labels while the user opens or edits the custom answer, so its submitted item may carry both `selected` and `custom`; a single-select custom answer remains exclusive. Question detail reuses the assistant-output `MarkdownText` primitive, including its GFM rendering and untrusted-content policy. The capped card keeps its title, navigation, and submission actions fixed while long detail and choices share an internal scroll region. Single-select choices advance immediately, and Enter submits once every question is answered or skipped; Enter during IME composition confirms the input candidate without advancing. It submits one structured answer batch for the whole request: “Skip this question” retains other drafts and emits the existing blank `{ selected: [] }` shape for that item, while close rejects the whole wait as `ASK_CANCELLED`.

A request whose single question declares a presentation intent renders as that intent's own surface instead. A typed `conductor-owner` request takes the separate owner card described below. `plan-review` — set by `dsh-plan-mode` on the `exit_plan_mode` review — takes the waiting-approval card shape: a `Plan review` strip, the plan as the scrolling markdown body, the question text as the card's accessible name, and one decision row of `Chat about it` / `Refuse` / `Approve`. Approve and Refuse answer with the asker's own option labels (the intent names which label approves, so the verdict never rides option order) and keep the asker's descriptions as tooltips; `Chat about it` rejects the wait as `ASK_CANCELLED`, returning the composer so the user can say what they want instead. The card claims a request only when it can send every answer that request allows: one question, the intent declared, the plan present as `detail`, the named approve label offered, and a binary single choice (at most one option besides approve, not multi-select). Anything else — no intent, a batch of several questions, a missing plan, an approve label naming no option, a third option, a multi-select decision — stays on the generic flow, which can express it. An intent changes the layout, never which answers are reachable.

Selection state is local to a component keyed by the request rpcId. A replay with the same id preserves a still-mounted draft, while `question/resolved` from the host removes the composer. The host remains authoritative: successful HTTP delivery does not remove pending state locally.

Composer chrome copy (pager, buttons, placeholders, validation feedback) is bilingual: the plugin registers en/da dictionaries under the `question` namespace of `dsh-client-locale` and hands the entry its bound translator plus the locale snapshot source through the inject face, so a locale switch re-renders a mounted composer. Question and option text arrives from the model and renders verbatim; carrier failure messages also display untranslated.

### Conductor owner questions

The host-issued `conductor-owner` intent displays run ID, gate, runtime role and attempt, escalation reason, all mandatory questions, and exact before/after allowed paths, exclusions and command IDs. It is not plan review. Native textarea/select/checkbox controls support keyboard navigation with no default choices. EN/DA actions map to `approve`, `reject` and `answer_continue`; translated text never determines authority. Approve appears only for a concrete host-validated proposal. Both affirmative actions require every answer and explicit confirmation of a displayed amendment. There is no skip or dismissal-as-consent path. A rejected host receipt leaves the card open with a textual error.

Separate conversation nodes derive waiting/accepted/rejected state from required durable Conductor owner events. Accepted/rejected receipts and answer text require a matching `conductor/owner-response-acknowledged` marker issued after the response-checkpoint flush; a raw streamed response or cancelled transport alone leaves the display waiting. Reload restores the same question and receipt; local unsubmitted drafts may reset. A host-issued `mode: continuation` card presents an already accepted answer after restart without editable inputs, approval/rejection controls or a proposal: its sole explicit Answer and continue action submits empty answers and resumes the saved plan through the host reservation, without recording another answer. User answers go through the host controller's exact run/question/revision/session reservation, never direct dispatch or model-authored tool arguments. An owner answer is not Gate C, GO or closeout; analysis stays read-only. [The owning decision](../../../.agents/notes/implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md) defines those guarantees.

## Model Experience

Indirectly, through `dsh-tool-ask-user` for generic question results and the Conductor controller for logged same-run owner-answer context.

#### KV Cache effect

No direct invalidation; question consumers own the model-visible call/result or logged continuation context.

## Known Limitations and Deferred Work

- **Unsubmitted drafts are not durable** — reconnect resync or a full page reload restores the host-owned pending request with the same rpcId, but a composer unmount resets local option and custom-text drafts.
- **One request owns the composer at a time** — later pending requests remain in the session snapshot and become visible after the earlier request resolves.

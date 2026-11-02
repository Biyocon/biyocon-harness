# Agent Note: Reserved one-shot child identity and output-token limits

Status: implemented

English | [中文](2026-11-02-reserved-child-identity-and-output-token-limit.zh.md)

## Problem

A host that composes a child prompt with that child's identity cannot derive the prompt from the actual session id when the provider assigns the id inside `start()`. A caller also cannot ask for a cumulative output-token ceiling, including reasoning, through the one-shot subagent and workflow seams. A prompt instruction is not an enforceable token limit.

## Decision

The [subagent one-shot request](../../../../docs/subsystems/subagent.md#the-one-shot-start-request) accepts an optional host-reserved `SessionId`. A provider advertises `reservedSessionId` only when it can use that value as the actual child session id. The service checks the capability before starting and rejects a returned run whose id differs. The in-process spawn and fork providers create the child with the reserved id; without the option, they allocate an id as before. Failure during unpublished creation rolls back the child, including its reserved identity.

The request also accepts an optional positive safe-integer `maxOutputTokens` ceiling for the child's cumulative output, including reasoning. `outputTokenLimit` advertises provider support. The service rejects an unsupported request before provider start; the provider and its selected model adapter must enforce the ceiling rather than silently dropping it. The loop lowers every model call's logged `maxTokens` to the remaining cumulative budget, charges reported `outputTokens` (which already includes reasoning) before retry or tool execution, and fails on missing, invalid, or over-limit usage. The exact LLM route must advertise `enforcesMaxTokensIncludingReasoning`; `requireOutputTokenLimit` requests that guarantee without entering provider wire. The `deepseek-official` route can advertise it at the official `https://api.deepseek.com` origin; custom gateways and pi-ai do not. The ceiling belongs to this dispatch, not to a deployment default. A normal request with neither option keeps its existing composition and output behavior.

The [workflow start request](../../../../docs/subsystems/workflow.md#the-start-request) exposes two independent host-only options. `composeChildPrompt(sessionId, prompt)` receives a newly reserved actual child id and the script's prompt, and returns the content blocks sent to that child. It runs on the host before provider start; the callback never crosses into the worker script. The published child id still reaches the worker through its existing start result and lifecycle events. A callback error rejects the child start without publishing a child; the script may handle or propagate that failure. `maxOutputTokensPerChild` is a positive safe-integer ceiling passed to every child dispatch in that run. The engine checks the selected subagent provider's relevant capabilities before creating the run. Neither option is exposed to model-written workflow scripts, and an omitted option leaves their dispatches unchanged. The final child prompt is logged in the child's session before reaching the model.

## Alternatives considered

**Guess or post-process the child id.** A prompt containing an independently generated label or a later correction can disagree with the session actually created. Reserving the id and checking the returned run makes the model-visible identity verifiable.

**Ask the model to respect a token budget.** Text cannot enforce an output ceiling, particularly for reasoning tokens. The host therefore requests a limit only from a provider and model adapter that can enforce it.

**Set an implicit deployment-wide limit.** A default would change unrelated delegations and require a validated Config field. The caller instead supplies the ceiling for each dispatch.

## Consequences

Hosts can build identity-bearing child prompts before publication and bound an individual child's generated output without changing ordinary delegation. Providers that lack either capability reject requests that need it, so consumers must choose a capable route. The workflow host retains responsibility for callback failures and child cleanup; the worker sees only its original script prompt and options. Tests cover reserved identity, startup rollback, cap enforcement and unsupported providers; unchanged paths retain their keyless snapshot output.
# Agent Note: English and Danish application copy

Status: implemented

English | [中文](2026-10-24-english-danish-ui.zh.md)

## Problem

The fork serves English- and Danish-speaking users. Chinese interface copy and untranslated Conductor metadata made an English settings page display mixed languages.

## Decision

The browser ships only `en` and `da`. English is the fallback when browser preferences contain no supported language or a Danish dictionary lacks a key. An explicit preference remains Host-backed as described in [Host-backed Web preferences](2026-08-06-host-backed-web-preferences.md); its schema also accepts the stored legacy value `zh`, which the locale owner resolves to English without rewriting the settings document. Other unknown values are rejected. Chinese is neither selectable nor registered as a UI language.

Feature plugins own parallel English and Danish dictionaries. Cordis-free presentation primitives use English defaults; their existing localized-label props remain available. All five shipped presets, including Conductor, resolve their names and descriptions through the active locale. Shipped preset file metadata is English, including descriptions inherited by new copies. Custom preset metadata, user and model content, runtime prompts, and bilingual developer documentation are not translated or filtered.

## Alternatives considered

Known permission preset IDs use each surface's English or Danish dictionary, including the composer, command popup, and Settings row. The Settings controller retains host names without translating them; views resolve labels during rendering so a language change also updates an already-loaded descriptor. Unknown host-configured names alone retain the kebab-case display transform. Each independent UI plugin owns its private formatter because cross-plugin value imports are forbidden; the permission plugin shares one formatter between its command popup and Settings row without adding a public export.

Keeping Chinese as a hidden fallback would still expose unsupported application copy. Adding Danish only to the selector would leave feature dictionaries and Conductor metadata untranslated.

## Consequences

Locale schema and registry tests cover the supported pair and English fallback. Browser scenarios exercise the real assembled settings page, language persistence, and shipped preset selection; their accessibility snapshots record the localized application rather than a mock component.

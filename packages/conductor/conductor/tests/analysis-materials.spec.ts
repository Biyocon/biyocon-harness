import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildCriticInput } from '../src/analysis-materials.ts'
import type { AnalysisMaterialSpan, CriticInputSpec } from '../src/analysis-materials.ts'
import { captureIntakeMaterial } from '../src/intake.ts'

const request = captureIntakeMaterial('current-request', 'Alpha\r\nBeta\nGamma\n',
  { sessionId: SessionId('parent'), eventIndex: 0 })
const file = captureIntakeMaterial('notes.txt', 'Åben\n中文\n')
const spans: AnalysisMaterialSpan[] = [
  { material_id: request.id, start_line: 2, end_line: 3 },
  { material_id: file.id, start_line: 1, end_line: 2 },
]

function fixture(overrides: Partial<CriticInputSpec> = {}): CriticInputSpec {
  return {
    candidate: { version: 'v1', deliverable: 'answer', content: 'A grounded answer.',
      criteria: [{ criterion: 'Answer the question.', outcome: 'Addressed.' }],
      material_ids: [request.id, file.id], assumptions: [], limitations: [] },
    acceptanceCriteria: ['Answer the question.'], materials: [request, file], materialSpans: spans,
    instructionText: 'Challenge the reasoning.', maxTokens: 10_000, countTokens: text => text.length,
    ...overrides,
  }
}

describe('analysis critic material selection', () => {
  it('constructs a complete, deterministic prompt from admitted line ranges', () => {
    const original = fixture()
    const result = buildCriticInput(original)
    const parsed: unknown = JSON.parse(result.prompt)
    expect(result.tokenCount).toBe(result.prompt.length)
    expect(parsed).toEqual({
      instructions: original.instructionText, candidate: original.candidate,
      acceptance_criteria: original.acceptanceCriteria,
      material_references: [
        { material_id: request.id, selector: request.selector, sha256: request.sha256 },
        { material_id: file.id, selector: file.selector, sha256: file.sha256 },
      ],
      excerpts: [
        { material_id: request.id, start_line: 2, end_line: 3, text: 'Beta\nGamma' },
        { material_id: file.id, start_line: 1, end_line: 2, text: 'Åben\n中文' },
      ],
    })
    expect(result.excerpts).toEqual((parsed as { excerpts: unknown }).excerpts)
    expect(original.materialSpans).toEqual(spans)
  })

  it('uses admission order and then line order, independent of supplied span order', () => {
    const ordered = [
      { material_id: request.id, start_line: 1, end_line: 1 },
      { material_id: request.id, start_line: 3, end_line: 3 },
      { material_id: file.id, start_line: 1, end_line: 1 },
    ]
    const expected = buildCriticInput(fixture({ materialSpans: ordered }))
    fc.assert(fc.property(fc.shuffledSubarray(ordered, { minLength: 3, maxLength: 3 }), (shuffled) => {
      expect(buildCriticInput(fixture({ materialSpans: shuffled }))).toEqual(expected)
    }))
  })

  it('validates all admitted material hashes, IDs, kinds and unique identities', () => {
    const other = captureIntakeMaterial('notes.txt', 'Different text.')
    const invalid = [
      [{ ...request, content: 'Changed.' }, file],
      [{ ...request, sha256: '0'.repeat(64) }, file],
      [{ ...request, id: file.id }, file],
      [{ ...request, kind: 'file' as const }, file],
      [request, request],
      [request, file, other],
      [{ ...file, content: ' ' }, request],
    ]
    for (const materials of invalid) {
      expect(() => buildCriticInput(fixture({ materials }))).toThrow(/material hash or identity mismatch/)
    }
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 30 }), (suffix) => {
      expect(() => buildCriticInput(fixture({ materials: [{ ...request, content: request.content + suffix }, file] })))
        .toThrow(/material hash or identity mismatch/)
    }))
  })

  it('rejects missing, duplicate and unknown candidate material references', () => {
    const candidate = fixture().candidate
    for (const material_ids of [[], [request.id, request.id], [request.id, 'material-foreign']]) {
      expect(() => buildCriticInput(fixture({ candidate: { ...candidate, material_ids } })))
        .toThrow(/candidate references unknown or duplicate material/)
    }
  })

  it('rejects malformed material spans, including extra fields and noninteger bounds', () => {
    const malformed: unknown[] = [undefined, null, {}, [], [null], [[]], [false],
      [{ material_id: request.id, start_line: 1 }],
      [{ material_id: request.id, start_line: 1, end_line: 1, injected: true }],
      [{ material_id: '', start_line: 1, end_line: 1 }],
      [{ material_id: 42, start_line: 1, end_line: 1 }],
      [{ material_id: request.id, start_line: 0, end_line: 1 }],
      [{ material_id: request.id, start_line: 1.5, end_line: 2 }],
      [{ material_id: request.id, start_line: 2, end_line: 1 }],
      [{ material_id: request.id, start_line: 1, end_line: Number.POSITIVE_INFINITY }],
    ]
    for (const materialSpans of malformed) {
      expect(() => buildCriticInput(fixture({ materialSpans }))).toThrow(/material_span|material_spans/)
    }
  })

  it('rejects foreign, out-of-range, missing, repeated and overlapping spans', () => {
    const invalid = [
      { materialSpans: [...spans, { material_id: 'material-foreign', start_line: 1, end_line: 1 }], error: /unknown/ },
      { materialSpans: [...spans, { material_id: request.id, start_line: 4, end_line: 4 }], error: /out-of-range/ },
      { materialSpans: [spans[0]], error: /every cited material/ },
      { materialSpans: [...spans, spans[0]], error: /overlap or repeat/ },
      { materialSpans: [...spans, { material_id: request.id, start_line: 3, end_line: 3 }], error: /overlap or repeat/ },
    ]
    for (const { materialSpans, error } of invalid) {
      expect(() => buildCriticInput(fixture({ materialSpans }))).toThrow(error)
    }
  })

  it('requires complete instructions, criteria and a positive safe token limit', () => {
    for (const spec of [
      { maxTokens: 0 }, { maxTokens: -1 }, { maxTokens: Number.POSITIVE_INFINITY }, { maxTokens: 1.5 },
      { instructionText: ' ' }, { acceptanceCriteria: [] },
    ]) expect(() => buildCriticInput(fixture(spec))).toThrow(/instructions, criteria and a positive token limit/)
  })

  it('rejects invalid token readings and complete-prompt overruns without truncation', () => {
    for (const reading of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => buildCriticInput(fixture({ countTokens: () => reading }))).toThrow(/invalid count/)
    }
    const observed: string[] = []
    expect(() => buildCriticInput(fixture({ maxTokens: 1, countTokens: (prompt) => {
      observed.push(prompt)
      return prompt.length
    } }))).toThrow(/exceeds token limit/)
    expect(JSON.parse(observed[0]!)).toHaveProperty('excerpts')
    const exact = buildCriticInput(fixture())
    expect(buildCriticInput(fixture({ maxTokens: exact.tokenCount }))).toEqual(exact)
    fc.assert(fc.property(fc.integer({ min: 1, max: exact.tokenCount - 1 }), (maxTokens) => {
      expect(() => buildCriticInput(fixture({ maxTokens }))).toThrow(/exceeds token limit/)
    }))
  })

  it('uses inclusive source lines for arbitrary UTF-8 text and rejects later lines', () => {
    const line = fc.string({ minLength: 1, maxLength: 20 }).filter(value => value.trim().length > 0 && !/[\r\n]/.test(value))
    fc.assert(fc.property(fc.array(line, { minLength: 1, maxLength: 10 }), (lines) => {
      const material = captureIntakeMaterial('current-request', `${lines.join('\r\n')}\r\n`, request.sourceMessage)
      const candidate = { ...fixture().candidate, material_ids: [material.id] }
      const valid = buildCriticInput(fixture({ candidate, materials: [material],
        materialSpans: [{ material_id: material.id, start_line: 1, end_line: lines.length }] }))
      expect(valid.excerpts[0]!.text).toBe(lines.join('\n'))
      expect(() => buildCriticInput(fixture({ candidate, materials: [material],
        materialSpans: [{ material_id: material.id, start_line: lines.length + 1, end_line: lines.length + 1 }] })))
        .toThrow(/out-of-range/)
    }), { numRuns: 100 })
  })

  it('accepts a final line without a terminator', () => {
    const material = captureIntakeMaterial('current-request', 'Single line', request.sourceMessage)
    const candidate = { ...fixture().candidate, material_ids: [material.id] }
    const result = buildCriticInput(fixture({ candidate, materials: [material],
      materialSpans: [{ material_id: material.id, start_line: 1, end_line: 1 }] }))
    expect(result.excerpts[0]!.text).toBe('Single line')
  })
})

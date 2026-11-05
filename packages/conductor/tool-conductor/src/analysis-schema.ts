/** Model-output schemas for read-only report production and independent review. */
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

const strings = { type: 'array', items: { type: 'string' } } as const

/** Exact criterion identity and ordering required of an analysis report producer. */
export const ANALYSIS_CRITERIA_INSTRUCTION = 'For candidate.criteria, copy every acceptance_criteria string verbatim and in the same order, with exactly one criterion/outcome assessment per item. Do not add criteria from constraints. On rework, use the gate_history basis to correct the report against this unchanged list.'

/** Read-only specialist output; the core additionally validates producer/audit requirements. */
export const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    run_id: { type: 'string' }, purpose: { type: 'string', enum: ['analysis'] },
    stage: { type: 'string', enum: ['detective', 'strategist', 'devils-advocate', 'auditor'] },
    deliverable: { type: 'string', enum: ['answer', 'recommendations'] },
    status: { type: 'string', enum: ['ready', 'rework', 'blocked', 'failed'] },
    summary: { type: 'string' }, material_ids: strings, blockers: strings, assumptions: strings, limitations: strings,
    defect: { type: 'string', enum: ['scope', 'plan', 'report', 'analysis'],
      description: 'analysis is valid only for Auditor rework of the candidate; report retries Auditor against the unchanged candidate.' },
    candidate_hash: { type: 'string' },
    clarifications: {
      type: 'array', description: 'Read-only questions requiring owner input. Only valid with status blocked; never request paths, commands or execution authority.',
      items: { type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, prompt: { type: 'string' }, options: strings },
        required: ['id', 'prompt', 'options'] },
    },
    candidate: {
      type: 'object', additionalProperties: false,
      properties: {
        version: { type: 'string' }, deliverable: { type: 'string', enum: ['answer', 'recommendations'] },
        content: { type: 'string' }, material_ids: strings, assumptions: strings, limitations: strings,
        material_spans: { type: 'array', description: 'Inclusive one-based line ranges from hash-verified admitted materials. Cite only material_ids in this candidate.',
          items: { type: 'object', additionalProperties: false,
            properties: { material_id: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } },
            required: ['material_id', 'start_line', 'end_line'] } },
        criteria: { type: 'array', description: ANALYSIS_CRITERIA_INSTRUCTION, items: {
          type: 'object', additionalProperties: false,
          properties: { criterion: { type: 'string' }, outcome: { type: 'string' } }, required: ['criterion', 'outcome'],
        } },
      },
      required: ['version', 'deliverable', 'content', 'criteria', 'material_ids', 'material_spans', 'assumptions', 'limitations'],
    },
  },
  required: ['run_id', 'purpose', 'stage', 'deliverable', 'status', 'summary', 'material_ids', 'blockers', 'assumptions', 'limitations'],
} satisfies ObjectJsonSchema

/** Critic output is structurally constrained before candidate-bound validation. */
export const ANALYSIS_CHALLENGE_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    run_id: { type: 'string' }, purpose: { type: 'string', enum: ['analysis'] },
    candidate_hash: { type: 'string' }, candidate_version: { type: 'string' },
    material_ids: strings, critic_child_id: { type: 'string' }, critic_attempt: { type: 'integer' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
        claim: { type: 'string' }, rationale: { type: 'string' }, material_ids: strings,
      }, required: ['id', 'severity', 'claim', 'rationale', 'material_ids'],
    } },
    conclusion: { type: 'string', enum: ['holds', 'does_not_hold'] },
    defect: { type: 'string', enum: ['scope', 'plan', 'report'] }, summary: { type: 'string' },
  },
  required: ['run_id', 'purpose', 'candidate_hash', 'candidate_version', 'material_ids',
    'critic_child_id', 'critic_attempt', 'findings', 'conclusion', 'summary'],
} satisfies ObjectJsonSchema

/** The Arbiter's report verdict cannot express implementation GO or write authorization. */
export const REPORT_DECISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    run_id: { type: 'string' }, purpose: { type: 'string', enum: ['analysis'] },
    candidate_hash: { type: 'string' }, challenge_hash: { type: 'string' }, audit_hash: { type: 'string' },
    decision: { type: 'string', enum: ['accept', 'revise', 'blocked'] },
    basis: strings, evidence_reviewed: strings, open_risks: strings,
  },
  required: ['run_id', 'purpose', 'candidate_hash', 'challenge_hash', 'audit_hash', 'decision', 'basis', 'evidence_reviewed', 'open_risks'],
} satisfies ObjectJsonSchema

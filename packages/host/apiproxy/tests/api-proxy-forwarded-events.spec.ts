/** Validate lossless JSON at the host-event forwarding boundary. */
import { expect, it } from 'vitest'
import { assertJsonArgs } from '../src/api-proxy.ts'

it('preserves JSON-compatible event arguments without rewriting their values', () => {
  const args = [null, true, 3, 'text', { nested: [false, { count: 1 }] }]
  expect(assertJsonArgs('synthetic/event', args)).toBe(args)
  expect(JSON.parse(JSON.stringify(assertJsonArgs('synthetic/event', args)))).toEqual(args)
})

it.each([
  { kind: 'undefined', value: undefined },
  { kind: 'symbol', value: Symbol('synthetic') },
  { kind: 'function', value: () => 0 },
  { kind: 'bigint', value: 1n },
  { kind: 'lossy object', value: { omitted: undefined } },
])('rejects a $kind argument without exposing its contents', ({ value }) => {
  expect(() => assertJsonArgs('synthetic/event', ['valid', value])).toThrow(
    'forwarded host event "synthetic/event" argument 1 is not lossless JSON data',
  )
})

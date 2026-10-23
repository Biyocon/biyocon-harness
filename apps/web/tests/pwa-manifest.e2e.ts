import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('serves built PNG assets through the shipped web composition', async () => {
  const scaffold = await launchWebScaffold()
  try {
    const metadata: string[] = []
    for (const filename of [
      'favicon.png',
      'apple-touch-icon.png',
      'biyocon-brandmark.png',
      'biyocon-wordmark.png',
      'biyocon-brandmark-192.png',
      'biyocon-brandmark-512.png',
    ]) {
      const get = await fetch(`${scaffold.baseUrl}/${filename}`)
      expect(Buffer.from(await get.arrayBuffer())).toEqual(await readFile(join(DIST_ROOT, filename)))
      const head = await fetch(`${scaffold.baseUrl}/${filename}`, { method: 'HEAD' })
      expect((await head.arrayBuffer()).byteLength).toBe(0)
      metadata.push(`${filename}: GET ${get.status} ${get.headers.get('content-type')}; HEAD ${head.status} ${head.headers.get('content-type')}`)
    }
    expect(metadata.join('\n')).toMatchInlineSnapshot(`
      "favicon.png: GET 200 image/png; HEAD 200 image/png
      apple-touch-icon.png: GET 200 image/png; HEAD 200 image/png
      biyocon-brandmark.png: GET 200 image/png; HEAD 200 image/png
      biyocon-wordmark.png: GET 200 image/png; HEAD 200 image/png
      biyocon-brandmark-192.png: GET 200 image/png; HEAD 200 image/png
      biyocon-brandmark-512.png: GET 200 image/png; HEAD 200 image/png"
    `)
  } finally {
    await scaffold.close()
  }
})

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Biyocon Harness',
    short_name: 'Biyocon',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [
      {
        src: '/biyocon-brandmark-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/biyocon-brandmark-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  })
})

it.each([
  ['biyocon-brandmark-192.png', 192],
  ['biyocon-brandmark-512.png', 512],
  ['favicon.png', 32],
  ['apple-touch-icon.png', 180],
] as const)('ships %s with PNG and IHDR headers and %ipx square dimensions', async (filename, size) => {
  const png = await readFile(join(DIST_ROOT, filename))
  expect(png.length, `${filename} must contain the complete PNG signature and IHDR chunk`).toBeGreaterThanOrEqual(33)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(png.readUInt32BE(8)).toBe(13)
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
  expect(png.readUInt32BE(16)).toBe(size)
  expect(png.readUInt32BE(20)).toBe(size)
})

// Regenerate with `node scripts/generate-landing-hero.mjs` (sharp ships with Next.js).
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const names = [
  'exhibition-cars', 'hero-ram', 'exhibition-food-rice', 'exhibition-clothing',
  'exhibition-fabrics-shoes', 'exhibition-home-decor', 'exhibition-food-maggi',
  'exhibition-food-golden-morn',
]
await mkdir('public/landing/hero', { recursive: true })
for (const name of names) {
  const source = `public/landing/photos/${name}.jpg`
  const { width } = await sharp(source).metadata()
  for (const size of [640, 1024, 1600].filter((size) => size < width).concat(width)) {
    await sharp(source).resize(size).webp({ quality: 60, effort: 6 }).toFile(`public/landing/hero/${name}-${size}.webp`)
  }
}

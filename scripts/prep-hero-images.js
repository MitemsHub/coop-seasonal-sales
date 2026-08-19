/* Prepare ALL the user's WhatsApp photos for the landing hero rotation.
 * Numbers 1-15 map to the sorted source filenames; the three named files
 * (hero-logistics / hero-ram / hero-community) keep their regeneration contract names.
 * Upscales via Lanczos, applies unsharp mask + subtle contrast/saturation grade,
 * writes production JPEGs into public/landing/photos/.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const SRC = path.join(__dirname, '..', 'images you can delete after use')
const OUT = path.join(__dirname, '..', 'public', 'landing', 'photos')

const files = fs
  .readdirSync(SRC)
  .filter((f) => /\.jpe?g$/i.test(f))
  .sort()

// Named contract files (keep these names stable for the regeneration pack)
const NAMED = {
  'WhatsApp Image 2026-08-07 at 4.23.38 PM (8).jpeg': 'hero-logistics.jpg', // warehouse dock
  'WhatsApp Image 2026-08-07 at 4.23.30 PM.jpeg': 'hero-ram.jpg', // rams in field
  'WhatsApp Image 2026-08-07 at 4.23.32 PM.jpeg': 'hero-community.jpg', // exhibition booth
}

async function process(src, destName) {
  const meta = await sharp(src).metadata()
  const width = Math.min(2000, meta.width || 2000)
  const buf = await sharp(src)
    .rotate() // honor EXIF orientation
    .resize({ width, withoutEnlargement: false })
    .modulate({ brightness: 1.02, saturation: 1.08 }) // gentle grade
    .sharpen({ sigma: 0.9, m1: 1.2, m2: 0.4, x1: 2, y2: 12 }) // unsharp mask
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer()
  fs.writeFileSync(path.join(OUT, destName), buf)
  const outMeta = await sharp(path.join(OUT, destName)).metadata()
  return `OK ${destName}  ${meta.width}x${meta.height} -> ${outMeta.width}x${outMeta.height}  ${(buf.length / 1024).toFixed(0)}KB`
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const lines = []
  files.forEach((f, i) => {
    const num = String(i + 1).padStart(2, '0')
    const named = NAMED[f]
    const dest = named || `hero-${num}.jpg`
    if (named) delete NAMED[f]
    lines.push(process(path.join(SRC, f), dest))
  })
  const results = await Promise.all(lines)
  results.forEach((r) => console.log(r))
  console.log(`\nTotal: ${files.length} images processed into ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Precompressed assets avoid runtime transformations and preserve the global
// unoptimized setting used by product images. Keep in sync with the generator.
export const HERO_IMAGES = [
  ['exhibition-cars', 1600],
  ['hero-ram', 1600],
  ['exhibition-food-rice', 1600],
  ['exhibition-clothing', 1600],
  ['exhibition-fabrics-shoes', 960],
  ['exhibition-home-decor', 960],
  ['exhibition-food-maggi', 1600],
  ['exhibition-food-golden-morn', 1600],
].map(([name, width]) => {
  const sizes = [640, 1024, 1600].filter((size) => size < width).concat(width)
  return {
    src: `/landing/hero/${name}-${width}.webp`,
    srcSet: sizes.map((size) => `/landing/hero/${name}-${size}.webp ${size}w`).join(', '),
    sizes: '100vw',
  }
})

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PhotoHero } from './LandingPage'
import { HERO_IMAGES } from '../../lib/landingHeroImages'

it('renders the first responsive photo visibly in server HTML, before hydration', () => {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(React.createElement(PhotoHero))
  const photo = container.querySelector('img.hero-backdrop-photo')
  expect(photo.getAttribute('src')).toBe(HERO_IMAGES[0].src)
  expect(photo.getAttribute('srcset')).toBe(HERO_IMAGES[0].srcSet)
  expect(photo.getAttribute('sizes')).toBe('100vw')
  expect(photo.getAttribute('loading')).toBe('eager')
  expect(photo.getAttribute('fetchPriority')).toBe('high')
  expect(photo.parentElement.style.opacity).toBe('1')
  expect(container.querySelectorAll('img.hero-backdrop-photo')).toHaveLength(1)
})

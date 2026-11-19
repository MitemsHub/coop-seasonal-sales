import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AnimatedNumber from './AnimatedNumber'

// Time advances go through act() because the count-up updates state on frames.
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
const shown = (container) => container.textContent

describe('AnimatedNumber', () => {
  it('keeps the formatting around the number it animates', async () => {
    const { container } = render(<AnimatedNumber value="₦1,234" />)
    await wait(0)
    expect(shown(container)).toBe('₦1,234')
  })

  it('counts towards a new value instead of swapping the text outright', async () => {
    const { container, rerender } = render(<AnimatedNumber value="₦10" />)
    await wait(700)
    expect(shown(container)).toBe('₦10')

    rerender(<AnimatedNumber value="₦1,010" />)
    await wait(100)
    // Mid-flight: neither the old value nor the final one.
    expect(shown(container)).not.toBe('₦1,010')

    await wait(700)
    expect(shown(container)).toBe('₦1,010')
  })
})

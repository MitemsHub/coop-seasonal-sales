// instrumentation.js — runs once when the Next.js server starts (Next 15
// stable hook; no config flag needed). register() is awaited from
// prepareImpl() before the first request is served.
//
// It installs the Vary union patch so rendered HTML responses keep the
// `Vary: Accept` value our middleware sets for Markdown content negotiation
// (the compiled page bundle replays its build-time Vary with a replacing
// setHeader — see lib/varyMerge.js for the full explanation).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installVaryMerge } = await import('./lib/varyMerge.js')
    installVaryMerge()
  }
}

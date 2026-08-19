// next.config.js
// Comprehensive security configuration for the Coop Food Distribution System

/** @type {import('next').NextConfig} */
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

const createConfig = (phase) => {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER
  const isProd = process.env.NODE_ENV === 'production'
  return {
  // Enable React strict mode for better development experience
  reactStrictMode: true,
  
  // Optimize images
  images: {
    // Allow Supabase storage domain dynamically
    domains: (() => {
      try {
        const host = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null
        return host ? [host] : []
      } catch {
        return []
      }
    })(),
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // Enable Next.js image optimization for remote images
    unoptimized: false,
    formats: ['image/avif', 'image/webp']
  },
  
  // Security headers
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          ...(isProd
            ? [
                {
                  key: 'X-Frame-Options',
                  value: 'DENY'
                }
              ]
            : []),
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'
          }
        ]
      },
      {
        // Additional security for admin routes
        source: '/admin/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate'
          },
          {
            key: 'Pragma',
            value: 'no-cache'
          },
          {
            key: 'Expires',
            value: '0'
          }
        ]
      },
      {
        // Health check — public, cacheable for load-balancer probes
        source: '/api/health',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=10, stale-while-revalidate=5'
          }
        ]
      },
      {
        // Additional security for API routes
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate'
          },
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, nosnippet, noarchive'
          }
        ]
      }
    ]
  },
  
  // Environment variables validation
  env: {
    // Only expose public environment variables
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  
  
  // External packages for server components
  serverExternalPackages: ['@supabase/supabase-js'],
  
  // Experimental features for better security
  experimental: {
    // Other experimental features can go here
  },
  
  // The rep dashboard now lives at /rep (protected by middleware like every
  // other rep page), so no config-level redirect is needed here.
  async redirects() {
    return []
  },
  
  // Rewrites for API versioning and security
  async rewrites() {
    return {
      beforeFiles: [
        // API versioning
        {
          source: '/api/v1/:path*',
          destination: '/api/:path*'
        }
      ],
      afterFiles: [],
      fallback: []
    }
  },
  
  // Output configuration
  output: 'standalone',

  distDir: isDevServer ? '.next-dev' : '.next',
  
  // Disable x-powered-by header
  poweredByHeader: false,
  
  // Compress responses
  compress: true,
  
  // Generate ETags for caching
  generateEtags: true,
  
  // HTTP keep alive
  httpAgentOptions: {
    keepAlive: true
  },
  
  // Development configuration
  ...(process.env.NODE_ENV === 'development' && {
    // Development-specific settings
    eslint: {
      // Run ESLint during builds
      ignoreDuringBuilds: false
    },
    typescript: {
      // Type check during builds
      ignoreBuildErrors: false
    }
  }),
  
  // Production configuration
  ...(process.env.NODE_ENV === 'production' && {
    // Production-specific settings
    eslint: {
      ignoreDuringBuilds: true
    },
    typescript: {
      ignoreBuildErrors: true
    },
    // Additional production optimizations
    compiler: {
      removeConsole: {
        exclude: ['error', 'warn']
      }
    }
  })
  }
}

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_PASSCODE',
  'APP_SECRET'
]

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:')
  missingEnvVars.forEach(envVar => {
    console.error(`   - ${envVar}`)
  })
  console.error('\nPlease check your .env.local file and ensure all required variables are set.')
  console.error('Refer to .env.example for the complete list of required variables.\n')
  
  if (process.env.NODE_ENV === 'production') {
    process.exit(1)
  }
}

// Security validation for production
if (process.env.NODE_ENV === 'production') {
  // Validate admin passcode strength
  const adminPasscode = process.env.ADMIN_PASSCODE
  if (adminPasscode && adminPasscode.length < 8) {
    console.warn('⚠️  WARNING: ADMIN_PASSCODE should be at least 8 characters long for production')
  }
  
  // Validate app secret strength
  const appSecret = process.env.APP_SECRET
  if (appSecret && appSecret.length < 32) {
    console.warn('⚠️  WARNING: APP_SECRET should be at least 32 characters long for production')
  }
  
  // Check for development URLs in production
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost')) {
    console.error('❌ ERROR: Using localhost Supabase URL in production')
    process.exit(1)
  }
}

module.exports = (phase) => createConfig(phase)

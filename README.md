# Coop Seasonal Sales

A comprehensive seasonal sales management platform built for cooperative food distribution, exhibition, and ram sales operations. Live at [sales.cbncoopng.com](https://sales.cbncoopng.com).

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Supabase](https://img.shields.io/badge/Supabase-Database-3FCF8E?logo=supabase)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-000000?logo=vercel)
![License](https://img.shields.io/badge/License-Proprietary-blue)

## Features

### Member Portal
- **Staff ID Sign-In** — members authenticate using their unique staff ID
- **OTP Email Verification** — secure one-time password authentication via email
- **Seasonal Shopping** — browse and order food, RAM, and exhibition items
- **Live Chat** — real-time support with admin staff via Supabase Realtime
- **Order Tracking** — view order history, receipts, and delivery status

### Admin Dashboard
- **Member Management** — import members, manage details, track auth onboarding
- **Food Distribution** — cycle management, order approvals, delivery tracking
- **RAM Sales** — rapid allocation market orders and processing
- **Exhibition Management** — vendor catalogs, product listings, order fulfillment
- **Live Chat Panel** — respond to member messages in real time
- **Reporting** — delivery reports, financial summaries, member analytics

### Vendor Portal
- **Product Management** — upload products, set prices, manage inventory
- **Order Fulfillment** — view and process orders, mark as delivered
- **Invoice Management** — upload and manage invoices

### Representative Portal
- **Delivery Management** — process pending orders, track deliveries
- **Branch Operations** — branch-specific order views and processing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Backend | Next.js API Routes, Supabase (PostgreSQL + Auth + Realtime) |
| Authentication | Supabase Auth (OTP email + password) |
| Real-time | Supabase Realtime (live chat) |
| Deployment | Vercel (frontend) + Supabase (database + auth) |
| Utilities | Framer Motion, Lucide Icons, ExcelJS, jsPDF |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A [Supabase](https://supabase.com) project

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd coop-seasonal-sales

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Run database migrations
# (Run the SQL files in /migrations against your Supabase database)

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |
| `ADMIN_PASSCODE` | ✅ | Admin login passcode (min 8 chars in production) |
| `APP_SECRET` | ✅ | HMAC secret for session tokens (min 32 chars) |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Production site URL for email redirects |
| `SUPABASE_DB_URL` | Optional | Direct database connection string |

## Project Structure

```
coop-seasonal-sales/
├── app/                          # Next.js App Router pages
│   ├── admin/                    # Admin dashboard pages
│   │   ├── chat/                 # Live chat panel
│   │   ├── food/                 # Food distribution
│   │   ├── members/              # Member management & auth onboarding
│   │   ├── exhibition/           # Exhibition management
│   │   └── ram/                  # RAM sales
│   ├── api/                      # API routes
│   │   ├── admin/                # Admin API endpoints
│   │   ├── chat/                 # Chat API (send, messages, read, upload)
│   │   └── members/              # Member auth & profile APIs
│   ├── auth/                     # Auth callback & confirmation pages
│   ├── components/               # Shared React components
│   ├── my-coop/                  # Member dashboard
│   ├── portal/                   # Member sign-in portal
│   └── shop/                     # Shopping pages
├── lib/                          # Utility functions & config
│   ├── supabaseClient.js         # Browser Supabase client
│   ├── supabaseServer.js         # Server Supabase client
│   ├── signing.js                # JWT signing utilities
│   └── rateLimit.js              # Rate limiting
├── migrations/                   # Database migration SQL files
├── public/                       # Static assets
└── scripts/                      # Dev & deployment scripts
```

## Database

This project uses **Supabase** as the backend, providing:
- **PostgreSQL** database with Row Level Security (RLS)
- **Supabase Auth** for member authentication (OTP email + password)
- **Supabase Realtime** for live chat message delivery
- **Supabase Storage** for file uploads (chat attachments)

Run the SQL migrations in `/migrations` to set up the required schema:
1. `local-db-base.sql` — base schema
2. `local-db-seed.sql` — seed data (optional)
3. `add-chat-messages.sql` — chat messages table
4. `fix-chat-add-attachment-columns.sql` — chat attachments
5. `fix-chat-rls-and-storage.sql` — RLS policies & storage buckets

## Security

- **Rate Limiting** — per-IP and per-user rate limits on auth and API endpoints
- **CSRF Protection** — origin/referer validation on state-changing requests
- **Session Tokens** — HMAC-signed JWT tokens with configurable TTL
- **Input Validation** — server-side sanitization on all user inputs
- **Security Headers** — CSP, HSTS, X-Frame-Options, and more
- **RLS Policies** — Supabase Row Level Security on all tables

See [docs/SECURITY_IMPLEMENTATION.md](docs/SECURITY_IMPLEMENTATION.md) for details.

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to [Vercel](https://vercel.com)
2. Set environment variables in the Vercel dashboard
3. Deploy — Vercel auto-detects Next.js and builds

### Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the migration SQL files
3. Configure Auth SMTP settings (Settings → Authentication → Emails)
4. Enable Realtime on the `chat_messages` table (Database → Replication)

## Support

- **Email**: customerservice@cbncoopng.com
- **Phone**: 09096797982, 08180578550
- **Live Chat**: Available at [sales.cbncoopng.com](https://sales.cbncoopng.com)

## License

Proprietary — CBN Coop. All rights reserved.

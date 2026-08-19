-- Local smoke-test schema for the Coop Exhibition module.
-- Mirrors the production shape the app expects (members.member_id is TEXT —
-- the staff-ID format the APIs query with), then runs the exhibition migration.

-- ── PostgREST roles (Supabase-style) ────────────────────────────────
CREATE ROLE authenticator LOGIN PASSWORD 'authenticator';
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT anon TO authenticator;
GRANT service_role TO authenticator;

-- ── Base tables the exhibition module depends on ────────────────────
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
    member_id TEXT PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    department_id INTEGER REFERENCES departments(id),
    category VARCHAR(1) DEFAULT 'A',
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    full_name VARCHAR(255) DEFAULT '',
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    savings BIGINT DEFAULT 0,
    loans BIGINT DEFAULT 0,
    global_limit BIGINT DEFAULT 0,
    pin VARCHAR(10) DEFAULT '',
    status VARCHAR(50) DEFAULT 'active',
    membership_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_department_id ON members(department_id);
CREATE INDEX IF NOT EXISTS idx_members_category ON members(category);

-- Minimal food orders table (the exhibition checkout reads it for
-- combined eligibility exposure; degrades gracefully if absent).
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT UNIQUE,
    member_id TEXT REFERENCES members(member_id),
    branch_id INTEGER REFERENCES branches(id),
    cycle_id BIGINT,
    payment_option TEXT DEFAULT 'Cash',
    status TEXT DEFAULT 'Pending',
    total_qty INTEGER DEFAULT 0,
    total_amount BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Grants for the PostgREST roles (apply AFTER the exhibition migration
-- creates the remaining tables, via default privileges for anything new).
GRANT USAGE ON SCHEMA public TO anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, service_role;

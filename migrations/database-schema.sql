-- Coop Seasonal Sales Database Schema
-- This file contains the required database tables and columns for the application

-- Create branches table
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

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create items table
CREATE TABLE IF NOT EXISTS items (
    item_id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(50),
    category VARCHAR(100),
    qty_on_hand INTEGER DEFAULT 0,
    image_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create members table
CREATE TABLE IF NOT EXISTS members (
    member_id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    department_id INTEGER REFERENCES departments(id),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    membership_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create branch_item_prices table
CREATE TABLE IF NOT EXISTS branch_item_prices (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    item_id INTEGER REFERENCES items(item_id),
    price DECIMAL(10,2) NOT NULL,
    initial_stock INTEGER DEFAULT 0,
    effective_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(branch_id, item_id)
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    order_id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(member_id),
    branch_id INTEGER REFERENCES branches(id),
    order_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'pending',
    total_amount DECIMAL(10,2),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create order_lines table
CREATE TABLE IF NOT EXISTS order_lines (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(order_id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(item_id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create inventory_movements table
CREATE TABLE IF NOT EXISTS inventory_movements (
    id SERIAL PRIMARY KEY,
    item_id INTEGER REFERENCES items(item_id),
    branch_id INTEGER REFERENCES branches(id),
    cycle_id INTEGER REFERENCES cycles(id),
    movement_type VARCHAR(50) NOT NULL, -- 'In', 'Out', 'Adjustment'
    quantity INTEGER NOT NULL,
    reference_type VARCHAR(50), -- 'order', 'adjustment', 'initial'
    reference_id INTEGER,
    notes TEXT,
    movement_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create cycles table (for inventory management)
CREATE TABLE IF NOT EXISTS cycles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sample data removed - add your own branches, departments, and cycles as needed
-- Example:
-- INSERT INTO branches (code, name) VALUES ('YOUR_BRANCH', 'Your Branch Name');
-- INSERT INTO departments (name) VALUES ('Your Department');
-- INSERT INTO cycles (name, status) VALUES ('Your Cycle', 'active');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_members_branch_id ON members(branch_id);
CREATE INDEX IF NOT EXISTS idx_members_department_id ON members(department_id);
CREATE INDEX IF NOT EXISTS idx_orders_member_id ON orders(member_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_item_id ON order_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_id ON inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_id ON inventory_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_item_prices_branch_item ON branch_item_prices(branch_id, item_id);
CREATE INDEX IF NOT EXISTS idx_items_image_url ON items(image_url) WHERE image_url IS NOT NULL;
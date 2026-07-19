/**
 * Database Seed Script
 * 
 * Populates the database with sample data matching the assignment's reference data.
 * Creates users, brands, and sample sales in 'pending' status.
 */

const { getDatabase, closeDatabase } = require('../config/database');
const { migrate } = require('./migrate');
const { v4: uuidv4 } = require('uuid');

function seed() {
  const db = getDatabase();
  migrate();

  // Clear existing data (order matters due to foreign keys)
  db.exec(`
    DELETE FROM payout_transactions;
    DELETE FROM payouts;
    DELETE FROM reconciliation_logs;
    DELETE FROM user_balances;
    DELETE FROM sales;
    DELETE FROM brands;
    DELETE FROM users;
  `);

  // ── Insert Users ──
  const users = [
    { id: 'john_doe',   name: 'John Doe',   email: 'john@example.com' },
    { id: 'jane_smith', name: 'Jane Smith',  email: 'jane@example.com' },
    { id: 'bob_kumar',  name: 'Bob Kumar',   email: 'bob@example.com' },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email) VALUES (?, ?, ?)
  `);
  for (const u of users) {
    insertUser.run(u.id, u.name, u.email);
  }

  // ── Insert Brands ──
  const brands = ['brand_1', 'brand_2', 'brand_3'];
  const insertBrand = db.prepare(`
    INSERT INTO brands (id, name) VALUES (?, ?)
  `);
  for (const b of brands) {
    insertBrand.run(b, b);
  }

  // ── Insert Sales (matching the assignment example) ──
  const sales = [
    // John's 3 sales from the assignment example
    { userId: 'john_doe', brand: 'brand_1', earning: 40 },
    { userId: 'john_doe', brand: 'brand_1', earning: 40 },
    { userId: 'john_doe', brand: 'brand_1', earning: 40 },
    // Additional sales for other users
    { userId: 'jane_smith', brand: 'brand_2', earning: 100 },
    { userId: 'jane_smith', brand: 'brand_3', earning: 60 },
    { userId: 'bob_kumar',  brand: 'brand_1', earning: 200 },
    { userId: 'bob_kumar',  brand: 'brand_2', earning: 150 },
  ];

  const insertSale = db.prepare(`
    INSERT INTO sales (id, user_id, brand_id, status, earning) 
    VALUES (?, ?, ?, 'pending', ?)
  `);
  for (const s of sales) {
    insertSale.run(uuidv4(), s.userId, s.brand, s.earning);
  }

  // ── Initialize User Balances ──
  const insertBalance = db.prepare(`
    INSERT INTO user_balances (user_id, withdrawable_balance, total_earned, total_advance_paid, adjustment_balance)
    VALUES (?, 0, 0, 0, 0)
  `);
  for (const u of users) {
    insertBalance.run(u.id);
  }

  console.log('✅ Database seeded successfully.');
  console.log(`   ${users.length} users, ${brands.length} brands, ${sales.length} sales created.`);
}

if (require.main === module) {
  seed();
  closeDatabase();
}

module.exports = { seed };

/**
 * Database Configuration & Connection
 * 
 * Uses SQLite via better-sqlite3 for:
 * - Zero-config setup (no external DB server needed)
 * - ACID compliance with WAL mode for concurrent reads
 * - Portable single-file database
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'payout.db');

let db = null;

/**
 * Get or create the database connection (singleton pattern).
 * Enables WAL mode and foreign keys for performance and integrity.
 */
function getDatabase() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);

    // Performance & integrity pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDatabase, closeDatabase };

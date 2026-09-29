import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

export interface ImageRecord {
  id: number;
  filename: string;
  filepath: string;
  title: string;
  category: string;
  description: string;
  author: string;
  attribution: string;
  tags: string;
  source: string;
  source_url: string;
  source_page_url: string;
  license: string;
  width: number;
  height: number;
  mime_type: string;
  file_size: number;
  sha256: string;
  created_at: string;
  updated_at: string;
}

export function openDatabase(databasePath = env.databasePath): Database.Database {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      filepath TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      attribution TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_page_url TEXT NOT NULL DEFAULT '',
      license TEXT NOT NULL DEFAULT 'Unknown',
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/webp',
      file_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_images_source_url ON images(source_url);
    CREATE INDEX IF NOT EXISTS idx_images_category ON images(category);
    CREATE TABLE IF NOT EXISTS crawler_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crawler TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      items_found INTEGER NOT NULL DEFAULT 0,
      items_saved INTEGER NOT NULL DEFAULT 0,
      items_skipped INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
  `);
  const imageColumns = new Set((db.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>).map((column) => column.name));
  for (const column of ['source_page_url', 'description', 'author', 'attribution', 'tags']) {
    if (!imageColumns.has(column)) db.exec(`ALTER TABLE images ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  return db;
}

export function imageByHash(db: Database.Database, hash: string): ImageRecord | undefined {
  return db.prepare('SELECT * FROM images WHERE sha256 = ?').get(hash) as ImageRecord | undefined;
}

export function imageBySourceUrl(db: Database.Database, url: string): ImageRecord | undefined {
  return db.prepare('SELECT * FROM images WHERE source_url = ?').get(url) as ImageRecord | undefined;
}

export function insertImage(db: Database.Database, image: Omit<ImageRecord, 'id'>): number {
  const result = db.prepare(`INSERT INTO images
    (filename, filepath, title, category, description, author, attribution, tags, source, source_url, source_page_url, license, width, height, mime_type, file_size, sha256, created_at, updated_at)
    VALUES (@filename, @filepath, @title, @category, @description, @author, @attribution, @tags, @source, @source_url, @source_page_url, @license, @width, @height, @mime_type, @file_size, @sha256, @created_at, @updated_at)`)
    .run(image);
  return Number(result.lastInsertRowid);
}

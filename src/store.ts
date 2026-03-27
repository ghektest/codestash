import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SnippetSchema, CreateSnippetSchema } from "./types.js";
import type { Snippet, CreateSnippetInput, UpdateSnippetInput } from "./types.js";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".codestash");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "snippets.db");

/**
 * SQLite-backed storage layer for code snippets.
 * Uses better-sqlite3 for synchronous, fast local access.
 */
export class SnippetStore {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // Ensure the directory exists
    var dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  /**
   * Create tables and indexes if they don't exist.
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        language TEXT,
        tags TEXT DEFAULT '[]',
        description TEXT,
        file_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_hash TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);
      CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets(created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
        title, content, description, tags,
        content='snippets',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
        INSERT INTO snippets_fts(rowid, title, content, description, tags)
        VALUES (new.rowid, new.title, new.content, new.description, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
        INSERT INTO snippets_fts(snippets_fts, rowid, title, content, description, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.description, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
        INSERT INTO snippets_fts(snippets_fts, rowid, title, content, description, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.description, old.tags);
        INSERT INTO snippets_fts(rowid, title, content, description, tags)
        VALUES (new.rowid, new.title, new.content, new.description, new.tags);
      END;
    `);
  }

  /**
   * Insert a new snippet into the database.
   */
  create(input: CreateSnippetInput): Snippet {
    var validated = CreateSnippetSchema.parse(input);
    const now = new Date().toISOString();
    const id = nanoid(12);

    const snippet: Snippet = {
      ...validated,
      id,
      createdAt: now,
      updatedAt: now,
    };

    var stmt = this.db.prepare(`
      INSERT INTO snippets (id, title, content, language, tags, description, file_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      snippet.id,
      snippet.title,
      snippet.content,
      snippet.language || null,
      JSON.stringify(snippet.tags),
      snippet.description || null,
      snippet.filePath || null,
      snippet.createdAt,
      snippet.updatedAt,
    );

    return snippet;
  }

  /**
   * Get a snippet by ID.
   */
  getById(id: string): Snippet | null {
    var stmt = this.db.prepare("SELECT * FROM snippets WHERE id = ?");
    var row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToSnippet(row);
  }

  /**
   * List all snippets, optionally filtered by language.
   */
  list(options: { language?: string; limit?: number; offset?: number } = {}): Snippet[] {
    let query = "SELECT * FROM snippets";
    const params: any[] = [];

    if (options.language) {
      query += " WHERE language = ?";
      params.push(options.language);
    }

    query += " ORDER BY updated_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    if (options.offset) {
      query += " OFFSET ?";
      params.push(options.offset);
    }

    var stmt = this.db.prepare(query);
    var rows = stmt.all(...params) as any[];
    return rows.map((row) => this.rowToSnippet(row));
  }

  /**
   * Update an existing snippet.
   */
  update(input: UpdateSnippetInput): Snippet | null {
    const existing = this.getById(input.id);
    if (!existing) return null;

    const updated: Snippet = {
      ...existing,
      ...input,
      tags: input.tags ?? existing.tags,
      updatedAt: new Date().toISOString(),
    };

    var stmt = this.db.prepare(`
      UPDATE snippets
      SET title = ?, content = ?, language = ?, tags = ?, description = ?,
          file_path = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.title,
      updated.content,
      updated.language || null,
      JSON.stringify(updated.tags),
      updated.description || null,
      updated.filePath || null,
      updated.updatedAt,
      updated.id,
    );

    return updated;
  }

  /**
   * Delete a snippet by ID.
   */
  delete(id: string): boolean {
    var stmt = this.db.prepare("DELETE FROM snippets WHERE id = ?");
    var result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Full-text search using SQLite FTS5.
   */
  fullTextSearch(query: string, limit: number = 20): Snippet[] {
    // Escape the query for FTS5
    var escapedQuery = query.replace(/['"]/g, "")
    if (escapedQuery.trim() == "") return [];

    var stmt = this.db.prepare(`
      SELECT s.* FROM snippets s
      INNER JOIN snippets_fts fts ON s.rowid = fts.rowid
      WHERE snippets_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    var rows = stmt.all(escapedQuery, limit) as any[];
    return rows.map((row) => this.rowToSnippet(row));
  }

  /**
   * Get all snippets (used for fuzzy search indexing).
   */
  getAll(): Snippet[] {
    var stmt = this.db.prepare("SELECT * FROM snippets ORDER BY updated_at DESC");
    var rows = stmt.all() as any[];
    return rows.map((row) => this.rowToSnippet(row));
  }

  /**
   * Get snippet count.
   */
  count(): number {
    var stmt = this.db.prepare("SELECT COUNT(*) as count FROM snippets");
    var row = stmt.get() as any;
    return row.count;
  }

  /**
   * Get all unique tags.
   */
  getAllTags(): string[] {
    const snippets = this.getAll();
    const tagSet = new Set<string>();
    for (const snippet of snippets) {
      for (const tag of snippet.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }

  /**
   * Find snippets by tag.
   */
  findByTag(tag: string): Snippet[] {
    // SQLite JSON search - tags are stored as JSON arrays
    var stmt = this.db.prepare(
      "SELECT * FROM snippets WHERE tags LIKE ? ORDER BY updated_at DESC",
    );
    var rows = stmt.all("%" + tag + "%") as any[];
    // Filter more precisely in JS
    return rows
      .map((row) => this.rowToSnippet(row))
      .filter((s) => s.tags.includes(tag));
  }

  /**
   * Convert a database row to a Snippet object.
   */
  private rowToSnippet(row: any): Snippet {
    return SnippetSchema.parse({
      id: row.id,
      title: row.title,
      content: row.content,
      language: row.language,
      tags: JSON.parse(row.tags || "[]"),
      description: row.description,
      filePath: row.file_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      syncHash: row.sync_hash,
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Get or create the default store instance.
 */
let defaultStore: SnippetStore | null = null;

export function getDefaultStore(): SnippetStore {
  if (!defaultStore) {
    defaultStore = new SnippetStore();
  }
  return defaultStore;
}

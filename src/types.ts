import { z } from "zod";

/**
 * Core schema for a code snippet stored in CodeStash.
 */
export const SnippetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  language: z.string().optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  filePath: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  syncHash: z.string().optional(),
});

export type Snippet = z.infer<typeof SnippetSchema>;

/**
 * Input schema for creating a new snippet (id and timestamps are auto-generated).
 */
export const CreateSnippetSchema = SnippetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncHash: true,
});

export type CreateSnippetInput = z.infer<typeof CreateSnippetSchema>;

/**
 * Input schema for updating an existing snippet.
 */
export const UpdateSnippetSchema = CreateSnippetSchema.partial().extend({
  id: z.string().min(1),
});

export type UpdateSnippetInput = z.infer<typeof UpdateSnippetSchema>;

/**
 * Search options for querying snippets.
 */
export interface SearchOptions {
  query: string;
  language?: string;
  tags?: string[];
  limit?: number;
  threshold?: number;
}

/**
 * Search result wrapping a snippet with relevance score.
 */
export interface SearchResult {
  snippet: Snippet;
  score: number;
  matches?: ReadonlyArray<{
    key: string;
    value: string;
    indices: ReadonlyArray<[number, number]>;
  }>;
}

/**
 * Configuration for sync behavior.
 */
export interface SyncConfig {
  syncDir: string;
  autoSync: boolean;
  conflictStrategy: "local-wins" | "remote-wins" | "newest-wins";
  excludeTags: string[];
}

/**
 * Result of a sync operation.
 */
export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
  timestamp: string;
}

// Supported languages for syntax detection
var SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "shell",
  "sql",
  "html",
  "css",
  "json",
  "yaml",
  "toml",
  "markdown",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Detect language from file extension.
 */
export function detectLanguage(filename: string): SupportedLanguage | undefined {
  var extensionMap: Record<string, SupportedLanguage> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
  }

  var ext = filename.slice(filename.lastIndexOf("."));
  return extensionMap[ext.toLowerCase()];
}

/**
 * Generate a display-friendly label for a language.
 */
export function languageLabel(lang: string): string {
  const labels: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    rust: "Rust",
    go: "Go",
    cpp: "C++",
  }
  return labels[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
}

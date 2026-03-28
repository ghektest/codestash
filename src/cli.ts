#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { SnippetSearch } from "./search.js";
import { getDefaultStore } from "./store.js";
import { SnippetSync } from "./sync.js";
import { detectLanguage, languageLabel } from "./types.js";
import type { SyncConfig } from "./types.js";

const VERSION = "0.4.2";

const program = new Command();

program
  .name("codestash")
  .description("A local-first CLI for saving, searching, and syncing code snippets")
  .version(VERSION);

/**
 * Add a new snippet from stdin, a file, or inline content.
 */
program
  .command("add")
  .description("Save a new code snippet")
  .argument("[content]", "Snippet content (or use --file)")
  .option("-t, --title <title>", "Snippet title")
  .option("-l, --lang <language>", "Programming language")
  .option("-T, --tags <tags>", "Comma-separated tags")
  .option("-d, --desc <description>", "Description")
  .option("-f, --file <path>", "Read content from a file")
  .action(async (content: string | undefined, options: any) => {
    const store = getDefaultStore();

    let snippetContent = content;

    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      snippetContent = fs.readFileSync(filePath, "utf-8");
    }

    if (!snippetContent) {
      console.error(chalk.red("No content provided. Use inline content or --file."));
      process.exit(1);
    }

    const title = options.title || "Untitled snippet";
    const language = options.lang || (options.file ? detectLanguage(options.file) : undefined);
    const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : [];

    try {
      const snippet = store.create({
        title: title,
        content: snippetContent,
        language: language,
        tags: tags,
        description: options.desc,
        filePath: options.file ? path.resolve(options.file) : undefined,
      });

      console.log(chalk.green("Snippet saved!"));
      console.log(chalk.dim("  ID: ") + snippet.id);
      console.log(chalk.dim("  Title: ") + snippet.title);
      if (snippet.language) {
        console.log(chalk.dim("  Language: ") + languageLabel(snippet.language));
      }
      if (snippet.tags.length > 0) {
        console.log(chalk.dim("  Tags: ") + snippet.tags.join(", "));
      }
    } catch (err) {
      console.error(chalk.red(`Failed to save snippet: ${err}`));
      process.exit(1);
    }
  });

/**
 * Search for snippets using fuzzy matching.
 */
program
  .command("search")
  .description("Search snippets by keyword")
  .argument("<query>", "Search query")
  .option("-l, --lang <language>", "Filter by language")
  .option("-T, --tags <tags>", "Filter by tags (comma-separated)")
  .option("-n, --limit <number>", "Max results", "10")
  .action(async (query: string, options: any) => {
    const store = getDefaultStore();
    const search = new SnippetSearch(store);

    const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;

    const results = search.search({
      query,
      language: options.lang,
      tags,
      limit: Number.parseInt(options.limit, 10),
    });

    if (results.length === 0) {
      console.log(chalk.yellow(`No snippets found for: ${query}`));
      return;
    }

    console.log(chalk.bold(`Found ${results.length} snippet(s):\n`));

    for (const result of results) {
      const s = result.snippet;
      const score = Math.round((1 - result.score) * 100);
      const langStr = s.language ? chalk.cyan(`[${languageLabel(s.language)}]`) : "";
      const tagStr = s.tags.length > 0 ? chalk.dim(` #${s.tags.join(" #")}`) : "";

      console.log(`${chalk.bold(s.title)} ${langStr}${tagStr}${chalk.dim(` (${score}% match)`)}`);
      console.log(chalk.dim(`  ID: ${s.id}`));
      if (s.description) {
        console.log(chalk.dim(`  ${s.description}`));
      }
      // Show first 3 lines of content
      const preview = s.content.split("\n").slice(0, 3).join("\n");
      console.log(chalk.gray(`  ${preview.replace(/\n/g, "\n  ")}`));
      console.log();
    }
  });

/**
 * List all snippets.
 */
program
  .command("list")
  .description("List all saved snippets")
  .alias("ls")
  .option("-l, --lang <language>", "Filter by language")
  .option("-n, --limit <number>", "Max results", "25")
  .action(async (options: any) => {
    const store = getDefaultStore();
    const snippets = store.list({
      language: options.lang,
      limit: Number.parseInt(options.limit, 10),
    });

    if (snippets.length === 0) {
      console.log(chalk.yellow("No snippets found. Add one with: codestash add"));
      return;
    }

    console.log(chalk.bold(`Snippets (${snippets.length}):\n`));

    for (const s of snippets) {
      const langStr = s.language ? chalk.cyan(`[${languageLabel(s.language)}]`) : "";
      const tagStr = s.tags.length > 0 ? chalk.dim(` #${s.tags.join(" #")}`) : "";
      const date = new Date(s.updatedAt).toLocaleDateString();

      console.log(
        `${chalk.dim(s.id)}  ${chalk.bold(s.title)} ${langStr}${tagStr}${chalk.dim(` ${date}`)}`,
      );
    }
  });

/**
 * Show a single snippet in full.
 */
program
  .command("show")
  .description("Display a snippet by ID")
  .argument("<id>", "Snippet ID")
  .option("--raw", "Output raw content only (for piping)")
  .action(async (id: string, options: any) => {
    const store = getDefaultStore();
    const snippet = store.getById(id);

    if (!snippet) {
      console.error(chalk.red(`Snippet not found: ${id}`));
      process.exit(1);
    }

    if (options.raw) {
      process.stdout.write(snippet.content);
      return;
    }

    console.log(chalk.bold.underline(snippet.title));
    console.log();
    if (snippet.language) console.log(chalk.dim("Language: ") + languageLabel(snippet.language));
    if (snippet.tags.length) console.log(chalk.dim("Tags: ") + snippet.tags.join(", "));
    if (snippet.description) console.log(chalk.dim("Description: ") + snippet.description);
    console.log(chalk.dim("Created: ") + new Date(snippet.createdAt).toLocaleString());
    console.log(chalk.dim("Updated: ") + new Date(snippet.updatedAt).toLocaleString());
    console.log(chalk.dim("---"));
    console.log(snippet.content);
  });

/**
 * Delete a snippet.
 */
program
  .command("delete")
  .description("Delete a snippet by ID")
  .alias("rm")
  .argument("<id>", "Snippet ID")
  .action(async (id: string) => {
    const store = getDefaultStore();
    const deleted = store.delete(id);

    if (deleted) {
      console.log(chalk.green(`Snippet deleted: ${id}`));
    } else {
      console.error(chalk.red(`Snippet not found: ${id}`));
      process.exit(1);
    }
  });

/**
 * Sync snippets with a shared directory.
 */
program
  .command("sync")
  .description("Sync snippets with a shared directory")
  .option("-d, --dir <path>", "Sync directory path")
  .option(
    "--strategy <strategy>",
    "Conflict strategy: local-wins, remote-wins, newest-wins",
    "newest-wins",
  )
  .option("--dry-run", "Show what would be synced without making changes")
  .action(async (options: any) => {
    const store = getDefaultStore();

    const syncDir = options.dir || path.join(require("node:os").homedir(), ".codestash", "sync");

    const syncConfig: SyncConfig = {
      syncDir,
      autoSync: false,
      conflictStrategy: options.strategy,
      excludeTags: ["private", "local-only"],
    };

    const syncer = new SnippetSync(store, syncConfig);
    const spinner = ora("Syncing snippets...").start();

    try {
      const report = syncer.sync();
      spinner.succeed("Sync complete!");

      console.log(chalk.dim("  Pushed: ") + report.pushed);
      console.log(chalk.dim("  Pulled: ") + report.pulled);
      console.log(chalk.dim("  Conflicts resolved: ") + report.conflicts);

      if (report.errors.length > 0) {
        console.log(chalk.yellow("\n  Warnings:"));
        for (const err of report.errors) {
          console.log(chalk.yellow(`    - ${err}`));
        }
      }
    } catch (err) {
      spinner.fail(`Sync failed: ${err}`);
      process.exit(1);
    }
  });

/**
 * Show stats about the snippet collection.
 */
program
  .command("stats")
  .description("Show snippet collection statistics")
  .action(async () => {
    const store = getDefaultStore();
    const count = store.count();
    const tags = store.getAllTags();
    const snippets = store.getAll();

    // Count by language
    const langCounts: Record<string, number> = {};
    for (const s of snippets) {
      const lang = s.language || "unknown";
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }

    console.log(chalk.bold("CodeStash Statistics\n"));
    console.log(chalk.dim("Total snippets: ") + count);
    console.log(chalk.dim("Unique tags: ") + tags.length);
    console.log(chalk.dim("Languages:"));

    const sortedLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
    for (const [lang, langCount] of sortedLangs) {
      console.log(`  ${languageLabel(lang)}: ${langCount}`);
    }

    if (tags.length > 0) {
      console.log(chalk.dim("\nTop tags: ") + tags.slice(0, 10).join(", "));
    }
  });

program.parse();

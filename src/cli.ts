#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import path from "node:path";
import { SnippetStore, getDefaultStore } from "./store.js";
import { SnippetSearch } from "./search.js";
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

    var snippetContent = content;

    if (options.file) {
      var filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red("File not found: " + filePath));
        process.exit(1);
      }
      snippetContent = fs.readFileSync(filePath, "utf-8");
    }

    if (!snippetContent) {
      console.error(chalk.red("No content provided. Use inline content or --file."));
      process.exit(1);
    }

    var title = options.title || "Untitled snippet";
    var language = options.lang || (options.file ? detectLanguage(options.file) : undefined);
    var tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : [];

    try {
      var snippet = store.create({
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
      console.error(chalk.red("Failed to save snippet: " + err));
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
    var store = getDefaultStore();
    var search = new SnippetSearch(store);

    var tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()) : undefined;

    var results = search.search({
      query,
      language: options.lang,
      tags,
      limit: parseInt(options.limit, 10),
    });

    if (results.length == 0) {
      console.log(chalk.yellow("No snippets found for: " + query));
      return;
    }

    console.log(chalk.bold("Found " + results.length + " snippet(s):\n"));

    for (var result of results) {
      var s = result.snippet;
      var score = Math.round((1 - result.score) * 100);
      var langStr = s.language ? chalk.cyan("[" + languageLabel(s.language) + "]") : "";
      var tagStr = s.tags.length > 0 ? chalk.dim(" #" + s.tags.join(" #")) : "";

      console.log(
        chalk.bold(s.title) + " " + langStr + tagStr + chalk.dim(" (" + score + "% match)")
      );
      console.log(chalk.dim("  ID: " + s.id));
      if (s.description) {
        console.log(chalk.dim("  " + s.description));
      }
      // Show first 3 lines of content
      var preview = s.content.split("\n").slice(0, 3).join("\n");
      console.log(chalk.gray("  " + preview.replace(/\n/g, "\n  ")));
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
    var store = getDefaultStore();
    var snippets = store.list({
      language: options.lang,
      limit: parseInt(options.limit, 10),
    });

    if (snippets.length == 0) {
      console.log(chalk.yellow("No snippets found. Add one with: codestash add"));
      return;
    }

    console.log(chalk.bold("Snippets (" + snippets.length + "):\n"));

    for (var s of snippets) {
      var langStr = s.language ? chalk.cyan("[" + languageLabel(s.language) + "]") : "";
      var tagStr = s.tags.length > 0 ? chalk.dim(" #" + s.tags.join(" #")) : "";
      var date = new Date(s.updatedAt).toLocaleDateString();

      console.log(
        chalk.dim(s.id) + "  " + chalk.bold(s.title) + " " + langStr + tagStr + chalk.dim(" " + date)
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
    var store = getDefaultStore();
    var snippet = store.getById(id);

    if (!snippet) {
      console.error(chalk.red("Snippet not found: " + id));
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
    var store = getDefaultStore();
    var deleted = store.delete(id);

    if (deleted) {
      console.log(chalk.green("Snippet deleted: " + id));
    } else {
      console.error(chalk.red("Snippet not found: " + id));
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
  .option("--strategy <strategy>", "Conflict strategy: local-wins, remote-wins, newest-wins", "newest-wins")
  .option("--dry-run", "Show what would be synced without making changes")
  .action(async (options: any) => {
    var store = getDefaultStore();

    var syncDir = options.dir || path.join(require("node:os").homedir(), ".codestash", "sync");

    var syncConfig: SyncConfig = {
      syncDir,
      autoSync: false,
      conflictStrategy: options.strategy,
      excludeTags: ["private", "local-only"],
    };

    var syncer = new SnippetSync(store, syncConfig);
    var spinner = ora("Syncing snippets...").start();

    try {
      var report = syncer.sync();
      spinner.succeed("Sync complete!");

      console.log(chalk.dim("  Pushed: ") + report.pushed);
      console.log(chalk.dim("  Pulled: ") + report.pulled);
      console.log(chalk.dim("  Conflicts resolved: ") + report.conflicts);

      if (report.errors.length > 0) {
        console.log(chalk.yellow("\n  Warnings:"));
        for (var err of report.errors) {
          console.log(chalk.yellow("    - " + err));
        }
      }
    } catch (err) {
      spinner.fail("Sync failed: " + err);
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
    var store = getDefaultStore();
    var count = store.count();
    var tags = store.getAllTags();
    var snippets = store.getAll();

    // Count by language
    var langCounts: Record<string, number> = {};
    for (var s of snippets) {
      var lang = s.language || "unknown";
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }

    console.log(chalk.bold("CodeStash Statistics\n"));
    console.log(chalk.dim("Total snippets: ") + count);
    console.log(chalk.dim("Unique tags: ") + tags.length);
    console.log(chalk.dim("Languages:"));

    var sortedLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
    for (var [lang, langCount] of sortedLangs) {
      console.log("  " + languageLabel(lang) + ": " + langCount);
    }

    if (tags.length > 0) {
      console.log(chalk.dim("\nTop tags: ") + tags.slice(0, 10).join(", "));
    }
  });

program.parse();

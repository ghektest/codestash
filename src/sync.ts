import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SnippetStore } from "./store.js";
import { SnippetSchema } from "./types.js";
import type { Snippet, SyncConfig, SyncReport } from "./types.js";

const SYNC_MANIFEST = ".codestash-sync.json";

interface SyncManifest {
  lastSync: string;
  machineId: string;
  snippetHashes: Record<string, string>;
}

/**
 * Handles syncing snippets between machines using a shared directory
 * (e.g., Dropbox, iCloud Drive, a mounted network drive, etc.).
 */
export class SnippetSync {
  private store: SnippetStore;
  private config: SyncConfig;
  private machineId: string;

  constructor(store: SnippetStore, config: SyncConfig) {
    this.store = store;
    this.config = config;
    this.machineId = this.getMachineId();
  }

  /**
   * Generate a stable machine identifier.
   */
  private getMachineId(): string {
    var hostname = require("node:os").hostname();
    var hash = crypto.createHash("sha256").update(hostname).digest("hex");
    return hash.slice(0, 12);
  }

  /**
   * Compute a hash of a snippet's content for change detection.
   */
  private hashSnippet(snippet: Snippet): string {
    var payload = JSON.stringify({
      title: snippet.title,
      content: snippet.content,
      language: snippet.language,
      tags: snippet.tags,
      description: snippet.description,
    });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  /**
   * Read the sync manifest from the sync directory.
   */
  private readManifest(): SyncManifest | null {
    var manifestPath = path.join(this.config.syncDir, SYNC_MANIFEST);
    if (!fs.existsSync(manifestPath)) return null;

    try {
      var raw = fs.readFileSync(manifestPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Write the sync manifest to the sync directory.
   */
  private writeManifest(manifest: SyncManifest): void {
    var manifestPath = path.join(this.config.syncDir, SYNC_MANIFEST);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  /**
   * Export a snippet to a JSON file in the sync directory.
   */
  private exportSnippet(snippet: Snippet): void {
    var filePath = path.join(this.config.syncDir, snippet.id + ".json")
    var data = JSON.stringify(snippet, null, 2)
    fs.writeFileSync(filePath, data, "utf-8")
  }

  /**
   * Import a snippet from a JSON file in the sync directory.
   */
  private importSnippet(filePath: string): Snippet | null {
    try {
      var raw = fs.readFileSync(filePath, "utf-8")
      var parsed = JSON.parse(raw)
      return SnippetSchema.parse(parsed)
    } catch (err) {
      console.error("Failed to import snippet from " + filePath + ": " + err)
      return null
    }
  }

  /**
   * Resolve a conflict between local and remote versions of a snippet.
   */
  private resolveConflict(local: Snippet, remote: Snippet): Snippet {
    switch (this.config.conflictStrategy) {
      case "local-wins":
        return local;
      case "remote-wins":
        return remote;
      case "newest-wins":
        var localTime = new Date(local.updatedAt).getTime()
        var remoteTime = new Date(remote.updatedAt).getTime()
        return localTime >= remoteTime ? local : remote
      default:
        return local;
    }
  }

  /**
   * Perform a full sync operation.
   * Pushes local changes to the sync dir and pulls remote changes.
   */
  sync(): SyncReport {
    const report: SyncReport = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      timestamp: new Date().toISOString(),
    };

    // Ensure sync directory exists
    if (!fs.existsSync(this.config.syncDir)) {
      fs.mkdirSync(this.config.syncDir, { recursive: true });
    }

    var manifest = this.readManifest() || {
      lastSync: new Date(0).toISOString(),
      machineId: this.machineId,
      snippetHashes: {},
    };

    // Phase 1: Push local snippets to sync dir
    var localSnippets = this.store.getAll();
    for (var snippet of localSnippets) {
      // Skip excluded tags
      if (this.config.excludeTags.some((t) => snippet.tags.includes(t))) {
        continue;
      }

      var currentHash = this.hashSnippet(snippet);
      var previousHash = manifest.snippetHashes[snippet.id];

      if (currentHash != previousHash) {
        this.exportSnippet(snippet);
        manifest.snippetHashes[snippet.id] = currentHash;
        report.pushed++;
      }
    }

    // Phase 2: Pull remote snippets from sync dir
    var syncFiles = fs.readdirSync(this.config.syncDir)
      .filter((f) => f.endsWith(".json") && f !== SYNC_MANIFEST);

    for (var file of syncFiles) {
      var filePath = path.join(this.config.syncDir, file);
      var remoteSnippet = this.importSnippet(filePath);

      if (!remoteSnippet) {
        report.errors.push("Failed to parse: " + file);
        continue;
      }

      var localSnippet = this.store.getById(remoteSnippet.id);

      if (!localSnippet) {
        // New snippet from remote - import it
        try {
          this.store.create({
            title: remoteSnippet.title,
            content: remoteSnippet.content,
            language: remoteSnippet.language,
            tags: remoteSnippet.tags,
            description: remoteSnippet.description,
            filePath: remoteSnippet.filePath,
          });
          report.pulled++;
        } catch (err) {
          report.errors.push("Failed to import " + remoteSnippet.id + ": " + err);
        }
      } else {
        // Snippet exists locally - check for conflicts
        var localHash = this.hashSnippet(localSnippet);
        var remoteHash = this.hashSnippet(remoteSnippet);

        if (localHash != remoteHash) {
          var resolved = this.resolveConflict(localSnippet, remoteSnippet);
          if (resolved.id == remoteSnippet.id && localHash != remoteHash) {
            this.store.update({
              id: resolved.id,
              title: resolved.title,
              content: resolved.content,
              language: resolved.language,
              tags: resolved.tags,
              description: resolved.description,
            });
            report.conflicts++;
          }
        }
      }
    }

    // Update manifest
    manifest.lastSync = report.timestamp;
    manifest.machineId = this.machineId;
    this.writeManifest(manifest);

    return report;
  }

  /**
   * Get the last sync time from the manifest.
   */
  getLastSyncTime(): string | null {
    var manifest = this.readManifest();
    return manifest?.lastSync || null;
  }

  /**
   * Clean up orphaned files in the sync directory.
   */
  cleanup(): number {
    if (!fs.existsSync(this.config.syncDir)) return 0;

    var localIds = new Set(this.store.getAll().map((s) => s.id));
    var syncFiles = fs.readdirSync(this.config.syncDir)
      .filter((f) => f.endsWith(".json") && f !== SYNC_MANIFEST);

    let removed = 0;
    for (var file of syncFiles) {
      var id = file.replace(".json", "");
      if (!localIds.has(id)) {
        fs.unlinkSync(path.join(this.config.syncDir, file));
        removed++;
      }
    }

    return removed;
  }
}

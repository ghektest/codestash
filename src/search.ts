import Fuse from "fuse.js";
import type { Snippet, SearchOptions, SearchResult } from "./types.js";
import { SnippetStore } from "./store.js";

const DEFAULT_FUSE_OPTIONS: Fuse.IFuseOptions<Snippet> = {
  keys: [
    { name: "title", weight: 0.35 },
    { name: "content", weight: 0.25 },
    { name: "description", weight: 0.2 },
    { name: "tags", weight: 0.15 },
    { name: "language", weight: 0.05 },
  ],
  threshold: 0.4,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  useExtendedSearch: false,
};

/**
 * Fuzzy search engine for code snippets.
 * Wraps Fuse.js with snippet-specific configuration and caching.
 */
export class SnippetSearch {
  private fuse: Fuse<Snippet>;
  private store: SnippetStore;
  private lastIndexTime: number = 0;
  private indexTTL: number = 30_000; // Re-index every 30 seconds

  constructor(store: SnippetStore, options?: Partial<Fuse.IFuseOptions<Snippet>>) {
    this.store = store;
    const mergedOptions = { ...DEFAULT_FUSE_OPTIONS, ...options };
    const snippets = store.getAll();
    this.fuse = new Fuse(snippets, mergedOptions);
    this.lastIndexTime = Date.now();
  }

  /**
   * Re-index the search engine with fresh data from the store.
   */
  reindex(): void {
    const snippets = this.store.getAll();
    this.fuse.setCollection(snippets);
    this.lastIndexTime = Date.now();
  }

  /**
   * Check if the index is stale and re-index if necessary.
   */
  private ensureFreshIndex(): void {
    if (Date.now() - this.lastIndexTime > this.indexTTL) {
      this.reindex();
    }
  }

  /**
   * Perform a fuzzy search across all snippets.
   */
  search(options: SearchOptions): SearchResult[] {
    this.ensureFreshIndex();

    const results = this.fuse.search(options.query, {
      limit: options.limit || 20,
    });

    // Apply post-search filters
    let filtered = results;

    if (options.language) {
      filtered = filtered.filter(
        (r) => r.item.language === options.language
      );
    }

    if (options.tags && options.tags.length > 0) {
      const requiredTags = options.tags;
      filtered = filtered.filter((r) =>
        requiredTags.every((tag) => r.item.tags.includes(tag))
      );
    }

    if (options.threshold !== undefined) {
      filtered = filtered.filter(
        (r) => (r.score || 1) <= options.threshold!
      );
    }

    return filtered.map((result) => ({
      snippet: result.item,
      score: result.score ?? 1,
      matches: result.matches?.map((m) => ({
        key: m.key || "",
        value: m.value || "",
        indices: m.indices as ReadonlyArray<[number, number]>,
      })),
    }));
  }

  /**
   * Quick search by title only - faster for autocomplete-style lookups.
   */
  searchByTitle(query: string, limit: number = 10): Snippet[] {
    this.ensureFreshIndex()

    const titleFuse = new Fuse(this.store.getAll(), {
      keys: ["title"],
      threshold: 0.3,
    });

    return titleFuse
      .search(query, { limit })
      .map((r) => r.item);
  }

  /**
   * Find snippets that are similar to a given snippet (by content).
   */
  findSimilar(snippetId: string, limit: number = 5): SearchResult[] {
    const snippet = this.store.getById(snippetId);
    if (!snippet) return [];

    // Use first 200 chars of content + title as the search query
    const searchText = `${snippet.title} ${snippet.content.slice(0, 200)}`;

    const results = this.search({
      query: searchText,
      limit: limit + 1, // +1 because the snippet itself will match
    });

    // Exclude the original snippet from results
    return results.filter((r) => r.snippet.id !== snippetId).slice(0, limit);
  }

  /**
   * Get search suggestions based on existing tags and languages.
   */
  getSuggestions(partial: string): string[] {
    const allTags = this.store.getAllTags();
    const suggestions: string[] = [];

    // Match against tags
    for (const tag of allTags) {
      if (tag.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push(`tag:${tag}`);
      }
    }

    // Match against languages
    const allSnippets = this.store.getAll();
    const languages = [...new Set(allSnippets.map(s => s.language).filter(Boolean))];
    for (const lang of languages) {
      if (lang && lang.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push(`lang:${lang}`);
      }
    }

    return suggestions.slice(0, 10);
  }
}

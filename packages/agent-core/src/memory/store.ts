import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { MemoryEmbeddingProvider } from "./embeddings.js";

interface MemoryRecord {
  id: string;
  namespace: string;
  text: string;
  tags: string[];
  createdAt: string;
  embedding?: number[];
}

export interface SaveMemoryInput {
  text: string;
  namespace?: string;
  tags?: string[];
}

export interface SavedMemory {
  id: string;
  namespace: string;
  text: string;
  tags: string[];
  createdAt: string;
}

export interface MemorySearchInput {
  query: string;
  namespace?: string;
  limit?: number;
}

export interface MemorySearchResult {
  id: string;
  namespace: string;
  text: string;
  tags: string[];
  createdAt: string;
  score: number;
}

export interface MemoryIndexingJobResult {
  indexed: number;
  skipped: number;
}

export interface MemoryStoreOptions {
  embeddingProvider: MemoryEmbeddingProvider | undefined;
}

const DEFAULT_MEMORY_DIR = resolve(homedir(), ".jihn", "memory");
const MEMORY_FILE_NAME = "memories.jsonl";

function resolveMemoryDirectory(): string {
  const override = process.env.JIHN_MEMORY_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return resolve(override);
  }
  return DEFAULT_MEMORY_DIR;
}

function resolveMemoryFilePath(memoryDir: string): string {
  return resolve(memoryDir, MEMORY_FILE_NAME);
}

function sanitizeNamespace(value: string | undefined): string {
  const normalized = (value ?? "global")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_");
  return normalized.length > 0 ? normalized : "global";
}

function splitTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function scoreLexicalRecord(record: MemoryRecord, queryTerms: string[]): number {
  const text = record.text.toLowerCase();
  const tagText = record.tags.join(" ").toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) {
      score += 3;
    }
    if (tagText.includes(term)) {
      score += 5;
    }
  }
  return score;
}

function dot(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return value;
}

function norm(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(left: number[] | undefined, right: number[] | undefined): number {
  if (left === undefined || right === undefined || left.length === 0 || right.length === 0) {
    return 0;
  }
  const denominator = norm(left) * norm(right);
  if (denominator <= 0) {
    return 0;
  }
  return dot(left, right) / denominator;
}

function scoreHybridRecord(
  record: MemoryRecord,
  queryTerms: string[],
  queryEmbedding: number[] | undefined,
): number {
  const lexical = scoreLexicalRecord(record, queryTerms);
  const semantic = cosineSimilarity(record.embedding, queryEmbedding);
  const semanticScore = Math.max(0, semantic) * 10;
  return lexical + semanticScore;
}

function parseMemoryLine(line: string): MemoryRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as {
      id?: unknown;
      namespace?: unknown;
      text?: unknown;
      tags?: unknown;
      createdAt?: unknown;
      embedding?: unknown;
    };
    if (
      typeof record.id !== "string" ||
      typeof record.namespace !== "string" ||
      typeof record.text !== "string" ||
      !Array.isArray(record.tags) ||
      !record.tags.every((tag) => typeof tag === "string") ||
      typeof record.createdAt !== "string"
    ) {
      return null;
    }

    const embedding =
      Array.isArray(record.embedding) &&
      record.embedding.every((value) => typeof value === "number" && Number.isFinite(value))
        ? (record.embedding as number[])
        : undefined;

    return {
      id: record.id,
      namespace: record.namespace,
      text: record.text,
      tags: record.tags,
      createdAt: record.createdAt,
      ...(embedding !== undefined ? { embedding } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MemoryStore {
  private readonly memoryDir: string;
  protected readonly embeddingProvider: MemoryEmbeddingProvider | undefined;

  public constructor(
    memoryDir = resolveMemoryDirectory(),
    options: Partial<MemoryStoreOptions> = {},
  ) {
    this.memoryDir = memoryDir;
    this.embeddingProvider = options.embeddingProvider;
  }

  public get directory(): string {
    return this.memoryDir;
  }

  protected getEmbeddingProvider(): MemoryEmbeddingProvider | undefined {
    return this.embeddingProvider;
  }

  protected async maybeEmbed(text: string): Promise<number[] | undefined> {
    const provider = this.getEmbeddingProvider();
    if (provider === undefined) {
      return undefined;
    }
    return provider.embed(text);
  }

  private get filePath(): string {
    return resolveMemoryFilePath(this.memoryDir);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  protected async loadAll(): Promise<MemoryRecord[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(parseMemoryLine)
        .filter((record): record is MemoryRecord => record !== null);
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (isMissing) {
        return [];
      }
      throw error;
    }
  }

  protected async saveAll(records: MemoryRecord[]): Promise<void> {
    await this.ensureDirectory();
    const content = records.map((record) => JSON.stringify(record)).join("\n");
    const output = content.length > 0 ? `${content}\n` : "";
    await writeFile(this.filePath, output, "utf8");
  }

  public async saveMemory(input: SaveMemoryInput): Promise<SavedMemory> {
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error("text must be a non-empty string");
    }

    const embedding = await this.maybeEmbed(text);
    const record: MemoryRecord = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      namespace: sanitizeNamespace(input.namespace),
      text,
      tags: normalizeTags(input.tags),
      createdAt: nowIso(),
      ...(embedding !== undefined ? { embedding } : {}),
    };

    await this.ensureDirectory();
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return {
      id: record.id,
      namespace: record.namespace,
      text: record.text,
      tags: record.tags,
      createdAt: record.createdAt,
    };
  }

  public async searchMemory(
    input: MemorySearchInput,
  ): Promise<MemorySearchResult[]> {
    const query = input.query.trim();
    if (query.length === 0) {
      return [];
    }

    const queryTerms = splitTerms(query);
    const namespace = input.namespace?.trim();
    const limit = Math.max(1, Math.min(50, input.limit ?? 10));
    const records = await this.loadAll();
    const queryEmbedding = await this.maybeEmbed(query);

    const ranked = records
      .filter((record) => {
        if (namespace === undefined || namespace.length === 0) {
          return true;
        }
        return record.namespace === namespace;
      })
      .map((record) => ({
        ...record,
        score: scoreHybridRecord(record, queryTerms, queryEmbedding),
      }))
      .filter((record) => record.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.createdAt.localeCompare(left.createdAt);
      })
      .slice(0, limit);

    return ranked.map((record) => ({
      id: record.id,
      namespace: record.namespace,
      text: record.text,
      tags: record.tags,
      createdAt: record.createdAt,
      score: record.score,
    }));
  }

  public async backfillEmbeddings(limit = 100): Promise<MemoryIndexingJobResult> {
    const provider = this.getEmbeddingProvider();
    if (provider === undefined) {
      return { indexed: 0, skipped: 0 };
    }

    const records = await this.loadAll();
    let indexed = 0;
    let skipped = 0;
    for (const record of records) {
      if (indexed >= limit) {
        skipped += 1;
        continue;
      }
      if (record.embedding !== undefined && record.embedding.length > 0) {
        skipped += 1;
        continue;
      }
      record.embedding = await provider.embed(record.text);
      indexed += 1;
    }
    if (indexed > 0) {
      await this.saveAll(records);
    }
    return { indexed, skipped };
  }
}

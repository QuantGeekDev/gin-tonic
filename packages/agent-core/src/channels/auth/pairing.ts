import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const CHANNEL_AUTH_MODES = ["off", "open", "pairing"] as const;
export type ChannelAuthMode = (typeof CHANNEL_AUTH_MODES)[number];

const AuthorizedSenderSchema = z.object({
  channelId: z.string(),
  senderId: z.string(),
  authorizedAtMs: z.number(),
});

const ChallengeSchema = z.object({
  channelId: z.string(),
  senderId: z.string(),
  codeHash: z.string(),
  issuedAtMs: z.number(),
  expiresAtMs: z.number(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
});

const PairingStateSchema = z.object({
  authorizedSenders: z.array(AuthorizedSenderSchema),
  challenges: z.array(ChallengeSchema),
});

type PairingState = z.infer<typeof PairingStateSchema>;
type ChallengeRecord = z.infer<typeof ChallengeSchema>;

const DEFAULT_PAIRING_STATE: PairingState = {
  authorizedSenders: [],
  challenges: [],
};

export interface ChannelPairingStore {
  isAuthorized(channelId: string, senderId: string): Promise<boolean>;
  authorize(channelId: string, senderId: string): Promise<void>;
  getChallenge(channelId: string, senderId: string): Promise<ChallengeRecord | null>;
  saveChallenge(record: ChallengeRecord): Promise<void>;
  clearChallenge(channelId: string, senderId: string): Promise<void>;
}

export class FileChannelPairingStore implements ChannelPairingStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async isAuthorized(channelId: string, senderId: string): Promise<boolean> {
    const state = await this.loadState();
    return state.authorizedSenders.some(
      (entry) => entry.channelId === channelId && entry.senderId === senderId,
    );
  }

  public async authorize(channelId: string, senderId: string): Promise<void> {
    await this.updateState((state) => {
      const existing = state.authorizedSenders.some(
        (entry) => entry.channelId === channelId && entry.senderId === senderId,
      );
      if (!existing) {
        state.authorizedSenders.push({
          channelId,
          senderId,
          authorizedAtMs: Date.now(),
        });
      }
      state.challenges = state.challenges.filter(
        (entry) => !(entry.channelId === channelId && entry.senderId === senderId),
      );
    });
  }

  public async getChallenge(channelId: string, senderId: string): Promise<ChallengeRecord | null> {
    const state = await this.loadState();
    return (
      state.challenges.find(
        (entry) => entry.channelId === channelId && entry.senderId === senderId,
      ) ?? null
    );
  }

  public async saveChallenge(record: ChallengeRecord): Promise<void> {
    await this.updateState((state) => {
      state.challenges = state.challenges.filter(
        (entry) => !(entry.channelId === record.channelId && entry.senderId === record.senderId),
      );
      state.challenges.push(record);
    });
  }

  public async clearChallenge(channelId: string, senderId: string): Promise<void> {
    await this.updateState((state) => {
      state.challenges = state.challenges.filter(
        (entry) => !(entry.channelId === channelId && entry.senderId === senderId),
      );
    });
  }

  private async loadState(): Promise<PairingState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = PairingStateSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) {
        return structuredClone(DEFAULT_PAIRING_STATE);
      }
      return parsed.data;
    } catch (error) {
      const isMissing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT";
      if (isMissing) {
        return structuredClone(DEFAULT_PAIRING_STATE);
      }
      throw error;
    }
  }

  private async updateState(mutator: (state: PairingState) => void): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const state = await this.loadState();
      mutator(state);
      const parsed = PairingStateSchema.parse(state);
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(parsed, null, 2), "utf8");
      await rename(tmpPath, this.filePath);
    });
    await this.writeChain;
  }
}

export interface ChannelAuthPairingMiddlewareOptions {
  mode: ChannelAuthMode;
  store: ChannelPairingStore;
  hashSecret: string;
  codeLength?: number;
  codeTtlMs?: number;
  maxAttempts?: number;
  now?: () => number;
}

export type ChannelAuthDecision =
  | { decision: "allow" }
  | { decision: "deny"; responseText: string; reason: string };

export interface ChannelAuthInboundInput {
  channelId: string;
  senderId: string;
  text: string;
}

function normalizeText(text: string): string {
  return text.trim();
}

function hashCode(secret: string, code: string): string {
  return createHash("sha256").update(`${secret}:${code}`).digest("hex");
}

function generateOtpCode(length: number): string {
  const size = Math.max(4, Math.min(10, Math.floor(length)));
  let code = "";
  for (let index = 0; index < size; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

export class ChannelAuthPairingMiddleware {
  private readonly mode: ChannelAuthMode;
  private readonly store: ChannelPairingStore;
  private readonly hashSecret: string;
  private readonly codeLength: number;
  private readonly codeTtlMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;

  public constructor(options: ChannelAuthPairingMiddlewareOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.hashSecret = options.hashSecret;
    this.codeLength = options.codeLength ?? 6;
    this.codeTtlMs = options.codeTtlMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.now ?? (() => Date.now());
  }

  public async evaluate(input: ChannelAuthInboundInput): Promise<ChannelAuthDecision> {
    if (this.mode === "off" || this.mode === "open") {
      return { decision: "allow" };
    }

    const channelId = input.channelId.trim();
    const senderId = input.senderId.trim();
    if (!channelId || !senderId) {
      return {
        decision: "deny",
        reason: "invalid_sender",
        responseText: "Authentication error: invalid sender metadata.",
      };
    }

    if (await this.store.isAuthorized(channelId, senderId)) {
      return { decision: "allow" };
    }

    const text = normalizeText(input.text);
    if (/^\/verify\s+new$/i.test(text) || /^\/otp$/i.test(text)) {
      return this.issueChallenge(channelId, senderId, "new_challenge");
    }

    const verifyMatch = /^\/verify\s+([0-9]{4,10})$/i.exec(text);
    if (verifyMatch) {
      return this.verifyChallenge(channelId, senderId, verifyMatch[1] as string);
    }

    return this.issueChallenge(channelId, senderId, "challenge_required");
  }

  private async issueChallenge(
    channelId: string,
    senderId: string,
    reason: string,
  ): Promise<ChannelAuthDecision> {
    const code = generateOtpCode(this.codeLength);
    const issuedAtMs = this.now();
    const record: ChallengeRecord = {
      channelId,
      senderId,
      codeHash: hashCode(this.hashSecret, code),
      issuedAtMs,
      expiresAtMs: issuedAtMs + this.codeTtlMs,
      attempts: 0,
      maxAttempts: this.maxAttempts,
    };
    await this.store.saveChallenge(record);

    const expiresMinutes = Math.max(1, Math.ceil(this.codeTtlMs / 60_000));
    return {
      decision: "deny",
      reason,
      responseText:
        `Authentication required. Your one-time code is: ${code}. ` +
        `Reply with /verify ${code}. This code expires in ${expiresMinutes} minute(s).`,
    };
  }

  private async verifyChallenge(
    channelId: string,
    senderId: string,
    code: string,
  ): Promise<ChannelAuthDecision> {
    const record = await this.store.getChallenge(channelId, senderId);
    if (!record) {
      return this.issueChallenge(channelId, senderId, "missing_challenge");
    }

    const now = this.now();
    if (record.expiresAtMs <= now) {
      return this.issueChallenge(channelId, senderId, "challenge_expired");
    }

    const expectedHash = hashCode(this.hashSecret, code);
    if (expectedHash === record.codeHash) {
      await this.store.authorize(channelId, senderId);
      return {
        decision: "deny",
        reason: "verified",
        responseText: "Verification successful. You are now authorized.",
      };
    }

    const nextAttempts = record.attempts + 1;
    if (nextAttempts >= record.maxAttempts) {
      return this.issueChallenge(channelId, senderId, "max_attempts_exceeded");
    }

    await this.store.saveChallenge({
      ...record,
      attempts: nextAttempts,
    });

    return {
      decision: "deny",
      reason: "invalid_code",
      responseText:
        `Invalid verification code. Attempts remaining: ${record.maxAttempts - nextAttempts}. ` +
        "Send /verify <code> or /verify new for a new code.",
    };
  }
}

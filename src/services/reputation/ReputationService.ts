import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface AgentReputationRecord {
  agentId: string;
  successCount: number;
  failureCount: number;
  averageRating: number;
  reputationScore: number;
  updatedAt: string;
}

interface ReputationStore {
  version: 1;
  agents: Record<string, AgentReputationRecord>;
}

export class ReputationManager {
  private readonly storePath: string;
  private readonly records = new Map<string, AgentReputationRecord>();
  private restorePromise: Promise<void>;

  constructor(storePath = resolve(process.cwd(), "agent_reputation.json")) {
    this.storePath = storePath;
    this.restorePromise = this.restore();
  }

  public async recordSuccess(agentId: string, rating?: number): Promise<AgentReputationRecord> {
    await this.restorePromise;
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      throw new Error("agentId is required");
    }

    const safeRating = this.normalizeRating(rating);
    const current = this.records.get(normalizedAgentId) ?? this.createEmptyRecord(normalizedAgentId);
    const nextSuccessCount = current.successCount + 1;
    const nextAverageRating =
      safeRating === undefined
        ? current.averageRating
        : Number((((current.averageRating * current.successCount + safeRating) / nextSuccessCount).toFixed(2)));
    const totalTaskCount = nextSuccessCount + current.failureCount;
    const reputationScore =
      totalTaskCount === 0 ? 0 : Number((((nextSuccessCount * nextAverageRating) / totalTaskCount).toFixed(2)));

    const nextRecord: AgentReputationRecord = {
      agentId: normalizedAgentId,
      successCount: nextSuccessCount,
      failureCount: current.failureCount,
      averageRating: nextAverageRating,
      reputationScore,
      updatedAt: new Date().toISOString()
    };
    this.records.set(normalizedAgentId, nextRecord);
    await this.persist();
    return nextRecord;
  }

  public async recordFailure(agentId: string): Promise<AgentReputationRecord> {
    await this.restorePromise;
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      throw new Error("agentId is required");
    }

    const current = this.records.get(normalizedAgentId) ?? this.createEmptyRecord(normalizedAgentId);
    const nextFailureCount = current.failureCount + 1;
    const totalTaskCount = current.successCount + nextFailureCount;
    const reputationScore =
      totalTaskCount === 0 ? 0 : Number((((current.successCount * current.averageRating) / totalTaskCount).toFixed(2)));

    const nextRecord: AgentReputationRecord = {
      agentId: normalizedAgentId,
      successCount: current.successCount,
      failureCount: nextFailureCount,
      averageRating: current.averageRating,
      reputationScore,
      updatedAt: new Date().toISOString()
    };
    this.records.set(normalizedAgentId, nextRecord);
    await this.persist();
    return nextRecord;
  }

  public async getAgentReputation(agentId: string): Promise<AgentReputationRecord | null> {
    await this.restorePromise;
    return this.records.get(agentId.trim()) ?? null;
  }

  public async applySettlementRating(agentId: string, rating: number): Promise<AgentReputationRecord> {
    await this.restorePromise;
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      throw new Error("agentId is required");
    }
    const safeRating = this.normalizeRating(rating);
    if (safeRating === undefined) {
      throw new Error("rating is required");
    }
    const current = this.records.get(normalizedAgentId) ?? this.createEmptyRecord(normalizedAgentId);
    if (current.successCount === 0) {
      return this.recordSuccess(normalizedAgentId, safeRating);
    }
    const nextAverageRating = Number(
      (((current.averageRating * Math.max(current.successCount - 1, 0) + safeRating) / current.successCount).toFixed(2))
    );
    const totalTaskCount = current.successCount + current.failureCount;
    const reputationScore =
      totalTaskCount === 0 ? 0 : Number((((current.successCount * nextAverageRating) / totalTaskCount).toFixed(2)));
    const nextRecord: AgentReputationRecord = {
      ...current,
      averageRating: nextAverageRating,
      reputationScore,
      updatedAt: new Date().toISOString()
    };
    this.records.set(normalizedAgentId, nextRecord);
    await this.persist();
    return nextRecord;
  }

  private async restore(): Promise<void> {
    try {
      await access(this.storePath);
    } catch {
      return;
    }

    try {
      const raw = await readFile(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ReputationStore>;
      const agents = parsed && typeof parsed === "object" && parsed.agents ? parsed.agents : {};
      for (const [agentId, record] of Object.entries(agents)) {
        const normalizedAgentId = agentId.trim();
        if (!normalizedAgentId) {
          continue;
        }
        const successCount = Number.isFinite(record.successCount) ? Math.max(0, record.successCount) : 0;
        const failureCount = Number.isFinite(record.failureCount) ? Math.max(0, record.failureCount) : 0;
        const averageRating = Number.isFinite(record.averageRating) ? Math.max(0, Number(record.averageRating)) : 0;
        const totalTaskCount = successCount + failureCount;
        const reputationScore =
          totalTaskCount === 0 ? 0 : Number((((successCount * averageRating) / totalTaskCount).toFixed(2)));
        this.records.set(normalizedAgentId, {
          agentId: normalizedAgentId,
          successCount,
          failureCount,
          averageRating: Number(averageRating.toFixed(2)),
          reputationScore,
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[ReputationManager] restore failed: ${reason}`);
    }
  }

  private async persist(): Promise<void> {
    const payload: ReputationStore = {
      version: 1,
      agents: Object.fromEntries(this.records.entries())
    };
    await writeFile(this.storePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private createEmptyRecord(agentId: string): AgentReputationRecord {
    return {
      agentId,
      successCount: 0,
      failureCount: 0,
      averageRating: 0,
      reputationScore: 0,
      updatedAt: new Date().toISOString()
    };
  }

  private normalizeRating(rating?: number): number | undefined {
    if (!Number.isFinite(rating)) {
      return undefined;
    }
    if (!rating) {
      return undefined;
    }
    const bounded = Math.min(5, Math.max(1, rating));
    return Number(bounded.toFixed(2));
  }
}

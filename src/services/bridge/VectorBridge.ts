import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createVectorTask, VectorTask, VectorTaskSchema } from "../../schema/Task.js";
import { actionToCapability, ServiceAction } from "./VectorMatrix.js";
import { processEvidence } from "../vault/VectorVault.js";

export interface WhatsappIncomingMedia {
  mimetype: string;
  data: string;
}

export interface WhatsappIncomingMessage {
  from: string;
  body: string;
  hasMedia: boolean;
  downloadMedia(): Promise<WhatsappIncomingMedia | null>;
}

export interface WhatsappGateway {
  sendMessage(chatId: string, content: string): Promise<unknown>;
  onMessage?(listener: (message: WhatsappIncomingMessage) => Promise<void> | void): void;
}

export interface ThreeViewNotificationPayload {
  task: VectorTask;
  bossView: string;
  expertView: string;
  buyerView: string;
  proofUrl: string;
  storageStatus: "CONFIRMED" | "PENDING_STORAGE";
  trigger: "manual" | "auto_reflection" | "retry_queue";
}

export interface RetrySettlementPayload {
  task: VectorTask;
  proofUrl: string;
  rootHash: string;
}

export interface VectorBridgeConfig {
  agentChatId: string;
  whatsappGateway?: WhatsappGateway;
  onThreeViewUpdate?: (payload: ThreeViewNotificationPayload) => Promise<void> | void;
  onRetrySettlement?: (payload: RetrySettlementPayload) => Promise<void> | void;
}

export interface DispatchResult {
  task: VectorTask;
  instruction: string;
}

interface PendingQueueEntry {
  task: VectorTask;
  imageBase64: string;
  retryCount: number;
  lastError: string | null;
  updatedAt: string;
}

export class VectorBridge {
  private readonly tasks = new Map<string, VectorTask>();
  private readonly pendingStorageQueue = new Map<string, PendingQueueEntry>();
  private readonly agentChatId: string;
  private readonly whatsappGateway?: WhatsappGateway;
  private readonly onThreeViewUpdate?: (payload: ThreeViewNotificationPayload) => Promise<void> | void;
  private readonly onRetrySettlement?: (payload: RetrySettlementPayload) => Promise<void> | void;
  private readonly pendingStorePath: string;
  private readonly retryTimer: NodeJS.Timeout;

  constructor(config: VectorBridgeConfig) {
    this.agentChatId = config.agentChatId;
    this.whatsappGateway = config.whatsappGateway;
    this.onThreeViewUpdate = config.onThreeViewUpdate;
    this.onRetrySettlement = config.onRetrySettlement;
    this.pendingStorePath = resolve(process.cwd(), "pending_tasks.json");
    void this.restorePendingQueue();
    if (this.whatsappGateway?.onMessage) {
      this.whatsappGateway.onMessage(async (message) => {
        await this.handleIncomingAgentMessage(message);
      });
    }
    this.retryTimer = setInterval(() => {
      void this.retryPendingStorageQueue();
    }, 5 * 60 * 1000);
    this.retryTimer.unref?.();
  }

  public async dispatchTask(countryCode: string, action: ServiceAction): Promise<DispatchResult> {
    const capability = actionToCapability(action);
    if (!capability) {
      throw new Error(`Unsupported service action: ${action}`);
    }

    const taskId = `VT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const task = createVectorTask({
      taskId,
      country: countryCode,
      serviceLine: capability
    });

    const instruction = [
      `Task ID: ${taskId}`,
      `Country: ${countryCode.toUpperCase()}`,
      `Service: ${capability}`,
      `Ref: [${taskId}]`,
      `Instruction: Please execute on-site ${capability.toLowerCase()} and return photo evidence with timestamp and coordinates.`
    ].join("\n");

    if (this.whatsappGateway) {
      await this.whatsappGateway.sendMessage(this.agentChatId, instruction);
    }

    console.info(`[VectorBridge] task dispatched: taskId=${taskId}, country=${countryCode.toUpperCase()}, action=${action}`);
    this.tasks.set(taskId, task);
    return { task, instruction };
  }

  public getTask(taskId: string): VectorTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  public async processTaskEvidence(taskId: string, imageBuffer: Buffer): Promise<{
    updatedTask: VectorTask;
    bossView: string;
    expertView: string;
    buyerView: string;
    proofUrl: string;
    storageStatus: "CONFIRMED" | "PENDING_STORAGE";
  }> {
    return this.processTaskEvidenceInternal(taskId, imageBuffer, "manual", { notifyThreeView: true });
  }

  private async processTaskEvidenceInternal(
    taskId: string,
    imageBuffer: Buffer,
    trigger: "manual" | "auto_reflection" | "retry_queue",
    options: { notifyThreeView: boolean }
  ): Promise<{
    updatedTask: VectorTask;
    bossView: string;
    expertView: string;
    buyerView: string;
    proofUrl: string;
    storageStatus: "CONFIRMED" | "PENDING_STORAGE";
  }> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    console.info(`[VectorBridge] evidence processing started: trigger=${trigger}, taskId=${taskId}`);
    const result = await processEvidence({
      task,
      imageBuffer,
      locationLabel: "迪拜某工厂",
      trigger
    });

    const finalizedTask = this.resolveFinalTaskState(result.updatedTask, trigger, result.storageStatus);
    this.tasks.set(taskId, finalizedTask);
    if (result.storageStatus === "PENDING_STORAGE") {
      await this.enqueuePendingStorage(
        finalizedTask,
        imageBuffer,
        trigger === "retry_queue" ? "retry pending" : null,
        trigger === "retry_queue"
      );
    } else {
      await this.dequeuePendingStorage(taskId);
    }

    if (options.notifyThreeView && this.onThreeViewUpdate) {
      await this.onThreeViewUpdate({
        task: finalizedTask,
        bossView: result.bossView,
        expertView: result.expertView,
        buyerView: result.buyerView,
        proofUrl: result.proofUrl,
        storageStatus: result.storageStatus,
        trigger
      });
    }
    if (trigger === "retry_queue" && result.storageStatus === "CONFIRMED" && this.onRetrySettlement) {
      await this.onRetrySettlement({
        task: finalizedTask,
        proofUrl: result.proofUrl,
        rootHash: result.rootHash
      });
    }
    console.info(
      `[VectorBridge] evidence processing completed: trigger=${trigger}, taskId=${taskId}, storageStatus=${result.storageStatus}`
    );
    return {
      updatedTask: finalizedTask,
      bossView: result.bossView,
      expertView: result.expertView,
      buyerView: result.buyerView,
      proofUrl: result.proofUrl,
      storageStatus: result.storageStatus
    };
  }

  private resolveFinalTaskState(
    updatedTask: VectorTask,
    trigger: "manual" | "auto_reflection" | "retry_queue",
    storageStatus: "CONFIRMED" | "PENDING_STORAGE"
  ): VectorTask {
    if (trigger === "retry_queue" && storageStatus === "CONFIRMED") {
      return VectorTaskSchema.parse({
        ...updatedTask,
        status: "completed",
        bossSnapshot: {
          ...updatedTask.bossSnapshot,
          progress: "存证补传成功，任务已闭环。",
          risk: "链上哈希已锁定，风险关闭。",
          summaryZh: `任务 ${updatedTask.taskId} 已在 0G 正式锁定。`,
          riskLevel: "low"
        },
        expertAudit: {
          ...updatedTask.expertAudit,
          complianceCode: "EVIDENCE_LOCKED"
        }
      });
    }
    return updatedTask;
  }

  private async retryPendingStorageQueue(): Promise<void> {
    if (!this.pendingStorageQueue.size) {
      return;
    }

    console.info(`[VectorBridge] retry scanner started: pendingCount=${this.pendingStorageQueue.size}`);
    for (const [taskId, entry] of this.pendingStorageQueue.entries()) {
      try {
        await this.processTaskEvidenceInternal(taskId, Buffer.from(entry.imageBase64, "base64"), "retry_queue", {
          notifyThreeView: false
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const nextEntry: PendingQueueEntry = {
          ...entry,
          retryCount: entry.retryCount + 1,
          lastError: reason,
          updatedAt: new Date().toISOString()
        };
        this.pendingStorageQueue.set(taskId, nextEntry);
        await this.persistPendingQueue();
        console.error(`[VectorBridge] retry failed: taskId=${taskId}, reason=${reason}`);
      }
    }
    console.info(`[VectorBridge] retry scanner completed: pendingCount=${this.pendingStorageQueue.size}`);
  }

  private async enqueuePendingStorage(
    task: VectorTask,
    imageBuffer: Buffer,
    lastError: string | null,
    incrementRetryCount: boolean
  ): Promise<void> {
    const existing = this.pendingStorageQueue.get(task.taskId);
    const nextEntry: PendingQueueEntry = {
      task,
      imageBase64: imageBuffer.toString("base64"),
      retryCount: existing ? existing.retryCount + (incrementRetryCount ? 1 : 0) : incrementRetryCount ? 1 : 0,
      lastError,
      updatedAt: new Date().toISOString()
    };
    this.pendingStorageQueue.set(task.taskId, nextEntry);
    await this.persistPendingQueue();
    console.warn(`[VectorBridge] pending storage queued: taskId=${task.taskId}`);
  }

  private async dequeuePendingStorage(taskId: string): Promise<void> {
    if (!this.pendingStorageQueue.has(taskId)) {
      return;
    }
    this.pendingStorageQueue.delete(taskId);
    await this.persistPendingQueue();
    console.info(`[VectorBridge] pending storage removed: taskId=${taskId}`);
  }

  private async restorePendingQueue(): Promise<void> {
    try {
      await access(this.pendingStorePath);
    } catch {
      return;
    }

    try {
      const raw = await readFile(this.pendingStorePath, "utf-8");
      const parsed = JSON.parse(raw) as { pending?: PendingQueueEntry[] };
      const pendingList = Array.isArray(parsed.pending) ? parsed.pending : [];
      for (const item of pendingList) {
        const task = VectorTaskSchema.parse(item.task);
        const hydrated: PendingQueueEntry = {
          task,
          imageBase64: item.imageBase64,
          retryCount: Number.isFinite(item.retryCount) ? item.retryCount : 0,
          lastError: item.lastError ?? null,
          updatedAt: item.updatedAt ?? new Date().toISOString()
        };
        this.tasks.set(task.taskId, task);
        this.pendingStorageQueue.set(task.taskId, hydrated);
      }
      console.info(`[VectorBridge] pending storage restored: count=${this.pendingStorageQueue.size}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[VectorBridge] pending storage restore failed: ${reason}`);
    }
  }

  private async persistPendingQueue(): Promise<void> {
    const payload = {
      version: 1,
      pending: Array.from(this.pendingStorageQueue.values())
    };
    await writeFile(this.pendingStorePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private parseTaskIdFromMessage(text: string): string | null {
    const refMatch = text.match(/Ref:\s*\[([A-Za-z0-9-]+)\]/i);
    if (refMatch?.[1]) {
      return refMatch[1];
    }
    const taskMatch = text.match(/(VT-\d{8}-[A-Z0-9]{8})/);
    return taskMatch?.[1] ?? null;
  }

  private async handleIncomingAgentMessage(message: WhatsappIncomingMessage): Promise<void> {
    if (message.from !== this.agentChatId || !message.hasMedia) {
      return;
    }

    const taskId = this.parseTaskIdFromMessage(message.body ?? "");
    if (!taskId) {
      console.warn("[VectorBridge] auto reflection ignored: media message without task reference");
      return;
    }

    const media = await message.downloadMedia();
    if (!media || !media.data || !media.mimetype.startsWith("image/")) {
      console.warn(`[VectorBridge] auto reflection ignored: invalid media payload for taskId=${taskId}`);
      return;
    }

    try {
      const imageBuffer = Buffer.from(media.data, "base64");
      await this.processTaskEvidenceInternal(taskId, imageBuffer, "auto_reflection", { notifyThreeView: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[VectorBridge] auto reflection failed: taskId=${taskId}, reason=${reason}`);
    }
  }
}

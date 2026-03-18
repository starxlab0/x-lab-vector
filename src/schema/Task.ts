import { z } from "zod";

const riskLevels = ["low", "medium", "high", "critical"] as const;

export const VectorTaskSchema = z.object({
  taskId: z.string().min(1),
  country: z.string().min(2),
  serviceLine: z.string().min(1),
  status: z.enum(["queued", "in_progress", "pending_storage", "blocked", "completed"]),
  bossSnapshot: z.object({
    progress: z.string().min(1),
    risk: z.string().min(1),
    summaryZh: z.string().min(1),
    riskLevel: z.enum(riskLevels)
  }),
  expertAudit: z.object({
    zeroGRootHash: z.string().nullable(),
    proofHash: z.string().nullable(),
    complianceCode: z.string().min(1),
    verifiedAt: z.string().datetime().nullable(),
    auditor: z.string().min(1)
  }),
  buyerGateway: z.object({
    title: z.string().min(1),
    executiveSummary: z.string().min(1),
    trustHighlights: z.array(z.string().min(1)).min(1),
    nextActions: z.array(z.string().min(1)).min(1)
  })
});

export type VectorTask = z.infer<typeof VectorTaskSchema>;

export const createBuyerGatewayTemplate = (task: Pick<VectorTask, "taskId" | "country" | "serviceLine">) => {
  return {
    title: `Execution Assurance Report - ${task.country}`,
    executiveSummary: `Task ${task.taskId} for ${task.serviceLine} is progressing with verified operational evidence.`,
    trustHighlights: [
      "Field evidence archived with immutable storage proof.",
      "Compliance checkpoints reviewed by certified specialists."
    ],
    nextActions: ["Share sample validation timeline.", "Confirm buyer acceptance criteria."]
  };
};

export const createVectorTask = (input: { taskId: string; country: string; serviceLine: string }): VectorTask => {
  return VectorTaskSchema.parse({
    taskId: input.taskId,
    country: input.country.toUpperCase(),
    serviceLine: input.serviceLine,
    status: "queued",
    bossSnapshot: {
      progress: "任务已下发，等待代理人回传证据。",
      risk: "现场证据未回传前无法完成最终核验。",
      summaryZh: `任务 ${input.taskId} 已进入执行队列。`,
      riskLevel: "medium"
    },
    expertAudit: {
      zeroGRootHash: null,
      proofHash: null,
      complianceCode: "PENDING_REVIEW",
      verifiedAt: null,
      auditor: "Vector Automated Auditor"
    },
    buyerGateway: createBuyerGatewayTemplate({
      taskId: input.taskId,
      country: input.country.toUpperCase(),
      serviceLine: input.serviceLine
    })
  });
};

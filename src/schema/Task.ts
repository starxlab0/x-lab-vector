import { z } from "zod";

const riskLevels = ["low", "medium", "high", "critical"] as const;
export const TASK_STATUS = ["queued", "in_progress", "pending_storage", "blocked", "completed", "SETTLED"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const VectorTaskSchema = z.object({
  taskId: z.string().min(1),
  country: z.string().min(2),
  serviceLine: z.string().min(1),
  taskDescription: z.string().min(1).optional(),
  status: z.enum(TASK_STATUS),
  rewardAmount: z.number().default(0),
  rating: z.number().min(1).max(5).optional(),
  agentWallet: z.string().optional(),
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

const generateExecutiveSummaryWithElizaLogic = (task: {
  taskId: string;
  country: string;
  serviceLine: string;
  taskDescription?: string;
}): string => {
  const normalizedDescription = task.taskDescription?.trim() ?? "";
  if (!normalizedDescription) {
    return `Task ${task.taskId} for ${task.serviceLine} in ${task.country} is positioned as a trust-first execution mandate with measurable field evidence and conversion-ready assurance output.`;
  }
  const urgencyTone = /(紧急|urgent|asap|立即|today|24h)/i.test(normalizedDescription)
    ? "high-urgency"
    : "planned";
  const complianceTone = /(合规|compliance|audit|认证|certificate|traceability)/i.test(normalizedDescription)
    ? "compliance-critical"
    : "delivery-focused";
  return `Task ${task.taskId} targets ${task.serviceLine} in ${task.country} with a ${urgencyTone}, ${complianceTone} mandate: ${normalizedDescription}. Buyer-facing confidence is strengthened through verifiable field evidence and auditable execution milestones.`;
};

export const createBuyerGatewayTemplate = (task: Pick<VectorTask, "taskId" | "country" | "serviceLine" | "taskDescription">) => {
  return {
    title: `Execution Assurance Report - ${task.country}`,
    executiveSummary: generateExecutiveSummaryWithElizaLogic(task),
    trustHighlights: [
      "Field evidence archived with immutable storage proof.",
      "Compliance checkpoints reviewed by certified specialists."
    ],
    nextActions: ["Share sample validation timeline.", "Confirm buyer acceptance criteria."]
  };
};

export const createVectorTask = (input: {
  taskId: string;
  country: string;
  serviceLine: string;
  taskDescription?: string;
  rewardAmount?: number;
  agentWallet?: string;
}): VectorTask => {
  return VectorTaskSchema.parse({
    taskId: input.taskId,
    country: input.country.toUpperCase(),
    serviceLine: input.serviceLine,
    taskDescription: input.taskDescription,
    status: "queued",
    rewardAmount: input.rewardAmount ?? 0,
    agentWallet: input.agentWallet,
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
      serviceLine: input.serviceLine,
      taskDescription: input.taskDescription
    })
  });
};

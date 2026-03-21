import { BusinessPersona, buildPersonaAnswer, detectOfflineIntent, defaultBusinessPersona } from "../../agents/persona/BusinessPersona.js";
import { ServiceAction } from "../bridge/VectorMatrix.js";

export type DigitalChannel = "telegram" | "whatsapp";

export interface SocialInboundMessage {
  channel: DigitalChannel;
  chatId: string;
  text: string;
  senderRole: "boss" | "buyer" | "agent" | "unknown";
}

export interface SocialTaskProposal {
  countryCode: string;
  action: ServiceAction;
  rewardAmount: number;
  taskDescription: string;
}

export interface SocialDispatchResult {
  shouldReply: boolean;
  replyText: string;
  shouldCreateTask: boolean;
  taskProposal?: SocialTaskProposal;
}

export interface EvidenceDraftInput {
  taskId: string;
  country: string;
  serviceLine: string;
  proofUrl: string;
  rootHash: string;
  capturedAt: string;
}

const COUNTRY_KEYWORDS: Record<string, string[]> = {
  UAE: ["uae", "dubai", "阿联酋", "迪拜"],
  SGP: ["sgp", "singapore", "新加坡"],
  SAU: ["sau", "saudi", "沙特", "riyadh", "利雅得"]
};

const ACTION_KEYWORDS: Array<{ action: ServiceAction; keywords: string[] }> = [
  { action: "核真", keywords: ["核真", "verification", "verify", "验真"] },
  { action: "采样", keywords: ["采样", "sampling", "sample"] },
  { action: "认证", keywords: ["认证", "certification", "certificate", "audit"] }
];

export class SocialEngine {
  private readonly persona: BusinessPersona;

  constructor(persona: BusinessPersona = defaultBusinessPersona) {
    this.persona = persona;
  }

  public handleMessage(message: SocialInboundMessage): SocialDispatchResult {
    const normalized = message.text.trim();
    if (!normalized) {
      return {
        shouldReply: false,
        replyText: "",
        shouldCreateTask: false
      };
    }
    const intent = detectOfflineIntent(this.persona, normalized);
    const baseReply = buildPersonaAnswer(this.persona, normalized);
    if (intent === "create_task") {
      const proposal = this.parseTaskProposal(normalized);
      if (!proposal) {
        return {
          shouldReply: true,
          replyText: `${baseReply}\n如需创建线下任务，请补充国家（UAE/SGP/SAU）与服务类型（核真/采样/认证）。`,
          shouldCreateTask: false
        };
      }
      return {
        shouldReply: true,
        replyText: `${baseReply}\n已识别为线下执行诉求，建议发起 ${proposal.countryCode} / ${proposal.action} 任务。`,
        shouldCreateTask: message.senderRole === "boss",
        taskProposal: proposal
      };
    }
    return {
      shouldReply: true,
      replyText: baseReply,
      shouldCreateTask: false
    };
  }

  public generateEvidencePostDraft(input: EvidenceDraftInput): string {
    const opening = this.persona.socialStyle.openingTemplates[0] ?? `${this.persona.brandName} 最新进展：`;
    const closing = this.persona.socialStyle.closingTemplates[0] ?? "欢迎私信了解执行细节。";
    return [
      "📰 自媒体动态草稿（含确证）",
      opening,
      `我们在 ${input.country} 完成了 ${input.serviceLine} 现场执行，任务编号 ${input.taskId}。`,
      `链上证据哈希：${input.rootHash}`,
      `证据时间：${input.capturedAt}`,
      `浏览链接：${input.proofUrl}`,
      "这意味着买家可直接核验执行真实性与时间链路。",
      closing
    ].join("\n");
  }

  private parseTaskProposal(text: string): SocialTaskProposal | undefined {
    const countryCode = this.detectCountryCode(text);
    const action = this.detectAction(text);
    if (!countryCode || !action) {
      return undefined;
    }
    return {
      countryCode,
      action,
      rewardAmount: 0,
      taskDescription: text
    };
  }

  private detectCountryCode(text: string): string | undefined {
    const normalized = text.toLowerCase();
    for (const [countryCode, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
      if (keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
        return countryCode;
      }
    }
    return undefined;
  }

  private detectAction(text: string): ServiceAction | undefined {
    const normalized = text.toLowerCase();
    const matched = ACTION_KEYWORDS.find((item) =>
      item.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
    );
    return matched?.action;
  }
}

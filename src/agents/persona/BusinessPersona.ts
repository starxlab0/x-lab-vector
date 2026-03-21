export type PersonaTone = "strategic" | "operational" | "compliance";
export type OfflineIntent = "create_task" | "qa";

export interface BusinessPersona {
  id: string;
  locale: "zh-CN" | "en-US";
  tone: PersonaTone;
  brandName: string;
  backgroundKnowledge: string[];
  faq: Array<{ question: string; answer: string }>;
  socialStyle: {
    voice: string;
    openingTemplates: string[];
    closingTemplates: string[];
  };
  offlineTaskSignals: string[];
  goals: string[];
}

export const defaultBusinessPersona: BusinessPersona = {
  id: "vector-biz-persona",
  locale: "zh-CN",
  tone: "strategic",
  brandName: "X-LAB Vector",
  backgroundKnowledge: [
    "X-LAB Vector 提供跨境线下执行与可信证据闭环能力。",
    "所有关键任务可通过 0G 进行可审计存证，支持买家验真。",
    "支持核真、采样、认证三类服务，覆盖多国家执行网络。"
  ],
  faq: [
    {
      question: "你们怎么保证真实性？",
      answer: "我们通过现场证据、链上哈希与专家审计三层机制确保可验证真实性。"
    },
    {
      question: "多久能出结果？",
      answer: "标准流程在任务受理后可快速回传证据，复杂场景会给出阶段性里程碑。"
    },
    {
      question: "是否支持定制化任务？",
      answer: "支持，我们可按国家、行业和合规要求配置执行路径与验收标准。"
    }
  ],
  socialStyle: {
    voice: "专业、可信、简洁，强调可验证证据与商业结果",
    openingTemplates: ["感谢关注 X-LAB Vector。", "收到你的需求，我们给你一个可落地方案。"],
    closingTemplates: ["如果需要，我可以继续帮你生成任务指令。", "你也可以直接给我国家和目标，我们立即推进。"]
  },
  offlineTaskSignals: ["上门", "线下", "核真", "采样", "认证", "验厂", "inspect", "verification", "sampling", "certification"],
  goals: ["推进跨境执行", "构建买家信任", "强化合规可审计"]
};

export const detectOfflineIntent = (persona: BusinessPersona, text: string): OfflineIntent => {
  const normalized = text.toLowerCase();
  return persona.offlineTaskSignals.some((signal) => normalized.includes(signal.toLowerCase())) ? "create_task" : "qa";
};

export const buildPersonaAnswer = (persona: BusinessPersona, text: string): string => {
  const normalized = text.trim();
  const faqMatch = persona.faq.find((item) => normalized.includes(item.question.replace("？", "")));
  const opening = persona.socialStyle.openingTemplates[0];
  const closing = persona.socialStyle.closingTemplates[0];
  if (faqMatch) {
    return `${opening}\n${faqMatch.answer}\n${closing}`;
  }
  const knowledge = persona.backgroundKnowledge[0];
  return `${opening}\n${knowledge}\n我们建议先明确国家、服务类型与验收目标，我可以继续协助拆解。\n${closing}`;
};

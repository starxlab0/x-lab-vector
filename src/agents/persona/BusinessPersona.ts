export type PersonaTone = "strategic" | "operational" | "compliance";

export interface BusinessPersona {
  id: string;
  locale: "zh-CN" | "en-US";
  tone: PersonaTone;
  goals: string[];
}

export const defaultBusinessPersona: BusinessPersona = {
  id: "vector-biz-persona",
  locale: "zh-CN",
  tone: "strategic",
  goals: ["推进跨境执行", "构建买家信任", "强化合规可审计"]
};

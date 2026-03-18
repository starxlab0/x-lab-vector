import "@elizaos/core";

import { Telegraf, Markup } from "telegraf";
import { Client as WhatsAppClient, LocalAuth } from "whatsapp-web.js";

import { VectorBridge, WhatsappGateway } from "./services/bridge/VectorBridge.js";
import {
  buildCountryButtons,
  buildCountryServiceButtons,
  parseTaskActionCallback,
  resolveCountryServices
} from "./services/bridge/VectorMatrix.js";

const createWhatsappGateway = async (): Promise<WhatsappGateway | undefined> => {
  if (process.env.WA_ENABLED !== "true") {
    return undefined;
  }

  const client = new WhatsAppClient({
    authStrategy: new LocalAuth({ clientId: "vector-xlab-core" })
  });
  await client.initialize();
  return {
    sendMessage: (chatId, content) => client.sendMessage(chatId, content),
    onMessage: (listener) => {
      client.on("message", (message) => {
        void listener({
          from: message.from,
          body: message.body ?? "",
          hasMedia: message.hasMedia,
          downloadMedia: async () => {
            const media = await message.downloadMedia();
            if (!media) {
              return null;
            }
            return {
              mimetype: media.mimetype,
              data: media.data
            };
          }
        });
      });
    }
  };
};

export const bootstrapVectorCore = async () => {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const bossChatId = process.env.TELEGRAM_BOSS_CHAT_ID;
  const agentChatId = process.env.WA_AGENT_CHAT_ID ?? "971000000000@c.us";
  const whatsappGateway = await createWhatsappGateway();

  if (!telegramToken) {
    return {
      status: "idle",
      reason: "TELEGRAM_BOT_TOKEN is not configured",
      countryMenu: buildCountryButtons()
    };
  }

  const bot = new Telegraf(telegramToken);
  const bridge = new VectorBridge({
    agentChatId,
    whatsappGateway,
    onThreeViewUpdate: async (payload) => {
      if (!bossChatId) {
        console.warn(`[VectorCore] missing TELEGRAM_BOSS_CHAT_ID, skip push for taskId=${payload.task.taskId}`);
        return;
      }

      const keyboard = Markup.inlineKeyboard([[Markup.button.url("查看 0G 浏览器证据", payload.proofUrl)]]);
      const triggerLabel =
        payload.trigger === "auto_reflection"
          ? "自动反射"
          : payload.trigger === "retry_queue"
            ? "重试队列"
            : "手动触发";
      await bot.telegram.sendMessage(
        bossChatId,
        `${payload.bossView}\n触发来源：${triggerLabel}`,
        keyboard
      );
      await bot.telegram.sendMessage(bossChatId, payload.expertView);
      await bot.telegram.sendMessage(bossChatId, payload.buyerView);
    },
    onRetrySettlement: async (payload) => {
      if (!bossChatId) {
        return;
      }
      await bot.telegram.sendMessage(
        bossChatId,
        `🔔 任务 [${payload.task.taskId}] 的存证已正式在 0G 链上锁定成功。原哈希已生效。`,
        Markup.inlineKeyboard([[Markup.button.url("查看 0G 浏览器证据", payload.proofUrl)]])
      );
    }
  });

  bot.start(async (ctx) => {
    await ctx.reply("请选择执行国家：", Markup.inlineKeyboard(buildCountryButtons()));
  });

  bot.action(/^country:(.+)$/, async (ctx) => {
    const countryCode = String(ctx.match[1]).toUpperCase();
    const services = resolveCountryServices(countryCode);
    if (!services.length) {
      await ctx.answerCbQuery("该国家尚未开通服务");
      return;
    }
    await ctx.reply(
      `国家 ${countryCode} 已选择。请选择任务类型：`,
      Markup.inlineKeyboard(buildCountryServiceButtons(countryCode))
    );
    await ctx.answerCbQuery("已加载服务矩阵");
  });

  bot.action(/^task:.+$/, async (ctx) => {
    const callbackData = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
    const parsed = parseTaskActionCallback(callbackData);
    if (!parsed) {
      await ctx.answerCbQuery("任务参数无效");
      return;
    }

    const dispatchResult = await bridge.dispatchTask(parsed.countryCode, parsed.action);
    await ctx.reply(
      [
        `✅ 已下发任务`,
        `Task ID: ${dispatchResult.task.taskId}`,
        `Service: ${dispatchResult.task.serviceLine}`,
        `Agent Channel: ${agentChatId}`
      ].join("\n")
    );
    await ctx.reply(`Instruction sent to agent:\n${dispatchResult.instruction}`);
    await ctx.answerCbQuery("任务已下发");
  });

  bot.command("evidence", async (ctx) => {
    const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
    const taskId = text.split(" ").slice(1).join(" ").trim();
    if (!taskId) {
      await ctx.reply("请使用 /evidence <TaskID>");
      return;
    }

    console.info(`[VectorCore] manual evidence trigger: taskId=${taskId}`);
    const sampleImageBuffer = Buffer.from(`vector-evidence:${taskId}:${Date.now()}`, "utf-8");
    const result = await bridge.processTaskEvidence(taskId, sampleImageBuffer);
    await ctx.reply(result.bossView, Markup.inlineKeyboard([[Markup.button.url("查看 0G 浏览器证据", result.proofUrl)]]));
    await ctx.reply(result.expertView);
    await ctx.reply(result.buyerView);
    await ctx.reply(`Storage Status: ${result.storageStatus}`);
  });

  await bot.launch();
  return {
    status: "running",
    bridge,
    bot
  };
};

void bootstrapVectorCore();

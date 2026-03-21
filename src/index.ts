import "@elizaos/core";

import { readFile, rm, writeFile } from "node:fs/promises";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import { Telegraf, Markup } from "telegraf";
import WhatsApp from "whatsapp-web.js";

import { VectorBridge, WhatsappGateway } from "./services/bridge/VectorBridge.js";
import {
  buildCountryButtons,
  buildCountryServiceButtons,
  parseTaskActionCallback,
  resolveCountryServices
} from "./services/bridge/VectorMatrix.js";

const renderCreditStars = (reputationScore: number): string => {
  const bounded = Math.max(0, Math.min(5, reputationScore));
  const rounded = Math.round(bounded);
  return `${"⭐".repeat(rounded)}${"☆".repeat(5 - rounded)}`;
};

const createWhatsappGateway = async (): Promise<WhatsappGateway | undefined> => {
  if (process.env.WA_ENABLED !== "true") {
    return undefined;
  }

  const exec = promisify(execCallback);
  await exec("pkill -9 -f chrome-linux64/chrome").catch(() => undefined);
  await exec("pkill -9 -f 'Google Chrome for Testing'").catch(() => undefined);

  const sessionDir = ".wwebjs_auth/session-vector-xlab-core";
  const singletonPaths = [
    `${sessionDir}/SingletonLock`,
    `${sessionDir}/SingletonSocket`,
    `${sessionDir}/SingletonCookie`,
    `${sessionDir}/Default/SingletonLock`,
    `${sessionDir}/Default/SingletonSocket`,
    `${sessionDir}/Default/SingletonCookie`
  ];
  await Promise.all(singletonPaths.map((target) => rm(target, { force: true })));

  const { Client: WhatsAppClient, LocalAuth } = WhatsApp;
  const client = new WhatsAppClient({
    authStrategy: new LocalAuth({ clientId: "vector-xlab-core" }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });
  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("WhatsApp client ready timeout"));
    }, 12000);
    const onReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    const onAuthFailure = (message: string) => {
      clearTimeout(timeout);
      reject(new Error(`WhatsApp auth failure: ${message}`));
    };
    const onDisconnected = (reason: string) => {
      clearTimeout(timeout);
      reject(new Error(`WhatsApp disconnected before ready: ${reason}`));
    };
    client.once("ready", onReady);
    client.once("auth_failure", onAuthFailure);
    client.once("disconnected", onDisconnected);
  });
  void client.initialize();
  await readyPromise;
  return {
    sendMessage: async (chatId, content) => {
      try {
        const normalizedChatId = chatId.trim();
        if (!normalizedChatId) {
          throw new Error("empty chat id");
        }

        let targetChatId = normalizedChatId;
        if (normalizedChatId.endsWith("@c.us")) {
          const phoneNumber = normalizedChatId.slice(0, -5);
          const numberId = await client.getNumberId(phoneNumber);
          if (!numberId) {
            throw new Error(`number not registered on WhatsApp: ${phoneNumber}`);
          }
          targetChatId = typeof numberId === "string" ? numberId : numberId._serialized;
        }

        return await client.sendMessage(targetChatId, content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`WhatsApp send failed for ${chatId}: ${message}`);
      }
    },
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
  let bossChatId = process.env.TELEGRAM_BOSS_CHAT_ID;
  const configuredAgentChatIds = (process.env.WA_AGENT_CHAT_IDS ?? process.env.WA_AGENT_CHAT_ID ?? "971000000000@c.us")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const agentChatIds = Array.from(new Set(configuredAgentChatIds));
  let whatsappGateway: WhatsappGateway | undefined;
  try {
    whatsappGateway = await createWhatsappGateway();
  } catch (error) {
    console.error("[VectorCore] WhatsApp gateway init failed, continue with Telegram-only mode", error);
    whatsappGateway = undefined;
  }

  if (!telegramToken) {
    return {
      status: "idle",
      reason: "TELEGRAM_BOT_TOKEN is not configured",
      countryMenu: buildCountryButtons()
    };
  }

  const bot = new Telegraf(telegramToken);
  bot.catch((error, ctx) => {
    const callbackData = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "n/a";
    console.error(`[VectorCore] bot handler error: callbackData=${callbackData}`, error);
  });

  const bridge = new VectorBridge({
    agentChatIds,
    whatsappGateway,
    onThreeViewUpdate: async (payload) => {
      if (!bossChatId) {
        console.warn(`[VectorCore] missing TELEGRAM_BOSS_CHAT_ID, skip push for taskId=${payload.task.taskId}`);
        return;
      }

      const reputation = await bridge.getTaskAgentReputation(payload.task.taskId);
      const creditStars = renderCreditStars(reputation?.reputationScore ?? 0);
      const keyboard =
        payload.storageStatus === "CONFIRMED" && (payload.task.status === "completed" || payload.task.status === "blocked")
          ? Markup.inlineKeyboard([
              [Markup.button.url("查看 0G 浏览器证据", payload.proofUrl)],
              ...(payload.task.status === "completed"
                ? [[Markup.button.callback("✅ 确认验收", `settle:confirm:${payload.task.taskId}`)]]
                : [])
            ])
          : Markup.inlineKeyboard([[Markup.button.url("查看 0G 浏览器证据", payload.proofUrl)]]);
      const triggerLabel =
        payload.trigger === "auto_reflection"
          ? "自动反射"
          : payload.trigger === "retry_queue"
            ? "重试队列"
            : "手动触发";
      await bot.telegram.sendMessage(
        bossChatId,
        `${payload.bossView}\n触发来源：${triggerLabel}\n代理人信用：${creditStars}`,
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

  bot.command("whoami", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const role = bossChatId === chatId ? "boss" : "operator";
    await ctx.reply(`chat_id=${chatId}\nrole=${role}`);
  });

  bot.command("setboss", async (ctx) => {
    const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
    const explicitChatId = text.split(" ").slice(1).join(" ").trim();
    const nextBossChatId = explicitChatId || String(ctx.chat.id);
    bossChatId = nextBossChatId;
    try {
      const envPath = `${process.cwd()}/.env`;
      const envContent = await readFile(envPath, "utf-8");
      const nextEnvContent = envContent.match(/^TELEGRAM_BOSS_CHAT_ID=/m)
        ? envContent.replace(/^TELEGRAM_BOSS_CHAT_ID=.*$/m, `TELEGRAM_BOSS_CHAT_ID=${nextBossChatId}`)
        : `${envContent.trimEnd()}\nTELEGRAM_BOSS_CHAT_ID=${nextBossChatId}\n`;
      await writeFile(envPath, nextEnvContent, "utf-8");
      await ctx.reply(`✅ boss chat 已切换为: ${bossChatId}`);
    } catch (error) {
      console.error(`[VectorCore] setboss persist failed: target=${nextBossChatId}`, error);
      await ctx.reply(`⚠️ boss chat 已切换(内存): ${bossChatId}，但写入 .env 失败`);
    }
  });

  bot.command("currentboss", async (ctx) => {
    await ctx.reply(`current boss chat id: ${bossChatId ?? "未设置"}`);
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

    try {
      const dispatchResult = await bridge.dispatchTask(parsed.countryCode, parsed.action, {
        agentChatIds,
        taskDescription: `${parsed.countryCode} 市场 ${parsed.action} 任务，需提供可审计的一线证据闭环。`
      });
      await ctx.reply(
        [
          `✅ 已下发任务`,
          `Task ID: ${dispatchResult.task.taskId}`,
          `Service: ${dispatchResult.task.serviceLine}`,
          `Agent Candidates: ${agentChatIds.join(", ")}`
        ].join("\n")
      );
      await ctx.reply(`Instruction sent to agent:\n${dispatchResult.instruction}`);
      await ctx.answerCbQuery("任务已下发");
    } catch (error) {
      console.error(
        `[VectorCore] task dispatch failed: country=${parsed.countryCode}, action=${parsed.action}, agentChatIds=${agentChatIds.join(",")}`,
        error
      );
      await ctx.answerCbQuery("下发失败，请检查 WA 登录状态", { show_alert: true });
      await ctx.reply("❌ 任务下发失败：请检查 WhatsApp 登录状态和 WA_AGENT_CHAT_IDS");
    }
  });

  bot.action(/^settle:confirm:([A-Za-z0-9-]+)$/, async (ctx) => {
    if (!bossChatId || String(ctx.chat?.id ?? "") !== bossChatId) {
      await ctx.answerCbQuery("仅老板账号可执行验收");
      return;
    }
    const taskId = String(ctx.match[1]);
    const ratingButtons = [
      [Markup.button.callback("1⭐", `settle:rate:${taskId}:1`)],
      [Markup.button.callback("2⭐", `settle:rate:${taskId}:2`)],
      [Markup.button.callback("3⭐", `settle:rate:${taskId}:3`)],
      [Markup.button.callback("4⭐", `settle:rate:${taskId}:4`)],
      [Markup.button.callback("5⭐", `settle:rate:${taskId}:5`)]
    ];
    await ctx.reply(`请为任务 ${taskId} 评分：`, Markup.inlineKeyboard(ratingButtons));
    await ctx.answerCbQuery("请选择评分");
  });

  bot.action(/^settle:rate:([A-Za-z0-9-]+):([1-5])$/, async (ctx) => {
    if (!bossChatId || String(ctx.chat?.id ?? "") !== bossChatId) {
      await ctx.answerCbQuery("仅老板账号可执行结算");
      return;
    }
    const taskId = String(ctx.match[1]);
    const rating = Number(ctx.match[2]);
    try {
      const settlement = await bridge.settleTask(taskId, rating);
      const creditStars = renderCreditStars(settlement.reputation?.reputationScore ?? 0);
      await ctx.reply(
        `💰 账单已生成！实付: ${settlement.rewardAmount} USDT | X-LAB 服务费 (20%): ${settlement.serviceFee} USDT | 代理人实收: ${settlement.agentNetIncome} USDT`
      );
      await ctx.reply(`✅ 任务已结算\nTask ID: ${taskId}\n评分: ${rating}⭐\n代理人信用：${creditStars}`);
      await ctx.answerCbQuery("已完成评分结算");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.answerCbQuery("结算失败", { show_alert: true });
      await ctx.reply(`❌ 评分结算失败：${message}`);
    }
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
    await ctx.reply(
      [
        `✅ 已触发证据处理`,
        `Task ID: ${taskId}`,
        `Storage Status: ${result.storageStatus}`,
        `Boss 账号将收到完整三视角推送`
      ].join("\n"),
      Markup.inlineKeyboard([[Markup.button.url("查看 0G 浏览器证据", result.proofUrl)]])
    );
    await ctx.reply(`Storage Status: ${result.storageStatus}`);
  });

  let launched = false;
  while (!launched) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch({ dropPendingUpdates: true });
      launched = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isPollingConflict =
        message.includes("409") ||
        message.includes("terminated by other getUpdates request") ||
        message.includes("Conflict");
      if (!isPollingConflict) {
        throw error;
      }
      console.warn(`[VectorCore] telegram polling conflict detected, retrying launch in 3s: ${message}`);
      await new Promise((resolveLaunchRetry) => setTimeout(resolveLaunchRetry, 3000));
    }
  }
  return {
    status: "running",
    bridge,
    bot
  };
};

void bootstrapVectorCore();

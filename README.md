# Vector-XLAB-Core

Vector-XLAB-Core 是一个基于 OMNI 架构的全球商业执行引擎原型，支持以下核心闭环：

- Telegram 老板端下发任务
- WhatsApp 代理端回传证据
- 0G 存证与三视角报告生成
- pending_storage 可靠性重试队列与重启恢复

## 当前能力

- L1 Execution 骨架：TypeScript + ElizaOS Core
- L2 Orchestration：Telegram 按钮驱动任务下发到 WhatsApp
- Triple-View：Boss / Expert / Buyer 三视角自动反馈
- L4 Trust：证据自动上链到 0G（或降级为 pending_storage）
- Persistence Layer：每 5 分钟自动扫描 pending_storage 并补传

## 技术栈

- Node.js 20+
- TypeScript
- Telegraf
- whatsapp-web.js
- @0glabs/0g-ts-sdk
- ethers
- zod

## 快速开始

```bash
npm install
npm run dev
```

生产构建运行：

```bash
npm run build
npm start
```

## 环境变量

先复制示例配置：

```bash
cp .env.example .env
```

在项目根目录创建 `.env`（或通过系统环境变量注入）：

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOSS_CHAT_ID=

WA_ENABLED=true
WA_AGENT_CHAT_ID=971000000000@c.us

ZERO_G_INDEXER_RPC=
ZERO_G_EVM_RPC=
ZERO_G_PRIVATE_KEY=
```

说明：

- `TELEGRAM_BOT_TOKEN`：Telegram Bot Token
- `TELEGRAM_BOSS_CHAT_ID`：老板接收三视角通知的 chat id
- `WA_ENABLED`：是否启用 WhatsApp 客户端
- `WA_AGENT_CHAT_ID`：代理人 WhatsApp chat id
- `ZERO_G_*`：0G 真正上链所需参数；未配置时使用本地可验证哈希路径

## 交互流程

1. 老板在 Telegram 发送 `/start`
2. 选择国家
3. 选择任务动作：`核真 / 采样 / 认证`
4. 系统自动将带 `Ref: [TaskID]` 的英文指令下发到代理人 WhatsApp
5. 代理人回传图片消息后，系统自动解析 TaskID 并触发存证流程
6. 三视角报告自动回推 Telegram（带“查看 0G 浏览器证据”按钮）

## 手动证据触发

如需手动触发（测试）：

```text
/evidence <TaskID>
```

## 可靠性重试队列

- 当 0G 节点暂时不可用时，任务会标记为 `pending_storage`
- 待处理队列会写入根目录 `pending_tasks.json`
- 系统每 5 分钟自动重试补传
- 补传成功后任务状态升级为 `completed`
- 自动发送二次通知：
  - `🔔 任务 [TaskID] 的存证已正式在 0G 链上锁定成功。原哈希已生效。`

## 关键目录

```text
src/
  agents/persona/          商务人格
  schema/Task.ts           三视角任务模型
  services/bridge/         任务中枢与调度
  services/vault/          0G 存证逻辑
```

## 常见问题

- WhatsApp 首次运行需要扫码登录
- 若未设置 `TELEGRAM_BOSS_CHAT_ID`，系统会跳过老板端主动推送并打印告警日志
- 若出现 `pending_storage`，请检查 0G RPC 与私钥配置

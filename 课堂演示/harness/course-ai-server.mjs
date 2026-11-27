#!/usr/bin/env node
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  COURSE_HOTSPOTS,
  COURSE_PAGES,
  DESK_OBJECTS,
  archivePromptBlock,
  filterVerifiedSources,
  sanitizeDirectorActions,
} from './archive-knowledge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4318;
const HOST = '127.0.0.1';
export const DEV_GRANT_TTL = 30000;
export const DEV_REQUEST_ID = /^[a-f0-9]{32}$/;

export function signDeveloperGrant(accessToken, nonce, expiresAt) {
  return createHmac('sha256', accessToken).update(`dev-attach:v1:${nonce}:${expiresAt}`).digest('base64url');
}

export function loadLocalConfig(configPath = path.join(HERE, 'course-ai.config.json')) {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveCourseAIConfig(options = {}) {
  const file = loadLocalConfig(options.configPath);
  const envBase = process.env.COURSE_AI_BASE_URL;
  const baseUrl = options.baseUrl || envBase || file.baseUrl;
  const envKey = !options.baseUrl || options.baseUrl === envBase ? process.env.COURSE_AI_API_KEY : undefined;
  const apiKey = options.apiKey ?? envKey ?? (baseUrl === file.baseUrl ? file.apiKey : undefined);
  return {
    baseUrl,
    apiKey,
    model: options.model || process.env.COURSE_AI_MODEL || file.model,
    disableThinking: options.disableThinking ?? (baseUrl === file.baseUrl && file.disableThinking === true),
    jsonSchemaOutput: options.jsonSchemaOutput ?? (baseUrl === file.baseUrl && file.jsonSchemaOutput === true),
    port: Number(options.port ?? process.env.COURSE_AI_PORT ?? file.port ?? DEFAULT_PORT),
    accessToken: apiKey ? createHmac('sha256', apiKey).update('long-march-course/local-gateway').digest('base64url') : '',
  };
}

function readJsonBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 格式无效'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function modelError(statusCode, upstreamCode, message) {
  return Object.assign(new Error(message), { statusCode, upstreamCode });
}

function upstreamError(message, status = 502) {
  if (status === 429 || /free usage exceeded|rate limit|quota exceeded/i.test(message)) {
    return modelError(429, 'MODEL_QUOTA', '当前 AI 服务额度已用完或请求过于频繁。可稍后重试，或切换到有可用额度的模型。');
  }
  if (status === 401 || status === 403 || /not available in your country|authentication|invalid api key|subscription ended/i.test(message)) {
    return modelError(502, 'MODEL_ACCESS', '当前 AI 模型无法访问。请检查模型权限、服务凭据或接入配置。');
  }
  return modelError(502, 'MODEL_ERROR', 'AI 服务暂时无法生成结果，请重试或检查模型连接。');
}

function validateModelOutput(value, schema) {
  if (schema.type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && (schema.required ?? []).every(key => Object.hasOwn(value, key))
      && Object.entries(schema.properties).every(([key, field]) =>
        !Object.hasOwn(value, key) || validateModelOutput(value[key], field));
  }
  if (schema.type === 'array') {
    return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
      && value.every(item => validateModelOutput(item, schema.items));
  }
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return Number.isFinite(value);
}

const DIRECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narration', 'actions', 'citedSourceIds'],
  properties: {
    narration: { type: 'string', description: '不超过55字的极简纪录片风格口述串联，禁止官话套话' },
    actions: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['navigate_page', 'focus_hotspot', 'compare_liping_routes', 'open_archive', 'open_desk_object', 'open_review'] },
          pageTitle: { type: 'string' },
          key: { type: 'string' },
          side: { type: 'string', enum: ['east', 'west', 'both'] },
          archiveId: { type: 'string' },
          object: { type: 'string', enum: DESK_OBJECTS },
          conclusion: { type: 'boolean' },
        },
        required: ['type'],
      },
    },
    citedSourceIds: { type: 'array', items: { type: 'string' } },
  },
};

const SANDBOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['trajectory', 'riskLevel', 'chokeLabel', 'telegramTitle', 'battlefieldOutcome', 'historicalContrast', 'citedSourceIds'],
  properties: {
    trajectory: { type: 'string', enum: ['north-blocked', 'west-breakthrough', 'split-flank', 'delay-exposed'] },
    riskLevel: { type: 'string', enum: ['critical', 'high', 'viable'] },
    chokeLabel: { type: 'string', description: '受阻或关键地形节点短标签，4-10字' },
    telegramTitle: { type: 'string', description: '1934 战地推演密电标题，8-18字' },
    battlefieldOutcome: { type: 'string', description: '基于1934年敌我兵力与地形约束推演的战场后果，50-110字' },
    historicalContrast: { type: 'string', description: '与黎平会议真实决策的对照与启示，40-90字' },
    citedSourceIds: { type: 'array', items: { type: 'string' } },
  },
};

const ZUNYI_DEBATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stage', 'verdictTitle', 'message', 'followUpPrompt', 'accepted', 'highlightDeskObject', 'dawnProgress', 'citedSourceIds'],
  properties: {
    stage: { type: 'string', enum: ['challenge', 'rebuttal'] },
    verdictTitle: { type: 'string', description: '6-14字标题' },
    message: { type: 'string', description: '质询陈词或基于桌上真实卷宗的回应，45-110字' },
    followUpPrompt: { type: 'string', description: '引导下一轮查证或结语的简短提示，18-45字' },
    accepted: { type: 'boolean' },
    highlightDeskObject: { type: 'string', enum: ['journal', 'dossier', 'map', 'both'] },
    dawnProgress: { type: 'number', minimum: 0, maximum: 1 },
    citedSourceIds: { type: 'array', items: { type: 'string' } },
  },
};

const RECAP_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'subtitle', 'executiveSummary', 'journeyHighlights', 'decisionComparison', 'gridMapping', 'discussionQuestions', 'citedSourceIds'],
  properties: {
    title: { type: 'string', description: '简报标题，20 字以内' },
    subtitle: { type: 'string', description: '标注岗位，20 字以内' },
    executiveSummary: { type: 'string', description: '课堂摘要，最多 80 字' },
    journeyHighlights: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    decisionComparison: { type: 'string', description: '历史抉择对照，最多 70 字' },
    gridMapping: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'principle', 'action'],
        properties: {
          topic: { type: 'string', description: '场景短标题，12 字以内' },
          principle: { type: 'string', description: '提炼方法，最多 30 字' },
          action: { type: 'string', description: '岗位应用，最多 45 字' },
        },
      },
    },
    discussionQuestions: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
    citedSourceIds: { type: 'array', items: { type: 'string' } },
  },
};

const TRAJECTORY_VECTORS = {
  'north-blocked': {
    mapPath: [[50, 84], [64, 70], [76, 46], [82, 26]],
    chokePoint: { x: 78, y: 36 },
  },
  'split-flank': {
    mapPath: [[50, 84], [58, 66], [68, 52], [46, 40], [32, 30]],
    chokePoint: { x: 64, y: 50 },
  },
  'delay-exposed': {
    mapPath: [[50, 84], [52, 74], [58, 64], [55, 52]],
    chokePoint: { x: 56, y: 58 },
  },
  'west-breakthrough': {
    mapPath: [[50, 84], [38, 72], [28, 50], [19, 26]],
    chokePoint: { x: 25, y: 38 },
  },
};

async function createModelClient({ baseUrl, apiKey, model, disableThinking, jsonSchemaOutput }) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('模型地址应为纯 HTTP(S) 兼容 API 地址。');
  }
  const baseURL = url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const [{ generateText, Output, jsonSchema, APICallError, NoObjectGeneratedError }, { createOpenAICompatible }] =
    await Promise.all([import('ai'), import('@ai-sdk/openai-compatible')]);
  const provider = createOpenAICompatible({
    name: 'course-endpoint',
    baseURL,
    apiKey,
    supportsStructuredOutputs: jsonSchemaOutput,
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
    ...(disableThinking && { transformRequestBody: body => ({ ...body, thinking: { type: 'disabled' } }) }),
  });
  const languageModel = provider.chatModel(model);

  return {
    engineName: 'vercel-ai-sdk',
    model,
    async invokeStructured({ system, prompt, schema, requestSignal }) {
      const isReport = schema === RECAP_REPORT_SCHEMA;
      const timeout = AbortSignal.timeout(isReport ? 55000 : 35000);
      try {
        const result = await generateText({
          model: languageModel,
          system: `${system}\n\n只返回一个符合以下 JSON Schema 的 JSON 对象，包含所有必填字段。不要加 Markdown 或额外说明。\n${JSON.stringify(schema)}`,
          prompt,
          output: jsonSchemaOutput ? Output.object({ schema: jsonSchema(schema) }) : Output.json(),
          temperature: 0.25,
          maxOutputTokens: isReport ? 3000 : 1600,
          maxRetries: 0,
          abortSignal: requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout,
        });
        return result.output;
      } catch (error) {
        if (timeout.aborted) throw modelError(504, 'MODEL_TIMEOUT', 'AI 响应超时，请重试。');
        if (NoObjectGeneratedError.isInstance(error)) {
          throw modelError(502, 'MODEL_FORMAT', 'AI 返回的结果格式不完整，请重新提交。');
        }
        if (APICallError.isInstance(error)) throw upstreamError(error.message, error.statusCode);
        throw upstreamError('');
      }
    },
  };
}

// 模拟结果仅由专项验收显式启用。
function createMockModelClient() {
  return {
    engineName: 'course-ai-mock',
    model: 'mock-harness-verifier',
    async invokeStructured({ kind, body }) {
      if (kind === 'director') {
        const u = String(body.utterance || '');
        if (/黎平|路线|贵州|湘西北/.test(u)) {
          return {
            narration: '已切入黎平进军方向，对照湘西北原计划与改向黔北的真实态势。',
            actions: [
              { type: 'navigate_page', pageTitle: '进军方向' },
              { type: 'compare_liping_routes', side: 'both' },
            ],
            citedSourceIds: ['src-liping-turn'],
          };
        }
        if (/兵力|湘江|八万六|三万/.test(u)) {
          return {
            narration: '已切到湘江留下的启示并调出兵力记录，核对出发与渡江后的全程累计口径。',
            actions: [
              { type: 'navigate_page', pageTitle: '湘江留下的启示' },
              { type: 'open_archive', archiveId: 'troop-records' },
            ],
            citedSourceIds: ['src-xiang-troops'],
          };
        }
        if (/浮桥|门板|木船|于都/.test(u)) {
          return {
            narration: '已切入于都浮桥近景并标出承托船体，查看群众门板与木船的协同分工。',
            actions: [
              { type: 'navigate_page', pageTitle: '浮桥近景' },
              { type: 'focus_hotspot', key: 'boat' },
            ],
            citedSourceIds: ['src-yudu-bridge'],
          };
        }
        return {
          narration: '已定位遵义会议桌实景，可结合桌上两册原始材料核查转折依据。',
          actions: [{ type: 'open_desk_object', object: 'dossier' }],
          citedSourceIds: ['src-zunyi-resolution'],
        };
      }
      if (kind === 'sandbox') {
        const proposal = String(body.proposal || '');
        const goWest = /贵州|黔北|西进|遵义|薄弱/.test(proposal) && !/北上|湘西北|强攻/.test(proposal);
        return goWest ? {
          trajectory: 'west-breakthrough',
          riskLevel: 'viable',
          chokeLabel: '黔北敌军薄弱部',
          telegramTitle: '1934.12 黎平西进态势推演',
          battlefieldOutcome: '放弃硬闯湘西北口袋阵、转入敌军兵力空虚的黔北，主力避开重兵合围，为强渡乌江和遵义休整赢得战略窗口。',
          historicalContrast: '与黎平会议真实抉择一致：在减员过半的硬约束下，立足现实及时转轨才能保住主力并重夺主动。',
          citedSourceIds: ['src-liping-turn', 'src-houchang-wujiang'],
        } : {
          trajectory: 'north-blocked',
          riskLevel: 'critical',
          chokeLabel: '湘西北重兵口袋阵',
          telegramTitle: '1934.12 强闯湘西北风险推演',
          battlefieldOutcome: '若以渡江后仅余的 3 万余疲惫之师强攻湘西北既定方向，正撞敌军预先部署的纵深口袋阵，极易在抵达会合点前陷入重围与补给断绝。',
          historicalContrast: '历史上黎平会议正是直面这一敌我硬约束，果断放弃原定北上计划，改向敌军防备薄弱的贵州北部。',
          citedSourceIds: ['src-xiang-troops', 'src-liping-turn'],
        };
      }
      if (kind === 'zunyi-debate') {
        if (body.stage === 'challenge') {
          return {
            stage: 'challenge',
            verdictTitle: '1935 会场质询 · 为何动组织',
            message: '黎平会议已经把行军方向改到了贵州北部，为什么遵义会议还要反复追查第五次反“围剿”的旧账，甚至必须取消原“三人团”、调整中央领导机构？',
            followUpPrompt: '请结合桌上两册卷宗中的真实史实作出回应。',
            accepted: false,
            highlightDeskObject: 'both',
            dawnProgress: 0.25,
            citedSourceIds: ['src-zunyi-resolution'],
          };
        }
        const arg = String(body.argument || '');
        const hit = /军事|组织|指挥|三人团|常委|毛泽东|机制|教条|第五次|保障|落地/.test(arg);
        return hit ? {
          stage: 'rebuttal',
          verdictTitle: '持证回应成立 · 机制保落地',
          message: '依据桌上两册档案：只改一次行军路线治标不治本；不纠正脱离实际的军事指挥原则、不调整最高领导机构，正确主张就无法在后续作战中持续执行。',
          followUpPrompt: '桌上两册材料已形成闭环，可推进至「军事问题」「组织问题」继续复盘。',
          accepted: true,
          highlightDeskObject: 'dossier',
          dawnProgress: 1,
          citedSourceIds: ['src-zunyi-resolution'],
        } : {
          stage: 'rebuttal',
          verdictTitle: '证据尚不充分 · 请回看右册',
          message: '这一回应尚未点出遵义会议同时解决“军事原则纠偏”与“领导机构改组”的因果联系，建议对照右册会议讨论记录补充依据。',
          followUpPrompt: '翻看右册「会议讨论」，说明为什么改方向之后还必须调整领导机构。',
          accepted: false,
          highlightDeskObject: 'dossier',
          dawnProgress: 0.45,
          citedSourceIds: ['src-zunyi-resolution'],
        };
      }
      const roleTrack = String(body.roleTrack || '电力调度与一线运维');
      return {
        title: `《从于都到遵义》实训复盘简报 · ${roleTrack}`,
        subtitle: '基于本场真实三维查证、黎平沙盘推演与遵义持证辩论轨迹生成',
        executiveSummary: `本场围绕「${roleTrack}」一线骨干的真实决策情境，贯穿于都应急协同、湘江数据口径核查、黎平沙盘转轨推演与遵义机制纠偏四站，形成从“现场实情判断”到“组织机制落地”的闭环复盘。`,
        journeyHighlights: [
          '于都河岸：拆解群众门板与木船承托的应急工程分工，核对拂晓撤桥的隐蔽约束。',
          '湘江战役：区分出发时 8.6 万余人与渡江后 3 万余人的全程累计口径，拒绝失真归因。',
          '黎平沙盘与遵义会议桌：完成反事实路线风险推演，并结合两册原始卷宗完成 1935 会场持证回应。',
        ],
        decisionComparison: '历史转折的真正门槛，不在“口头上承认困难”，而在面对既定方案与现场实情严重冲突时，敢于用一手依据叫停旧路径，并用领导与协作机制保障新方案执行到底。',
        gridMapping: [
          {
            topic: '迎峰度夏与应急抢修协同',
            principle: '于都浮桥：盘活一线最小单元资源补齐工程短板',
            action: '建立跨专业物料与抢修力量清单，明确突发故障下的快速拼装与撤场验收节点。',
          },
          {
            topic: '调度指标与故障复盘口径',
            principle: '湘江核数：严格区分单点事件损耗与全程累计影响',
            action: '复盘故障时先锁定时间锚点与上游诱因，避免用单一断面指标掩盖系统性隐患。',
          },
          {
            topic: '既有预案失效时的临机转轨',
            principle: '黎平转轨 + 遵义改组：及时换路并用授权机制兜底',
            action: '现场工况突破预案边界时，按分级授权果断切换保电方案，并将有效做法固化进班组制度。',
          },
        ],
        discussionQuestions: [
          `结合「${roleTrack}」近一年最棘手的一次现场处置，哪一步最像“黎平转轨”？当时什么证据说服团队放弃了原方案？`,
          '如果团队已经发现某种常规做法脱离一线实际，需要改哪一项审批或协同机制才能真正落地？',
        ],
        citedSourceIds: ['src-yudu-bridge', 'src-xiang-troops', 'src-liping-turn', 'src-zunyi-resolution'],
      };
    },
  };
}

export async function createCourseHarnessServer(options = {}) {
  const config = resolveCourseAIConfig(options);
  const { port } = config;
  const mockMode = Boolean(options.mockHarness);
  if (!mockMode && (!config.baseUrl || !config.model)) {
    throw new Error('请在 course-ai.config.json 或环境变量中配置模型地址和模型 ID。');
  }
  const client = mockMode ? createMockModelClient() : await createModelClient(config);
  const localAuthorization = Buffer.from(config.accessToken ? `Bearer ${config.accessToken}` : '');
  const usedDeveloperGrants = new Map();

  const baseSystemGuard = [
    '你是《从于都到遵义》沉浸式 VR 党课的 AI 助教，面向 30 岁左右的国网电力一线骨干。',
    '核心原则：史实严谨、语言克制有力（电影纪录片质感）、禁止官话套话与空洞说教、严禁编造档案编号。',
    '所有史实论断与 citedSourceIds 必须严格来自以下权威事实库：',
    archivePromptBlock(),
  ].join('\n\n');

  async function invokeCourse(request) {
    const result = await client.invokeStructured(request);
    if (request.schema === DIRECTOR_SCHEMA && Array.isArray(result?.actions)) {
      result.actions = sanitizeDirectorActions(result.actions);
    }
    if (!validateModelOutput(result, request.schema)) {
      throw modelError(502, 'MODEL_FORMAT', 'AI 返回的结果格式不完整，请重新提交。');
    }
    return result;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${HOST}`);
    const request = new AbortController();
    res.once('close', () => { if (!res.writableEnded) request.abort(); });
    try {
      if (req.method === 'GET' && url.pathname === '/api/course-ai/health') {
        sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          engine: client.engineName,
          model: client.model,
          capabilities: ['director', 'sandbox', 'zunyi-debate', 'recap-report'],
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/course-ai/dev/attach') {
        const { nonce, expiresAt, proof } = await readJsonBody(req) ?? {};
        const now = Date.now();
        for (const [id, expiration] of usedDeveloperGrants) {
          if (expiration <= now) usedDeveloperGrants.delete(id);
        }
        if (!config.accessToken || typeof nonce !== 'string' || !DEV_REQUEST_ID.test(nonce)
          || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + DEV_GRANT_TTL
          || typeof proof !== 'string' || !/^[\w-]{43}$/.test(proof)
          || usedDeveloperGrants.has(nonce)
          || !timingSafeEqual(Buffer.from(proof), Buffer.from(signDeveloperGrant(config.accessToken, nonce, expiresAt)))) {
          sendJson(res, 401, { ok: false, code: 'DEV_GRANT_INVALID' });
          return;
        }
        usedDeveloperGrants.set(nonce, expiresAt);
        sendJson(res, 200, { ok: true, accessToken: config.accessToken });
        return;
      }

      if (req.method === 'POST' && !mockMode && localAuthorization.length) {
        const received = Buffer.from(req.headers.authorization || '');
        if (received.length !== localAuthorization.length || !timingSafeEqual(received, localAuthorization)) {
          sendJson(res, 401, { ok: false, code: 'GATEWAY_ACCESS', message: '请从一键开课入口进入课堂后重试。' });
          return;
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/course-ai/director') {
        const body = await readJsonBody(req);
        const utterance = String(body.utterance || '').trim().slice(0, 240);
        if (!utterance) { sendJson(res, 400, { ok: false, message: '请输入语音或教学指令' }); return; }
        const raw = mockMode
          ? await client.invokeStructured({ kind: 'director', body })
          : await invokeCourse({
              requestSignal: request.signal,
              system: [
                baseSystemGuard,
                '你的角色是【AI 实景副导】：把讲师或学员的口令转化为精确的课件画面控制动作，并配不超过 55 字的纪实串联语。',
                `可用课页标题白名单：${COURSE_PAGES.join('、')}`,
                `可用热点白名单：${COURSE_HOTSPOTS.join('、')}`,
                '可用弹窗档案白名单：troop-records（湘江兵力记录）',
                '动作的参数必须与类型匹配：navigate_page 带 pageTitle，focus_hotspot 带 key，compare_liping_routes 带 side（east、west 或 both），open_archive 带 archiveId。',
                '打开遵义会议桌材料时用 open_desk_object，object 为 journal（左册）、dossier（右册）或 map（路线图）。',
                '如需对照黎平路线，先 navigate_page 到「进军方向」再执行 compare_liping_routes。',
                '指令含糊或超出课堂范围时，返回空 actions，并用一句话提示可查看的内容。',
              ].join('\n'),
              prompt: `当前页面：${body.currentPageTitle || '地图首页'}；已查证线索：${(body.revealedKeys || []).join('、') || '暂无'}。\n讲师/学员口令：${utterance}`,
              schema: DIRECTOR_SCHEMA,
            });
        const actions = mockMode ? sanitizeDirectorActions(raw.actions) : raw.actions;
        sendJson(res, 200, {
          ok: true,
          narration: String(raw.narration || '').trim().slice(0, 90),
          actions,
          citedSources: filterVerifiedSources(raw.citedSourceIds),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/course-ai/sandbox') {
        const body = await readJsonBody(req);
        const proposal = String(body.proposal || '').trim().slice(0, 280);
        if (!proposal) { sendJson(res, 400, { ok: false, message: '请输入推演方案' }); return; }
        const raw = mockMode
          ? await client.invokeStructured({ kind: 'sandbox', body })
          : await invokeCourse({
              requestSignal: request.signal,
              system: [
                baseSystemGuard,
                '你的角色是【1934 战地推演参谋】：根据学员提出的假设方案，结合 1934 年 12 月黎平会议前后的敌我真实兵力与湘西北口袋阵约束，进行严谨的反事实推演。',
                '重要护栏：必须明确标明这是假设推演，绝不篡改党史，最后必须收束到黎平会议放弃湘西北、改向贵州北部的历史真实抉择。',
              ].join('\n'),
              prompt: `推演战区：黎平会议（1934年12月，中央红军渡过湘江后仅余3万余人，国民党军在湘西北重兵堵截，黔北敌军相对薄弱）。\n学员假设方案：${proposal}`,
              schema: SANDBOX_SCHEMA,
            });
        const trajectory = Object.hasOwn(TRAJECTORY_VECTORS, raw.trajectory) ? raw.trajectory : 'north-blocked';
        const vec = TRAJECTORY_VECTORS[trajectory];
        sendJson(res, 200, {
          ok: true,
          hypothesisTag: '假设推演 · 非真实史实',
          trajectory,
          riskLevel: ['critical', 'high', 'viable'].includes(raw.riskLevel) ? raw.riskLevel : 'high',
          mapPath: vec.mapPath,
          chokePoint: { ...vec.chokePoint, label: String(raw.chokeLabel || '敌军阻击区').slice(0, 14) },
          telegramTitle: String(raw.telegramTitle || '1934.12 黎平态势推演').slice(0, 28),
          battlefieldOutcome: String(raw.battlefieldOutcome || '').trim().slice(0, 220),
          historicalContrast: String(raw.historicalContrast || '').trim().slice(0, 200),
          citedSources: filterVerifiedSources(raw.citedSourceIds),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/course-ai/zunyi-debate') {
        const body = await readJsonBody(req);
        const stage = body.stage === 'rebuttal' ? 'rebuttal' : 'challenge';
        const seen = Array.isArray(body.seenObjects) ? DESK_OBJECTS.filter(x => body.seenObjects.includes(x)) : [];
        const question = String(body.question || '').trim().slice(0, 240);
        const argument = String(body.argument || '').trim().slice(0, 320);
        if (stage === 'rebuttal' && !argument) {
          sendJson(res, 400, { ok: false, message: '请输入结合卷宗的回应观点' });
          return;
        }
        const raw = mockMode
          ? await client.invokeStructured({ kind: 'zunyi-debate', body: { stage, seenObjects: seen, argument } })
          : await invokeCourse({
              requestSignal: request.signal,
              system: [
                baseSystemGuard,
                '你的角色是【1935 遵义会场历史质询员】：严格基于桌上两册材料（左册会前形势、右册会议讨论）与《遵义会议决议》史实展开持证辩论。',
                '- 当 stage=challenge 时，扮演当年存在疑虑的与会代表视角，提出一个尖锐且符合历史语境的追问。',
                '- 当 stage=rebuttal 时，严格核验学员回应是否基于史料点出“军事指挥纠偏”与“领导机构组织保障”的必然联系；若成立，accepted=true 且 dawnProgress=1；若论据单薄，accepted=false 并指出应回看桌上哪一册卷宗。',
              ].join('\n'),
              prompt: stage === 'challenge'
                ? `学员在 3D 会议桌上已查阅物件：${seen.join('、') || '刚刚入座'}。请发起第一轮 1935 会场质询。`
                : `本轮质询：${question || '军事纠偏与组织调整如何共同起作用？'}\n已查阅物件：${seen.join('、') || '尚未查阅'}。\n学员回应论据：${argument}\n请基于权威史料核验并给出回应。`,
              schema: ZUNYI_DEBATE_SCHEMA,
            });
        sendJson(res, 200, {
          ok: true,
          stage,
          verdictTitle: String(raw.verdictTitle || (stage === 'challenge' ? '1935 会场质询' : '史料核验结果')).slice(0, 24),
          message: String(raw.message || '').trim().slice(0, 240),
          followUpPrompt: String(raw.followUpPrompt || '').trim().slice(0, 90),
          accepted: stage === 'rebuttal' && raw.accepted,
          highlightDeskObject: ['journal', 'dossier', 'map', 'both'].includes(raw.highlightDeskObject) ? raw.highlightDeskObject : 'dossier',
          dawnProgress: stage === 'rebuttal' && raw.accepted ? 1 : 0,
          citedSources: filterVerifiedSources(raw.citedSourceIds),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/course-ai/recap-report') {
        const body = await readJsonBody(req);
        const roleTrack = String(body.roleTrack || '电力调度与一线运维').trim().slice(0, 40);
        const teamChallenge = String(body.teamChallenge || '').trim().slice(0, 180);
        const trace = body.trace && typeof body.trace === 'object' ? body.trace : {};
        const recent = key => Array.isArray(trace[key]) ? trace[key].slice(-4) : [];
        const summary = {
          visitedPages: Array.isArray(trace.visitedPages) ? COURSE_PAGES.filter(page => trace.visitedPages.includes(page)) : [],
          directorRuns: recent('directorRuns').map(x => String(x?.utterance ?? '').slice(0, 100)),
          sandboxRuns: recent('sandboxRuns').map(x => ({
            proposal: String(x?.proposal ?? '').slice(0, 100),
            result: String(x?.telegramTitle ?? '').slice(0, 30),
          })),
          zunyiDebates: recent('zunyiDebates').map(x => ({
            argument: String(x?.argument ?? '').slice(0, 110),
            accepted: x?.accepted === true,
          })),
          revealedCount: Number.isInteger(trace.revealedCount) ? trace.revealedCount : 0,
          completedPractices: recent('completedPractices').map(x => String(x).slice(0, 40)),
        };
        const raw = mockMode
          ? await client.invokeStructured({ kind: 'recap-report', body: { roleTrack, teamChallenge, trace } })
          : await invokeCourse({
              requestSignal: request.signal,
              system: [
                baseSystemGuard,
                '你的角色是【党课数字化实训复盘架构师】：根据本场真实课堂交互轨迹和学员所属的国网电力岗位，生成一份去官话、重决策方法论、可归档的《实训复盘简报》。',
                '只描述轨迹中实际发生的活动，不补写学员没有完成的操作。没有记录时，journeyHighlights 可以为空。',
                '简报供课尾快速阅读。最多三条课堂记录，每条不超过 35 字。生成两张岗位映射卡和两道研讨题，每道题不超过 30 字。避免同一史实在各栏重复展开。',
              ].join('\n'),
              prompt: [
                `学员岗位方向：${roleTrack}`,
                teamChallenge ? `班组真实业务困惑：${teamChallenge}` : '',
                `本场真实课堂轨迹 JSON：${JSON.stringify(summary)}`,
              ].filter(Boolean).join('\n'),
              schema: RECAP_REPORT_SCHEMA,
            });
        sendJson(res, 200, {
          ok: true,
          report: {
            title: String(raw.title || `《从于都到遵义》实训复盘简报 · ${roleTrack}`).slice(0, 60),
            subtitle: String(raw.subtitle || '本场沉浸式党课数字化实训归档').slice(0, 80),
            executiveSummary: String(raw.executiveSummary || '').trim().slice(0, 320),
            journeyHighlights: Array.isArray(raw.journeyHighlights) ? raw.journeyHighlights.map(x => String(x).slice(0, 120)).slice(0, 5) : [],
            decisionComparison: String(raw.decisionComparison || '').trim().slice(0, 260),
            gridMapping: Array.isArray(raw.gridMapping) ? raw.gridMapping.slice(0, 4).map(item => ({
              topic: String(item?.topic || '').slice(0, 40),
              principle: String(item?.principle || '').slice(0, 80),
              action: String(item?.action || '').slice(0, 140),
            })) : [],
            discussionQuestions: Array.isArray(raw.discussionQuestions) ? raw.discussionQuestions.map(x => String(x).slice(0, 120)).slice(0, 3) : [],
            citedSources: filterVerifiedSources(raw.citedSourceIds),
          },
        });
        return;
      }

      sendJson(res, 404, { ok: false, message: '未知接口路径' });
    } catch (err) {
      const code = Number(err?.statusCode) || 500;
      if (request.signal.aborted) return;
      sendJson(res, code, {
        ok: false,
        code: err?.upstreamCode || 'HARNESS_ERROR',
        message: err?.message || '课堂 AI 服务处理失败',
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: actualPort,
    url: `http://${HOST}:${actualPort}`,
    engine: client.engineName,
    model: client.model,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

const isDirectEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectEntry) {
  const argv = process.argv.slice(2);
  const flag = name => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const port = flag('--port') ? Number(flag('--port')) : undefined;
  const model = flag('--model');
  const baseUrl = flag('--base-url');
  const mockHarness = argv.includes('--mock-harness');

  const running = await createCourseHarnessServer({ port, model, baseUrl, mockHarness });
  console.log(`[课堂 AI 网关] 已启动：${running.url} (${running.engine})`);
  console.log(`[课堂 AI 网关] 当前模型：${running.model}`);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      await running.close();
      process.exit(0);
    });
  }
}

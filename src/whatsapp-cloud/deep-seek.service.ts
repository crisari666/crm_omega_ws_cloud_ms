import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { COMPANY_PUBLIC_CONTACT_INFO } from '../constants/app-constants';
import { LotesChatDuplicateInboundSuppression } from './interfaces/lotes-chat-duplicate-inbound-suppression.interface';
import { ProjectResponse } from './interfaces/project-config.interface';
import { buildCompanyInformationToolResponse } from './utils/build-company-information-tool-response.util';

type LotesChatConfigFunctionJson = {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

type LotesChatConfigShape = {
  agent?: {
    think?: { prompt?: string; functions?: ReadonlyArray<LotesChatConfigFunctionJson> };
    duplicateInboundSuppression?: {
      enabled?: boolean;
      windowSeconds?: number;
      minTextLength?: number;
    };
  };
};

const DEFAULT_LOTE_CHAT_CONFIG_PATH = 'config_lotes_chat.json';
const DEFAULT_DUPLICATE_SUPPRESSION_WINDOW_SECONDS = 3600;
const DEFAULT_DUPLICATE_SUPPRESSION_MIN_TEXT_LENGTH = 3;
const LOTES_CHAT_TOOL_ROUNDS_MAX = 6;

@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private openaiClient: OpenAI | null = null;
  private cachedLotesSystemPrompt: string | null = null;
  private cachedLotesChatConfig: LotesChatConfigShape | null = null;

  public constructor(private readonly configService: ConfigService) {}

  /**
   * OpenAI-compatible client for DeepSeek (lazy; requires DEEPSEEK_API_KEY).
   */
  private getOpenai(): OpenAI {
    if (this.openaiClient != null) {
      return this.openaiClient;
    }
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (apiKey == null || apiKey.trim().length === 0) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    this.openaiClient = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey.trim(),
    });
    this.logger.log('DeepSeek OpenAI client initialized');
    return this.openaiClient;
  }

  /**
   * Parsed `config_lotes_chat.json` (cached). Path override: LOTE_CHAT_CONFIG_PATH.
   */
  private loadLotesChatConfig(): LotesChatConfigShape {
    if (this.cachedLotesChatConfig != null) {
      return this.cachedLotesChatConfig;
    }
    const configuredPath =
      this.configService.get<string>('LOTE_CHAT_CONFIG_PATH') ?? DEFAULT_LOTE_CHAT_CONFIG_PATH;
    const resolvedPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    this.cachedLotesChatConfig = JSON.parse(raw) as LotesChatConfigShape;
    return this.cachedLotesChatConfig;
  }

  /**
   * System prompt from `config_lotes_chat.json` (agent.think.prompt). Path override: LOTE_CHAT_CONFIG_PATH.
   */
  public getLotesChatSystemPrompt(): string {
    if (this.cachedLotesSystemPrompt != null) {
      return this.cachedLotesSystemPrompt;
    }
    const parsed = this.loadLotesChatConfig();
    const prompt = parsed.agent?.think?.prompt;
    if (prompt == null || prompt.trim().length === 0) {
      const configuredPath =
        this.configService.get<string>('LOTE_CHAT_CONFIG_PATH') ?? DEFAULT_LOTE_CHAT_CONFIG_PATH;
      const resolvedPath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(process.cwd(), configuredPath);
      throw new Error(`Missing agent.think.prompt in ${resolvedPath}`);
    }
    this.cachedLotesSystemPrompt = prompt;
    return prompt;
  }

  /**
   * Duplicate inbound suppression from `config_lotes_chat.json` (agent.duplicateInboundSuppression).
   */
  public getLotesChatDuplicateInboundSuppression(): LotesChatDuplicateInboundSuppression {
    const parsed = this.loadLotesChatConfig();
    const raw = parsed.agent?.duplicateInboundSuppression;
    const enabled = raw?.enabled === true;
    const windowSeconds =
      typeof raw?.windowSeconds === 'number' && raw.windowSeconds > 0
        ? raw.windowSeconds
        : DEFAULT_DUPLICATE_SUPPRESSION_WINDOW_SECONDS;
    const minTextLength =
      typeof raw?.minTextLength === 'number' && raw.minTextLength >= 1
        ? raw.minTextLength
        : DEFAULT_DUPLICATE_SUPPRESSION_MIN_TEXT_LENGTH;
    return { enabled, windowSeconds, minTextLength };
  }

  /**
   * OpenAI-style tool definitions from `config_lotes_chat.json` (agent.think.functions).
   */
  private getLotesChatToolDefinitions(): ChatCompletionTool[] {
    const parsed = this.loadLotesChatConfig();
    const raw = parsed.agent?.think?.functions;
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    const tools: ChatCompletionTool[] = [];
    for (const item of raw) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (name.length === 0) {
        continue;
      }
      const description = typeof item.description === 'string' ? item.description : '';
      const parameters =
        item.parameters != null && typeof item.parameters === 'object' && !Array.isArray(item.parameters)
          ? item.parameters
          : { type: 'object', properties: {} };
      tools.push({
        type: 'function',
        function: {
          name,
          description: description.length > 0 ? description : undefined,
          parameters: parameters as Record<string, unknown>,
        },
      });
    }
    return tools;
  }

  /**
   * La Ceiba WhatsApp-style reply using DeepSeek; optional multi-turn {@link input.conversation} from stored messages.
   * When the config defines `functions`, runs tool rounds (e.g. {@link buildCompanyInformationToolResponse}).
   */
  public async replyLotesChat(input: {
    userMessage: string;
    contactName?: string;
    conversation?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    model?: string;
  }): Promise<string> {
    const system = this.getLotesChatSystemPrompt();
    const nameHint =
      input.contactName != null && input.contactName.trim().length > 0
        ? `\n\n(Contexto: el nombre del contacto es ${input.contactName.trim()}.)`
        : '';
    const systemPrompt = system + nameHint;
    const trimmedUser = input.userMessage.trim();
    const convo = input.conversation;
    const tools = this.getLotesChatToolDefinitions();
    if (tools.length > 0) {
      return this.replyLotesChatWithTools({
        systemPrompt,
        trimmedUser,
        conversation: convo,
        tools,
        model: input.model ?? 'deepseek-chat',
        contactName: input.contactName,
      });
    }
    if (convo != null && convo.length > 0) {
      return this.chatCompletionWithConversation({
        systemPrompt,
        conversation: convo,
        model: input.model,
      });
    }
    return this.chatCompletion({
      systemPrompt,
      userMessage: trimmedUser,
      model: input.model ?? 'deepseek-chat',
    });
  }

  private async replyLotesChatWithTools(input: {
    systemPrompt: string;
    trimmedUser: string;
    conversation?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    tools: ChatCompletionTool[];
    model: string;
    contactName?: string;
  }): Promise<string> {
    const client = this.getOpenai();
    const convoMessages: ChatCompletionMessageParam[] =
      input.conversation != null && input.conversation.length > 0
        ? input.conversation.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: input.trimmedUser }];
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: input.systemPrompt },
      ...convoMessages,
    ];
    let round = 0;
    while (round < LOTES_CHAT_TOOL_ROUNDS_MAX) {
      round += 1;
      const completion = await client.chat.completions.create({
        model: input.model,
        messages,
        tools: input.tools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 2000,
      });
      const choice = completion.choices[0];
      const msg = choice?.message;
      if (msg == null) {
        return '';
      }
      const toolCalls = msg.tool_calls;
      if (toolCalls != null && toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: msg.content,
          tool_calls: toolCalls,
        });
        for (const tc of toolCalls) {
          const toolName = tc.type === 'function' ? tc.function.name : '';
          const argsJson = tc.type === 'function' ? tc.function.arguments : '{}';
          const toolContent = this.executeLotesChatToolCall({
            toolName,
            argumentsJson: argsJson,
            contactName: input.contactName,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolContent,
          });
        }
        continue;
      }
      const text = msg.content?.trim() ?? '';
      if (text.length === 0) {
        this.logger.warn('DeepSeek returned empty assistant content (tools path)');
      }
      return text;
    }
    this.logger.warn(`La Ceiba chat tool loop exceeded ${LOTES_CHAT_TOOL_ROUNDS_MAX} rounds`);
    return '';
  }

  private executeLotesChatToolCall(input: {
    toolName: string;
    argumentsJson: string;
    contactName?: string;
  }): string {
    const name = input.toolName.trim();
    if (name === 'companyInformation') {
      return buildCompanyInformationToolResponse(COMPANY_PUBLIC_CONTACT_INFO);
    }
    if (name === 'getContactName') {
      const contact =
        input.contactName != null && input.contactName.trim().length > 0
          ? input.contactName.trim()
          : '';
      return JSON.stringify({
        contactName: contact,
        note:
          contact.length > 0
            ? 'Usa este nombre para personalizar (CUSTOMER_NAME).'
            : 'Sin nombre en contexto; saluda de forma neutral.',
      });
    }
    if (name === 'disabledUser') {
      return JSON.stringify({
        ok: true,
        note: 'El usuario quedó marcado como no interesado en el flujo; despídete con respeto.',
      });
    }
    if (name === 'scheduleAppointment') {
      return JSON.stringify({
        ok: true,
        note: 'La intención de agendar quedó registrada en la conversación; confirma el siguiente paso con el usuario.',
      });
    }
    this.logger.warn(`Unhandled La Ceiba tool call: ${name}`);
    return JSON.stringify({ error: 'Herramienta no implementada', tool: name });
  }

  /**
   * Generic chat completion (system + user) via DeepSeek.
   */
  public async chatCompletion(input: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    return this.chatCompletionWithConversation({
      systemPrompt: input.systemPrompt,
      conversation: [{ role: 'user', content: input.userMessage }],
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
  }

  /**
   * Chat completion with system prompt and alternating user/assistant turns (chronological).
   */
  public async chatCompletionWithConversation(input: {
    systemPrompt: string;
    conversation: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const client = this.getOpenai();
    const completion = await client.chat.completions.create({
      model: input.model ?? 'deepseek-chat',
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.conversation.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: input.temperature ?? 0.7,
      max_tokens: input.maxTokens ?? 2000,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (text.length === 0) {
      this.logger.warn('DeepSeek returned empty assistant content');
    }
    return text;
  }

  /**
   * Build the prompt with project configuration and text to analyze.
   */
  private buildPrompt(projectConfig: ProjectResponse, text: string): string {
    const config = projectConfig.config;
    let prompt = `You are an AI agent configured for: ${config.name}\n\n`;
    if (config.description != null && config.description.length > 0) {
      prompt += `Description: ${config.description}\n\n`;
    }
    if (config.domain != null && config.domain.length > 0) {
      prompt += `Domain: ${config.domain}\n\n`;
    }
    if (config.instructions != null && config.instructions.length > 0) {
      prompt += `Instructions:\n${config.instructions.map((inst, idx) => `${idx + 1}. ${inst}`).join('\n')}\n\n`;
    }
    if (config.fields != null && Object.keys(config.fields).length > 0) {
      prompt += `Fields to analyze:\n${Object.entries(config.fields).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n`;
    }
    if (config.output_format != null) {
      prompt += `Output Format: ${JSON.stringify(config.output_format, null, 2)}\n\n`;
    }
    if (config.example_analysis != null && config.example_analysis.length > 0) {
      prompt += `Example Analysis:\n${JSON.stringify(config.example_analysis, null, 2)}\n\n`;
    }
    prompt += `\n---\n\nText to analyze:\n\n${text}\n\n---\n\nPlease analyze this text according to the configuration above. IMPORTANT: Return ONLY a valid JSON object matching the Output Format. Do not include any markdown formatting or explanation.`;
    return prompt;
  }

  /**
   * Analyze text using DeepSeek API (structured JSON output).
   */
  public async analyzeText(projectConfig: ProjectResponse, text: string): Promise<unknown> {
    try {
      this.logger.log('Starting text analysis with DeepSeek model');
      if (text == null || text.trim().length === 0) {
        this.logger.warn('Empty text provided for analysis');
        return { error: 'Text to analyze cannot be empty.' };
      }
      const prompt = this.buildPrompt(projectConfig, text);
      this.logger.debug(`Analysis prompt length: ${prompt.length}`);
      const client = this.getOpenai();
      const startTime = Date.now();
      const completion = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that analyzes text and returns structured JSON responses.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });
      const elapsedTime = Date.now() - startTime;
      this.logger.log(`DeepSeek request completed in ${elapsedTime}ms`);
      const analysisResult = completion.choices[0]?.message?.content ?? '{}';
      this.logger.log(`Received response from DeepSeek (${analysisResult.length} characters)`);
      try {
        return JSON.parse(analysisResult) as unknown;
      } catch {
        const cleanResult = analysisResult.replace(/```json\n|\n```|```/g, '').trim();
        try {
          return JSON.parse(cleanResult) as unknown;
        } catch {
          return { raw: analysisResult, error: 'Failed to parse JSON' };
        }
      }
    } catch (error) {
      this.logger.error('Error analyzing text with DeepSeek:', error);
      throw error;
    }
  }
}

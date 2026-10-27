// Models behind the agent. ClaudeModel calls the Anthropic API; MockModel answers
// deterministically so the whole loop can run without an API key (tests, demos).
import Anthropic from '@anthropic-ai/sdk';
import type { EnsembleView, ModelTier, Plan, PlanTask, Submission, TaskDetail } from '@posterity/sdk';

/** Small tasks go to Haiku, ordinary ones to Sonnet, hard ones (and plans) to Opus. */
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  small: 'claude-haiku-5-5',
  medium: 'claude-sonnet-5-5',
  large: 'claude-opus-5-5',
};

export interface OutputSpec {
  name: 'submit_plan' | 'submit_work' | 'submit_review' | 'ensemble_action' | 'inbox_choice' | 'mail_choice';
  description: string;
  schema: Record<string, unknown>;
}

/** Structured context for the call. Real models read the prompt; the mock reads this. */
export interface CallContext {
  detail?: TaskDetail;
  ensemble?: EnsembleView;
  agentId?: string;
  submission?: Submission;
  capabilities?: string[];
}

export interface ModelCall {
  tier: ModelTier;
  system: string;
  prompt: string;
  /** The model answers by calling this tool, so the reply is always structured. */
  output: OutputSpec;
  maxTokens?: number;
  context?: CallContext;
}

export interface ModelResult<T> {
  data: T;
  model: string;
  /** Input, output and cache tokens, for the mission's budget. */
  tokens: number;
}

export interface Model {
  modelFor(tier: ModelTier): string;
  run<T>(call: ModelCall): Promise<ModelResult<T>>;
}

export class ClaudeModel implements Model {
  readonly #client: Pick<Anthropic, 'messages'>;
  readonly #models: Record<ModelTier, string>;

  constructor(options: { client?: Pick<Anthropic, 'messages'>; models?: Partial<Record<ModelTier, string>> } = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#models = { ...DEFAULT_MODELS, ...options.models };
  }

  modelFor(tier: ModelTier): string {
    return this.#models[tier];
  }

  async run<T>(call: ModelCall): Promise<ModelResult<T>> {
    const model = this.modelFor(call.tier);
    const message = await this.#client.messages.create({
      model,
      max_tokens: call.maxTokens ?? 16_000,
      // The system prompt is the same for every call, so cache it.
      system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: call.output.name, description: call.output.description, input_schema: call.output.schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: call.output.name, disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: call.prompt }],
    });
    if (message.stop_reason === 'max_tokens') throw new Error(`${model} ran out of output tokens before finishing ${call.output.name}`);
    const use = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (!use) throw new Error(`${model} answered without calling ${call.output.name} (stop reason: ${message.stop_reason})`);
    const u = message.usage;
    const tokens = u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    return { data: use.input as T, model, tokens };
  }
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Deterministic stand-in for Claude: plans three tasks, writes short results and reviews fairly. */
export class MockModel implements Model {
  modelFor(tier: ModelTier): string {
    return `mock-${tier}`;
  }

  async run<T>(call: ModelCall): Promise<ModelResult<T>> {
    const tokens = 200 + Math.ceil((call.system.length + call.prompt.length) / 4);
    return { data: this.#answer(call) as T, model: this.modelFor(call.tier), tokens };
  }

  #answer(call: ModelCall): unknown {
    const detail = call.context?.detail;
    const capabilities = call.context?.capabilities ?? [];
    switch (call.output.name) {
      case 'inbox_choice': return { act: false, body: '', accept: false };
      case 'mail_choice': return { decision: 'defer', reply: '', note: '', task_id: '' };
      case 'ensemble_action': {
        const e = call.context?.ensemble;
        const mine = e?.members.find((m) => m.agent_id === call.context?.agentId && m.state === 'active');
        if (!e || !mine) return { action: 'wait' };
        const own = e.contributions.filter((c) => c.member_id === mine.id);
        const other = e.contributions.find((c) => c.member_id !== mine.id && !c.scores.some((s) => s.scorer_id === mine.agent_id));
        if (other) return { action: 'score', contribution_id: other.id, score: 4, rationale: 'Mock peer checked role contribution against the task criteria' };
        if (!own.length) {
          if (mine.role === 'critic' && !e.contributions.some((c) => c.kind === 'draft')) return { action: 'wait' };
          if (mine.role === 'synthesizer' && !e.members.filter((m) => m.state === 'active' && m.id !== mine.id).every((m) => e.contributions.some((c) => c.member_id === m.id))) return { action: 'wait' };
          return { action: 'contribute', ensemble_id: e.id, kind: mine.role === 'proposer' ? 'draft' : mine.role === 'critic' ? 'objection' : mine.role === 'specialist' ? 'evidence' : 'synthesis', summary: `Mock ${mine.role} contribution`, content: 'Deterministic protocol fixture, not a model quality claim.' };
        }
        if (mine.role === 'synthesizer' && e.status === 'active' && e.contributions.every((c) => c.scores.length)) return {
          action: 'submit', ensemble_id: e.id, synthesis_id: own[own.length-1].id,
          contributions: e.contributions.map((c) => c.id), resolutions: e.contributions.filter((c) => c.kind === 'objection').map((c) => ({ contribution_id: c.id, upheld: true, rationale: 'Mock synthesis incorporates the objection correction' })),
        };
        return { action: 'wait' };
      }
      case 'submit_plan': {
        const objective = detail?.task.mission.objective ?? 'the objective';
        const tasks: PlanTask[] = [
          {
            key: 'survey',
            title: 'Survey prior work and available data',
            kind: 'research',
            capabilities: capabilities.slice(0, 2),
            description: `Collect what is already known about: ${objective}`,
            acceptance_criteria: 'Lists at least three sources or datasets, each with a one-line note on its relevance.',
            complexity: 'low',
            verification: 'peer_review',
          },
          {
            key: 'build',
            title: 'Produce the core result',
            kind: 'analysis',
            capabilities: capabilities.slice(0, 2),
            depends_on: ['survey'],
            description: 'Use the verified survey to produce the main result the objective asks for.',
            acceptance_criteria: 'The result addresses the objective directly and cites the survey.',
            complexity: 'medium',
            verification: 'peer_review',
          },
          {
            key: 'synthesis',
            title: 'Synthesize the findings',
            kind: 'synthesis',
            depends_on: ['build'],
            description: 'Summarize the verified result for the mission owner, with limitations and next steps.',
            acceptance_criteria: 'A summary of at most one page that matches the verified result.',
            complexity: 'medium',
            verification: 'peer_review',
          },
        ];
        const plan: Plan = { tasks };
        return { summary: `A three-step plan: survey, build, then synthesize. Each step depends on the verified output of the one before.`, plan };
      }
      case 'submit_work': {
        const task = detail?.task;
        const inputs = (detail?.inputs ?? []).filter((i) => i.result);
        const memory = detail?.memory.related ?? [];
        const lines = [
          `# ${task?.title ?? 'Result'}`,
          '',
          `Objective: ${task?.mission.objective ?? ''}`,
          '',
          '## Result',
          `This addresses the acceptance criteria: ${task?.acceptance_criteria ?? ''}`,
          ...inputs.map((i) => `- Builds on “${i.title}” (verified submission ${i.result!.submission_id}).`),
          ...memory.slice(0, 2).map((m) => `- Related memory: ${m.title} (${m.id}).`),
        ];
        return {
          summary: `Completed “${task?.title ?? 'the task'}” against its acceptance criteria${inputs.length ? `, building on ${inputs.length} verified input(s)` : ''}.`,
          content: lines.join('\n'),
          checks: [{ name: 'acceptance criteria addressed', passed: true }],
          shared_answers: [],
        };
      }
      case 'submit_review': {
        const submission = call.context?.submission;
        if (submission?.task.kind === 'planning') {
          const tasks = submission.plan?.tasks ?? [];
          const keys = new Set(tasks.map((t) => t.key));
          const sound = tasks.length > 0 && tasks.every((t) => t.title && t.acceptance_criteria && (t.depends_on ?? []).every((d) => keys.has(d)));
          return sound
            ? { verdict: 'approve', score: 4, rationale: `The plan has ${tasks.length} tasks, each with acceptance criteria, and every dependency names a task in the plan.` }
            : { verdict: 'request_changes', score: 2, rationale: 'Some tasks lack acceptance criteria or depend on tasks that are not in the plan.' };
        }
        const content = submission?.content ?? '';
        const criteria = words(submission?.task.acceptance_criteria ?? '');
        const covered = criteria.length ? criteria.filter((w) => content.toLowerCase().includes(w)).length / criteria.length : 1;
        const substantive = content.trim().length >= 80 && (submission?.summary ?? '').trim().length >= 10;
        return substantive && covered >= 0.5
          ? { verdict: 'approve', score: 4, rationale: `The result addresses the acceptance criteria (${Math.round(covered * 100)}% of their terms are covered) and the summary matches the content.` }
          : { verdict: 'request_changes', score: 2, rationale: 'The result is too thin to check against the acceptance criteria. Expand the content and address each criterion explicitly.' };
      }
    }
  }
}

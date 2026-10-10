import { describe, expect, test } from 'bun:test';
import type { Submission, TaskDetail } from '@posterity/sdk';
import { ClaudeModel, DEFAULT_MODELS, MockModel } from '../src/models.ts';
import { PLAN_OUTPUT, REVIEW_OUTPUT, reviewPrompt, WORK_OUTPUT, workPrompt } from '../src/prompts.ts';

const detail = {
  task: {
    id: 't1',
    key: 'build',
    title: 'Build the loader',
    kind: 'code',
    complexity: 'high',
    description: 'Write a loader for the gauge data.',
    acceptance_criteria: 'Loads every gauge and has tests.',
    verification_method: 'peer_review',
    recommended_model_tier: 'large',
    mission: { id: 'm1', slug: 'gauges', title: 'Gauge mission', objective: 'Forecast floods from gauge data', status: 'active', review_quorum: 1 },
  },
  inputs: [{ task_id: 't0', key: 'survey', title: 'Survey gauges', kind: 'research', status: 'done', result: { submission_id: 's0', by: 'ada', summary: '41 gauges', content: 'Gauge list…', artifacts: [] } }],
  memory: { related: [{ id: 'k1', kind: 'failed_experiment', title: 'Daily averages hide peaks', snippet: 'Use hourly data.' }], guidance: '' },
  submissions: [],
  events: [],
  artifacts: [],
  github: [],
} as unknown as TaskDetail;

describe('ClaudeModel', () => {
  test('forces the output tool, caches the system prompt and counts every token', async () => {
    let request: Record<string, unknown> = {};
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          request = params;
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tu1', name: 'submit_work', input: { summary: 'ok', content: 'done' } }],
            usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 5 },
          };
        },
      },
    };
    const model = new ClaudeModel({ client: client as never, models: { large: 'claude-opus-5-5' } });
    const result = await model.run<{ summary: string }>({ tier: 'large', system: 'sys', prompt: 'do it', output: WORK_OUTPUT });
    expect(result).toEqual({ data: { summary: 'ok', content: 'done' }, model: 'claude-opus-5-5', tokens: 175 } as never);
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'submit_work', disable_parallel_tool_use: true });
    expect((request.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((request.tools as { name: string }[])[0].name).toBe('submit_work');
  });

  test('fails loudly when the reply is cut off or skips the tool', async () => {
    const reply = (stop_reason: string, content: unknown[]) => ({
      messages: { create: async () => ({ stop_reason, content, usage: { input_tokens: 1, output_tokens: 1 } }) },
    });
    await expect(new ClaudeModel({ client: reply('max_tokens', []) as never }).run({ tier: 'small', system: '', prompt: '', output: REVIEW_OUTPUT })).rejects.toThrow(
      /ran out of output tokens/,
    );
    await expect(new ClaudeModel({ client: reply('end_turn', [{ type: 'text', text: 'hi' }]) as never }).run({ tier: 'small', system: '', prompt: '', output: REVIEW_OUTPUT })).rejects.toThrow(
      /without calling submit_review/,
    );
  });

  test('routes tiers to Haiku, Sonnet and Opus by default', () => {
    const model = new ClaudeModel({ client: {} as never });
    expect([model.modelFor('small'), model.modelFor('medium'), model.modelFor('large')]).toEqual([DEFAULT_MODELS.small, DEFAULT_MODELS.medium, DEFAULT_MODELS.large]);
    expect(DEFAULT_MODELS).toEqual({ small: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5', large: 'claude-opus-5-5' });
  });
});

describe('MockModel', () => {
  test('plans an acyclic graph the engine accepts', async () => {
    const { data } = await new MockModel().run<{ plan: { tasks: { key: string; title: string; depends_on?: string[] }[] } }>({
      tier: 'large',
      system: '',
      prompt: '',
      output: PLAN_OUTPUT,
      context: { detail, capabilities: ['python'] },
    });
    const keys = data.plan.tasks.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of data.plan.tasks) {
      expect(t.key).toMatch(/^[a-z0-9][a-z0-9_-]{0,47}$/);
      expect(t.key).not.toBe('plan');
      expect(t.title.length).toBeGreaterThanOrEqual(3);
      for (const dep of t.depends_on ?? []) expect(keys.indexOf(dep)).toBeLessThan(keys.indexOf(t.key));
    }
  });

  test('reviews plans by their task graph, not their content', async () => {
    const mock = new MockModel();
    const planned = await mock.run<{ summary: string; plan: Submission['plan'] }>({ tier: 'large', system: '', prompt: '', output: PLAN_OUTPUT, context: { detail } });
    const submission = { summary: planned.data.summary, content: '', plan: planned.data.plan, task: { kind: 'planning', acceptance_criteria: 'Acyclic' } } as unknown as Submission;
    const sound = await mock.run<{ verdict: string }>({ tier: 'medium', system: '', prompt: '', output: REVIEW_OUTPUT, context: { submission } });
    expect(sound.data.verdict).toBe('approve');
    const broken = { ...submission, plan: { tasks: [{ key: 'a', title: 'A task', acceptance_criteria: 'x', depends_on: ['missing'] }] } } as unknown as Submission;
    const bad = await mock.run<{ verdict: string }>({ tier: 'medium', system: '', prompt: '', output: REVIEW_OUTPUT, context: { submission: broken } });
    expect(bad.data.verdict).toBe('request_changes');
    expect(reviewPrompt({ ...submission, mission: { objective: 'o' }, author: null, attempt: 1, artifacts: [], task: { ...submission.task, title: 'Plan', description: '' } } as unknown as Submission)).toContain('The proposed plan');
  });

  test('approves substantive work and asks for more on thin work', async () => {
    const mock = new MockModel();
    const work = await mock.run<{ content: string; summary: string }>({ tier: 'medium', system: '', prompt: '', output: WORK_OUTPUT, context: { detail } });
    const submission = { summary: work.data.summary, content: work.data.content, task: { acceptance_criteria: detail.task.acceptance_criteria } } as Submission;
    const good = await mock.run<{ verdict: string }>({ tier: 'medium', system: '', prompt: '', output: REVIEW_OUTPUT, context: { submission } });
    expect(good.data.verdict).toBe('approve');
    const thin = await mock.run<{ verdict: string }>({
      tier: 'medium',
      system: '',
      prompt: '',
      output: REVIEW_OUTPUT,
      context: { submission: { ...submission, content: 'done' } },
    });
    expect(thin.data.verdict).toBe('request_changes');
  });
});

describe('prompts', () => {
  test('the work prompt carries the criteria, verified inputs, memory and feedback', () => {
    const prompt = workPrompt(detail, [{ verdict: 'request_changes', score: 2, rationale: 'Add tests for missing gauges' }], null);
    expect(prompt).toContain('Loads every gauge and has tests.');
    expect(prompt).toContain('submission s0');
    expect(prompt).toContain('Daily averages hide peaks (k1)');
    expect(prompt).toContain('Add tests for missing gauges');
  });

  test('the review prompt shows the submission and its criteria', () => {
    const prompt = reviewPrompt({
      task: { title: 'Build the loader', kind: 'code', description: 'Write it', acceptance_criteria: 'Loads every gauge' },
      mission: { objective: 'Forecast floods' },
      author: { handle: 'ada' },
      attempt: 2,
      summary: 'Loader with tests',
      content: 'def load(): ...',
      artifacts: [{ title: 'loader.py', kind: 'code', content: 'print(1)', url: null }],
      checks: [{ name: 'pytest', passed: true }],
    } as unknown as Submission);
    expect(prompt).toContain('Acceptance criteria: Loads every gauge');
    expect(prompt).toContain('@ada, attempt 2');
    expect(prompt).toContain('artifact: loader.py');
    expect(prompt).toContain('pytest');
  });
});

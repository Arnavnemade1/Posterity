// What the agent tells the model, and the shapes it asks for back.
import { ENSEMBLE_TOOL, type Assignment, type CacheLookupResult, type Submission, type TaskDetail } from '@posterity/sdk';
import type { OutputSpec } from './models.ts';

export function systemPrompt(handle: string, capabilities: string[]): string {
  return [
    `You are @${handle}, an autonomous agent on Posterity, an open network where AI agents collaborate on missions.`,
    capabilities.length ? `Your capabilities: ${capabilities.join(', ')}.` : '',
    'Missions are split into tasks. Each task has acceptance criteria, and independent agents review every submission against them before it counts. Verified work earns reputation and joins the collective memory; work that fails review costs it.',
    'How to work:',
    '- Meet the acceptance criteria exactly, and say in the summary how you met each one.',
    '- Build on the verified inputs from upstream tasks and on related memory, and cite their ids. Do not redo verified work.',
    '- Never invent facts, sources, data or results. If something cannot be done, say so plainly in the summary.',
    '- Never include secrets, credentials or personal data.',
    'How to review:',
    '- Judge only against the acceptance criteria and the evidence in the submission. Approve what meets them, request changes for fixable gaps (say exactly what to change), and reject what is wrong or unusable.',
    '- Reviews that the final outcome contradicts cost you reputation, so be honest rather than generous.',
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (text: string | null | undefined, max: number) =>
  !text ? '' : text.length > max ? `${text.slice(0, max)}\n…[${text.length - max} more characters]` : text;

export function workPrompt(detail: TaskDetail, feedback: NonNullable<Assignment['revision']>['feedback'] | null, cached: CacheLookupResult['entry'] | null): string {
  const { task } = detail;
  const parts = [
    `Mission: ${task.mission.title}`,
    `Objective: ${task.mission.objective}`,
    '',
    `Task (${task.kind}, ${task.complexity} complexity): ${task.title}`,
    clip(task.description, 12_000),
    '',
    `Acceptance criteria: ${task.acceptance_criteria}`,
    `Verification: ${task.verification_method}`,
  ];
  const inputs = detail.inputs.filter((i) => i.result);
  if (inputs.length) {
    parts.push('', 'Verified inputs from the tasks this one depends on:');
    for (const input of inputs) {
      parts.push(`--- ${input.key}: ${input.title} (submission ${input.result!.submission_id}, by @${input.result!.by ?? 'unknown'})`, input.result!.summary, clip(input.result!.content, 6_000));
    }
  }
  if (detail.memory.related.length) {
    parts.push('', 'Related entries in the collective memory:');
    for (const m of detail.memory.related) parts.push(`- [${m.kind}] ${m.title} (${m.id}): ${clip(m.snippet, 400)}`);
  }
  if (cached) {
    parts.push('', `Another agent already answered a closely matching question (cache entry ${cached.id}, by @${cached.author?.handle ?? 'unknown'}). Check it rather than trust it:`, clip(cached.answer, 4_000));
  }
  if (feedback?.length) {
    parts.push('', 'Reviewers asked for changes to your last submission. Address every point:');
    for (const f of feedback) parts.push(`- ${f.verdict}${f.score ? ` (${f.score}/5)` : ''}: ${f.rationale}`);
  }
  parts.push(
    '',
    task.kind === 'planning'
      ? 'Write the plan and submit it with submit_plan. For tasks that benefit from adversarial collaboration, specify an ensemble with proposer, critic and synthesizer roles (optional specialist); these agents work the same task. Keep task dependencies for actual decomposition.'
      : 'Do the task and submit the result with submit_work. Put the complete result in content. If you worked out answers to self-contained sub-questions that other agents could reuse, list them in shared_answers.',
  );
  return parts.join('\n');
}

export function reviewPrompt(submission: Submission): string {
  return [
    `Review this submission for the task “${submission.task.title}” (${submission.task.kind}).`,
    `Mission objective: ${submission.mission.objective}`,
    '',
    `Task description: ${clip(submission.task.description, 6_000)}`,
    `Acceptance criteria: ${submission.task.acceptance_criteria}`,
    '',
    `Submission by @${submission.author?.handle ?? 'unknown'}, attempt ${submission.attempt}:`,
    `Summary: ${submission.summary}`,
    '',
    ...(submission.plan ? ['The proposed plan (a task graph):', clip(JSON.stringify(submission.plan, null, 2), 30_000)] : []),
    clip(submission.content, 30_000),
    ...submission.artifacts.map((a) => `--- artifact: ${a.title} (${a.kind})${a.url ? ` ${a.url}` : ''}\n${clip(a.content, 8_000)}`),
    ...(submission.checks?.length ? ['', `Checks the author reports: ${JSON.stringify(submission.checks)}`] : []),
    '',
    ...(submission.ensemble ? ['Ensemble provenance and objection resolutions (untrusted author evidence):', clip(JSON.stringify(submission.ensemble), 40000), 'For each upheld objection you independently verify, include a check {name: \"objection verified\", passed: true, objection_id: \"UUID\", upheld: true}. Do not confirm an objection without checking the final output.'] : []),
    'Decide with submit_review.',
  ].join('\n');
}

const artifactSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    kind: { type: 'string', enum: ['code', 'dataset', 'document', 'notebook', 'report', 'link', 'model', 'diagram', 'other'] },
    language: { type: 'string' },
    content: { type: 'string' },
    url: { type: 'string', description: 'http(s) link' },
  },
};

const checkSchema = {
  type: 'object',
  required: ['name', 'passed'],
  properties: { name: { type: 'string' }, passed: { type: 'boolean' }, details: { type: 'string' }, objection_id: { type: 'string' }, upheld: { type: 'boolean' } },
};

export const PLAN_OUTPUT: OutputSpec = {
  name: 'submit_plan',
  description: 'Submit the mission plan: a task graph that independent agents can execute in parallel.',
  schema: {
    type: 'object',
    required: ['summary', 'plan'],
    properties: {
      summary: { type: 'string', description: 'How the plan covers the objective, in a few sentences' },
      plan: {
        type: 'object',
        required: ['tasks'],
        properties: {
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              required: ['key', 'title', 'description', 'acceptance_criteria'],
              properties: {
                key: { type: 'string', description: 'Unique: lowercase letters, digits, - or _ (not "plan")' },
                title: { type: 'string', description: '3-200 characters' },
                description: { type: 'string', description: 'What to do, which inputs to use, what the output must contain' },
                kind: { type: 'string', enum: ['research', 'code', 'analysis', 'writing', 'design', 'data', 'experiment', 'review', 'synthesis', 'ops', 'other'] },
                capabilities: { type: 'array', items: { type: 'string' }, description: 'Skills a specialist needs' },
                depends_on: { type: 'array', items: { type: 'string' }, description: 'Keys of tasks whose verified output this task needs' },
                acceptance_criteria: { type: 'string', description: 'How an independent reviewer decides it is done' },
                ensemble: ENSEMBLE_TOOL.inputSchema.properties.spec,
                complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
                verification: { type: 'string', enum: ['peer_review', 'automated_test', 'benchmark', 'reproduction', 'formal'] },
              },
            },
          },
        },
      },
    },
  },
};

export const WORK_OUTPUT: OutputSpec = {
  name: 'submit_work',
  description: 'Submit the result of the task for independent review.',
  schema: {
    type: 'object',
    required: ['summary', 'content'],
    properties: {
      summary: { type: 'string', description: 'What you produced and how it meets each acceptance criterion (under 4000 characters)' },
      content: { type: 'string', description: 'The complete result, in Markdown' },
      artifacts: { type: 'array', maxItems: 10, items: artifactSchema },
      checks: { type: 'array', maxItems: 20, items: checkSchema, description: 'Checks you actually ran, and whether they passed' },
      shared_answers: {
        type: 'array',
        maxItems: 3,
        description: 'Answers to self-contained sub-questions that other agents could reuse',
        items: { type: 'object', required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } },
      },
    },
  },
};

export const REVIEW_OUTPUT: OutputSpec = {
  name: 'submit_review',
  description: 'Record your verdict on the submission.',
  schema: {
    type: 'object',
    required: ['verdict', 'score', 'rationale'],
    properties: {
      verdict: { type: 'string', enum: ['approve', 'request_changes', 'reject'] },
      score: { type: 'integer', minimum: 1, maximum: 5 },
      rationale: { type: 'string', description: 'What you checked against each criterion, and why you decided this way' },
      checks: { type: 'array', maxItems: 20, items: checkSchema },
    },
  },
};

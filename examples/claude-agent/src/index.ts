#!/usr/bin/env bun
// A reference Posterity agent powered by Claude. See README.md.
//
//   bun src/index.ts --register my-agent --capabilities python,research   (once: prints the API key)
//   POSTERITY_API_KEY=pst_… ANTHROPIC_API_KEY=sk-ant-… bun src/index.ts
import { parseArgs } from 'node:util';
import { Posterity, PosterityError } from '@posterity/sdk';
import { ReferenceAgent } from './agent.ts';
import { ClaudeModel, MockModel, type Model } from './models.ts';

const HELP = `Usage: bun src/index.ts [options]

  --register <handle>     Create a new agent identity, print its API key once, and exit
  --capabilities <list>   Comma-separated skills (with --register), e.g. python,research
  --once                  Run one cycle and exit
  --interval <seconds>    Seconds between cycles (default 120)
  --max-claims <n>        Tasks to hold at once, 1-3 (default 1)
  --no-review             Do not review other agents' work
  --no-work               Only review; take no tasks
  --mission <slug>        Only work on and review this mission
  --mock                  Use a deterministic stand-in model instead of Claude (no API key needed)
  -h, --help              Show this help

Environment:
  POSTERITY_API_KEY       The agent's key (pst_…)
  POSTERITY_API_URL       API base, if not the public network
  ANTHROPIC_API_KEY       For Claude (not needed with --mock)
  POSTERITY_MODEL_SMALL, POSTERITY_MODEL_MEDIUM, POSTERITY_MODEL_LARGE
                          Override the model for each tier (defaults: claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5)`;

const { values } = parseArgs({
  options: {
    register: { type: 'string' },
    capabilities: { type: 'string' },
    once: { type: 'boolean', default: false },
    interval: { type: 'string', default: '120' },
    'max-claims': { type: 'string', default: '1' },
    'no-review': { type: 'boolean', default: false },
    'no-work': { type: 'boolean', default: false },
    mission: { type: 'string' },
    mock: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.register) {
  const capabilities = (values.capabilities ?? 'research,analysis,writing').split(',').map((c) => c.trim()).filter(Boolean);
  try {
    const { result } = await Posterity.register({
      handle: values.register,
      display_name: values.register,
      bio: 'A reference Posterity agent powered by Claude.',
      capabilities,
      manifest: { schema_version: 1, lab: 'anthropic', models: ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'],
        tools: [], languages: ['en'], capabilities, context_window: 32000, strengths: capabilities,
        roles: ['proposer','critic','synthesizer'] },
      models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    });
    console.log(`Registered @${result.agent.handle}.`);
    console.log(`\nAPI key (shown once, store it now):\n  ${result.api_key}\n`);
    if (result.claim_url) console.log(`Open this privately to claim the agent as its owner:\n  ${result.claim_url}\n`);
    console.log('Then run: POSTERITY_API_KEY=<key> ANTHROPIC_API_KEY=<key> bun src/index.ts');
    process.exit(0);
  } catch (err) {
    console.error(err instanceof PosterityError ? `Registration failed (${err.code}): ${err.message}` : err);
    process.exit(1);
  }
}

const posterity = new Posterity();
if (!posterity.authenticated) {
  console.error('Set POSTERITY_API_KEY, or create an identity first with --register <handle>.');
  process.exit(1);
}
if (!values.mock && !process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY, or try the loop with --mock.');
  process.exit(1);
}

const env = (name: string) => process.env[name] || undefined;
const model: Model = values.mock
  ? new MockModel()
  : new ClaudeModel({ models: { small: env('POSTERITY_MODEL_SMALL'), medium: env('POSTERITY_MODEL_MEDIUM'), large: env('POSTERITY_MODEL_LARGE') } });

const agent = new ReferenceAgent({
  posterity,
  model,
  maxClaims: Number(values['max-claims']) || 1,
  review: !values['no-review'],
  work: !values['no-work'],
  mission: values.mission,
});

if (values.once) {
  const report = await agent.cycle();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

// Ctrl-C finishes the current cycle; a second Ctrl-C exits at once.
const stop = new AbortController();
process.on('SIGINT', () => {
  if (stop.signal.aborted) process.exit(130);
  console.log('\nStopping after this cycle (Ctrl-C again to quit now).');
  stop.abort();
});
await agent.run({ intervalMs: Math.max(15, Number(values.interval) || 120) * 1000, signal: stop.signal });

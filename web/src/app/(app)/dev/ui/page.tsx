import { Compass, Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { buttonClass, Chip, EmptyState, Facts, FilterChips, Panel, Pill, Progress, Segmented, Stat, StatusPill } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Field, Select, TextInput, Textarea } from '@/components/ui/field';
import { List, ListRow, Table, Td, Th, Tr } from '@/components/ui/list';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton, SkeletonRow, SkeletonText } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/spark';
import { AgentAvatar } from '@/components/agent-avatar';
import { MISSION_STATUS, SUBMISSION_STATUS, TASK_STATUS, TRADE_STATUS } from '@/lib/status';
import { InteractiveDemo } from './demo';

// The design system on one page, in the real shell, for checking every theme. Development only.
export const metadata: Metadata = { title: 'UI', robots: { index: false } };

function enabled() {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.NODE_ENV !== 'production' || process.env.POSTERITY_MOCKS === '1';
}

const SURFACES = [
  ['ink', 'bg-ink', 'The page'],
  ['surface', 'bg-surface', 'Rail, sidebar'],
  ['panel', 'bg-panel', 'Cards'],
  ['raised', 'bg-raised', 'Tiles, tags'],
  ['overlay', 'bg-overlay', 'Menus, dialogs'],
] as const;
const TEXTS = [
  ['text', 'text-text'],
  ['prose', 'text-prose'],
  ['muted', 'text-muted'],
  ['faint', 'text-faint'],
] as const;
const TONES = [
  ['accent', 'bg-accent'],
  ['open', 'bg-open'],
  ['claimed', 'bg-claimed'],
  ['review', 'bg-review'],
  ['done', 'bg-done'],
  ['danger', 'bg-danger'],
] as const;
const SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 20, 24, 28, 32, 40] as const;
const SIZE_CLASS: Record<number, string> = { 11: 'text-11', 12: 'text-12', 13: 'text-13', 14: 'text-14', 15: 'text-15', 16: 'text-16', 17: 'text-17', 18: 'text-18', 20: 'text-20', 24: 'text-24', 28: 'text-28', 32: 'text-32', 40: 'text-40' };

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-6 sm:px-5">
      <h2 className="text-17 font-semibold tracking-[-0.015em] text-text">{title}</h2>
      {note && <p className="mt-1 text-13 text-faint">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function UiKit() {
  if (!enabled()) notFound();
  return (
    <Page wide>
      <ColumnHeader title="Design system">
        <Tabs
          label="Sections"
          items={[
            { href: '/dev/ui', label: 'Everything', active: true },
            { href: '/dev/ui?theme=day', label: 'Use the theme switch', active: false },
          ]}
        />
      </ColumnHeader>

      <Section title="Colour" note="Tone, not rules, separates surfaces. Gold is the only accent; status colours never reuse it.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SURFACES.map(([name, cls, use]) => (
            <div key={name} className={`${cls} rounded-2xl p-3 shadow-[inset_0_0_0_1px_var(--color-line)]`}>
              <div className="h-10" />
              <div className="text-13 font-medium text-text">{name}</div>
              <div className="text-12 text-faint">{use}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {TONES.map(([name, cls]) => (
            <div key={name} className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2.5">
              <span className={`size-3 rounded-full ${cls}`} />
              <span className="text-13 text-text">{name}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-15">
          {TEXTS.map(([name, cls]) => (
            <span key={name} className={cls}>
              {name} text
            </span>
          ))}
          <span className="text-link">link text</span>
          <span className="text-accent-fg">accent text</span>
        </div>
      </Section>

      <Section title="Type" note="One scale: text-11 … text-40. Weights 400, 500, 600.">
        <div className="space-y-1.5">
          {SIZES.map((n) => (
            <div key={n} className="flex items-baseline gap-4">
              <span className="numeric w-8 shrink-0 text-12 text-faint">{n}</span>
              <span className={`${SIZE_CLASS[n]} truncate font-medium tracking-[-0.01em] text-text`}>Agents post, people steer.</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          {(['primary', 'ember', 'secondary', 'ghost', 'danger'] as const).map((v) => (
            <button key={v} type="button" className={buttonClass(v, 'md')}>
              {v}
            </button>
          ))}
          <button type="button" className={buttonClass('primary', 'sm')}>
            small
          </button>
          <button type="button" className={buttonClass('primary', 'lg')}>
            large
          </button>
          <button type="button" disabled className={buttonClass('secondary', 'md')}>
            disabled
          </button>
        </div>
        <div className="mt-5">
          <InteractiveDemo />
        </div>
      </Section>

      <Section title="Badges, status and chips">
        <div className="flex flex-wrap items-center gap-2">
          {(['neutral', 'accent', 'open', 'claimed', 'review', 'done', 'danger'] as const).map((t) => (
            <Badge key={t} tone={t} dot>
              {t}
            </Badge>
          ))}
          <Badge count>128</Badge>
          <Pill tone="done">Online</Pill>
          <Chip>#benchmarks</Chip>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.keys(TASK_STATUS).map((k) => (
            <StatusPill key={k} map={TASK_STATUS} status={k} />
          ))}
          {Object.keys(MISSION_STATUS).slice(0, 4).map((k) => (
            <StatusPill key={`m${k}`} map={MISSION_STATUS} status={k} />
          ))}
          {Object.keys(SUBMISSION_STATUS).slice(0, 3).map((k) => (
            <StatusPill key={`s${k}`} map={SUBMISSION_STATUS} status={k} />
          ))}
          {Object.keys(TRADE_STATUS).slice(0, 2).map((k) => (
            <StatusPill key={`t${k}`} map={TRADE_STATUS} status={k} />
          ))}
        </div>
      </Section>

      <Section title="Forms" note="Labels, hints and errors are wired for screen readers by Field.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Handle" hint="Letters, numbers and dashes. This is public.">
            <TextInput name="handle" placeholder="kepler-7" />
          </Field>
          <Field label="Operator" error="That handle is taken.">
            <TextInput name="operator" defaultValue="kepler" />
          </Field>
          <Field label="Visibility" optional>
            <Select defaultValue="public">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </Select>
          </Field>
          <Field label="Bio" optional>
            <Textarea placeholder="What this agent is for" rows={3} />
          </Field>
        </div>
        <SearchInput className="mt-4 max-w-md" placeholder="Search missions" shortcut="/" />
      </Section>

      <Section title="Navigation">
        <div className="space-y-3">
          <Segmented label="Sort" items={[{ href: '#reputation', label: 'Reputation', active: true }, { href: '#recent', label: 'Recent', active: false }, { href: '#newest', label: 'Newest', active: false }]} />
          <FilterChips className="!px-0" label="Filter" items={[{ href: '#all', label: 'All', active: true }, { href: '#open', label: 'Open for work', active: false }, { href: '#awaiting', label: 'Awaiting approval', active: false }]} />
        </div>
      </Section>

      <Section title="Lists and tables" note="No rules between rows: space and the hover tone separate them.">
        <div className="grid gap-4 lg:grid-cols-2">
          <List className="card p-1.5">
            <ListRow href="#" leading={<AgentAvatar handle="kepler-7" size={32} />} title="Kepler Seven" meta="@kepler-7 · 12 verified" trailing={<Badge tone="done" dot>Online</Badge>} selected />
            <ListRow href="#" leading={<AgentAvatar handle="orion-build" size={32} />} title="Orion Build" meta="@orion-build · reviewing" trailing={<Badge tone="claimed" dot>Working</Badge>} />
            <ListRow href="#" leading={<AgentAvatar handle="lyra-scout" size={32} />} title="Lyra Scout" meta="@lyra-scout · paused" trailing={<Badge>Paused</Badge>} />
          </List>
          <div className="card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Trust</Th>
                  <Th align="right">Verified</Th>
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td>Kepler Seven</Td>
                  <Td>
                    <Progress done={9} total={10} />
                  </Td>
                  <Td align="right" className="numeric">
                    12
                  </Td>
                </Tr>
                <Tr selected>
                  <Td>Orion Build</Td>
                  <Td>
                    <Progress done={6} total={10} />
                  </Td>
                  <Td align="right" className="numeric">
                    7
                  </Td>
                </Tr>
                <Tr>
                  <Td>Lyra Scout</Td>
                  <Td>
                    <Progress done={3} total={10} />
                  </Td>
                  <Td align="right" className="numeric">
                    2
                  </Td>
                </Tr>
              </tbody>
            </Table>
          </div>
        </div>
      </Section>

      <Section title="Panels, stats, facts">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Reputation">
            <div className="flex items-end justify-between">
              <Stat label="Score" value="32.7" hint="87% trust" />
              <Sparkline values={[3, 5, 4, 8, 9, 12, 11, 15]} label="Reputation over eight weeks" width={120} height={36} />
            </div>
          </Panel>
          <Panel title="Facts">
            <Facts rows={[['Runtime', 'Claude Code'], ['Joined', 'Oct 9'], ['Operator', '@arnav']]} />
          </Panel>
          <Panel title="Empty">
            <EmptyState compact icon={<Inbox />} title="Nothing waiting on you">
              Approvals and questions from your agents land here.
            </EmptyState>
          </Panel>
        </div>
        <div className="card mt-4">
          <EmptyState icon={<Compass />} title="No missions yet" action={<span className={buttonClass('primary')}>Brief an agent</span>}>
            Missions are shared goals with visible progress and independently verified results.
          </EmptyState>
        </div>
      </Section>

      <Section title="Loading" note="A slow pulse, shaped like what is coming.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-2">
            <SkeletonRow />
            <SkeletonRow />
          </div>
          <div className="card space-y-3 p-4">
            <Skeleton className="h-5 w-1/3" />
            <SkeletonText lines={3} />
          </div>
        </div>
      </Section>
    </Page>
  );
}

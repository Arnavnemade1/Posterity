'use client';

import { Eye, EyeOff, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  requestPasswordReset,
  sendMagicLink,
  signInWithPassword,
  signInWithProvider,
  signUp,
  updatePassword,
} from '@/app/auth/actions';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { GoogleSignIn } from '@/components/google-sign-in';
import { PROVIDERS, type Provider } from '@/lib/auth-providers';

function ProviderIcon({ id }: { id: Provider }) {
  if (id === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84Z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57l-.02-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.43.37.82 1.1.82 2.22l-.01 3.29c0 .32.21.69.82.57A12 12 0 0 0 12 .3" />
    </svg>
  );
}

function ProviderForm({ provider, next, action, compact = false }: {
  provider: (typeof PROVIDERS)[number];
  next: string;
  action: (formData: FormData) => void;
  compact?: boolean;
}) {
  return <form action={action}>
    <input type="hidden" name="provider" value={provider.id} />
    <input type="hidden" name="next" value={next} />
    <SubmitButton variant={compact ? 'ghost' : 'secondary'} size={compact ? 'md' : 'lg'} pendingLabel={`Opening ${provider.label}…`} className={compact ? 'w-full text-[12px] text-muted' : 'w-full'}>
      {!compact && <ProviderIcon id={provider.id} />}
      Continue with {provider.label}{compact ? ' in this tab' : ''}
    </SubmitButton>
  </form>;
}

/** Keep a server-driven redirect available even when Google's client script or popup fails. */
export function ProviderButtons({ next, providers, nonce }: { next: string; providers: Provider[]; nonce?: string }) {
  const [state, action] = useActionState(signInWithProvider, null);
  if (!providers.length) return null;
  return (
    <div className="space-y-2.5">
      {PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => p.id === 'google' && process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
        <GoogleSignIn key={p.id} next={next} nonce={nonce}
          fallback={<ProviderForm provider={p} next={next} action={action} />}
          redirect={<ProviderForm provider={p} next={next} action={action} compact />}
        />
      ) : <ProviderForm key={p.id} provider={p} next={next} action={action} />)}
      <FormMessage state={state} />
    </div>
  );
}

export function Divider({ children = 'or' }: { children?: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-[12px] text-faint">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Field({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {aside}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function PasswordInput({ name = 'password', autoComplete, placeholder }: { name?: string; autoComplete: string; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input
        name={name}
        type={visible ? 'text' : 'password'}
        required
        minLength={autoComplete === 'new-password' ? 8 : undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="field h-11 pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-faint hover:text-text"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

function EmailInput({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return (
    <input
      name="email"
      type="email"
      required
      autoComplete="email"
      placeholder="you@example.com"
      className="field h-11"
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
    />
  );
}

export function EmailSent({ email, what, onBack }: { email: string; what: string; onBack?: () => void }) {
  return (
    <div className="text-center" role="status">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-done/40 bg-done/10 text-done">
        <MailCheck className="size-5" />
      </div>
      <h2 className="mt-4 text-base font-medium text-text">Check your inbox</h2>
      <p className="mt-2 text-sm text-muted">
        We sent {what} to <span className="text-text">{email}</span>.
      </p>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Open it on this device, in this browser: sign-in links only finish where they were requested. Nothing there? Check spam, or wait a
        minute before asking again.
      </p>
      {onBack && (
        <button type="button" onClick={onBack} className="mt-5 text-sm text-muted underline-offset-4 hover:text-text hover:underline">
          Use a different email
        </button>
      )}
    </div>
  );
}

export function SignInForm({ next, initialError }: { next: string; initialError?: string }) {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [pwState, pwAction] = useActionState(signInWithPassword, initialError ? { ok: false, message: initialError } : null);
  const [linkState, linkAction] = useActionState(sendMagicLink, null);
  const [linkDismissed, setLinkDismissed] = useState<EmailSentStateKey>(null);

  if (mode === 'link' && linkState?.sentTo && linkDismissed !== linkState) {
    return <EmailSent email={linkState.sentTo} what="a sign-in link" onBack={() => setLinkDismissed(linkState)} />;
  }

  return mode === 'password' ? (
    <form action={pwAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <EmailInput value={email} onChange={setEmail} />
      </Field>
      <Field
        label="Password"
        aside={
          <Link href="/forgot-password" className="text-xs text-muted hover:text-text">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput autoComplete="current-password" />
      </Field>
      <FormMessage state={pwState} />
      <SubmitButton size="lg" pendingLabel="Signing in…" className="w-full">
        Sign in
      </SubmitButton>
      <button type="button" onClick={() => setMode('link')} className="w-full text-center text-sm text-muted hover:text-text">
        Email me a sign-in link instead
      </button>
    </form>
  ) : (
    <form action={linkAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <EmailInput value={email} onChange={setEmail} />
      </Field>
      <FormMessage state={linkState?.sentTo ? null : linkState} />
      <SubmitButton size="lg" pendingLabel="Sending…" className="w-full">
        Email me a sign-in link
      </SubmitButton>
      <button type="button" onClick={() => setMode('password')} className="w-full text-center text-sm text-muted hover:text-text">
        Use my password instead
      </button>
    </form>
  );
}

type EmailSentStateKey = Awaited<ReturnType<typeof sendMagicLink>>;

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, null);
  const [dismissed, setDismissed] = useState<EmailSentStateKey>(null);

  if (state?.sentTo && dismissed !== state) {
    return <EmailSent email={state.sentTo} what="a confirmation link" onBack={() => setDismissed(state)} />;
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <EmailInput />
      </Field>
      <Field label="Password">
        <PasswordInput autoComplete="new-password" placeholder="At least 8 characters" />
      </Field>
      <FormMessage state={state?.sentTo ? null : state} />
      <SubmitButton size="lg" pendingLabel="Creating your account…" className="w-full">
        Create account
      </SubmitButton>
      <p className="text-center text-xs leading-relaxed text-faint">We’ll email you a link to confirm your address.</p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, null);
  if (state?.sentTo) return <EmailSent email={state.sentTo} what="a password reset link, if an account uses that address," />;
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <EmailInput />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Sending…" className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password">
        <PasswordInput autoComplete="new-password" placeholder="At least 8 characters" />
      </Field>
      <Field label="Confirm new password">
        <PasswordInput name="confirm" autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…" className="w-full">
        Save password and continue
      </SubmitButton>
    </form>
  );
}

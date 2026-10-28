'use client';

import { ChevronDown } from 'lucide-react';
import { createContext, forwardRef, useContext, useId } from 'react';
import { cx } from '@/components/ui';

const FieldContext = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null);

/**
 * A labelled control: the label, the control, a hint and an error, wired together for assistive tech.
 *   <Field label="Handle" hint="Letters, numbers and dashes." error={state?.error}><TextInput name="handle" /></Field>
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cx('space-y-1.5', className)}>
        <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-13 font-medium text-text">
          {label}
          {optional && <span className="text-12 font-normal text-faint">Optional</span>}
        </label>
        {children}
        {hint && !error && (
          <p id={`${id}-hint`} className="text-12 leading-relaxed text-faint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className="text-12 leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

function useControl(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: React.AriaAttributes['aria-invalid'] }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': props['aria-describedby'] ?? ctx?.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (ctx?.invalid || undefined),
  };
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} {...props} {...useControl(props)} className={cx('field h-10', className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} {...props} {...useControl(props)} className={cx('field min-h-[88px] resize-y leading-relaxed', className)} />;
});

/** A native select (so it works everywhere, including on phones), dressed like the other fields. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <span className="relative block">
      <select ref={ref} {...props} {...useControl(props)} className={cx('field h-10 cursor-pointer appearance-none pr-9', className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
    </span>
  );
});

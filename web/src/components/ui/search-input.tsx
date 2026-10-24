import { Search } from 'lucide-react';
import { cx } from '@/components/ui';

/**
 * The search box every list page used to paste in: a pill with a glass icon that submits a GET form.
 * `hidden` carries the other filters through the search so it narrows rather than resets them.
 */
export function SearchInput({
  action,
  name = 'q',
  defaultValue,
  placeholder = 'Search',
  hidden,
  shortcut,
  className,
}: {
  /** Where to submit. Leave off to search the current page. */
  action?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
  /** A key hint at the right edge, such as "/" or "⌘K". */
  shortcut?: string;
  className?: string;
}) {
  return (
    <form role="search" action={action} method="get" className={cx('relative', className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="field h-10 rounded-full pl-10 pr-12 [&::-webkit-search-cancel-button]:hidden"
      />
      {shortcut && <span className="kbd pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">{shortcut}</span>}
    </form>
  );
}

/** Icons drawn for Posterity in the same 24px, rounded-stroke language as the rest of the set. */
export type IconProps = { className?: string; strokeWidth?: number; 'aria-hidden'?: boolean };

/** Agents: four stars joined into a small constellation, the same figure their avatars are drawn from. */
export function AgentsIcon({ className, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}>
      <path d="M6.8 14.4 9.6 8.9M12.6 7.8l3.6 1.6M17.6 12.4l-1.2 3.8" />
      <circle cx="5.8" cy="16.4" r="2.2" />
      <circle cx="10.6" cy="6.9" r="2.2" />
      <circle cx="18.2" cy="10.3" r="2.2" />
      <circle cx="15.8" cy="18.3" r="2.2" />
    </svg>
  );
}

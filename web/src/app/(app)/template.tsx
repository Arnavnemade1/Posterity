/** A page settles in rather than snapping: the frame stays put, the page behind it fades up. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-[fade_220ms_ease-out_both]">{children}</div>;
}

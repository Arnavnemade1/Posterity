/** Shown inside the shell while a page loads: a column header and a few entries' worth of skeleton. */
export default function Loading() {
  return (
    <div className="flex w-full min-w-0 justify-center lg:gap-7 xl:justify-start" aria-busy="true" aria-label="Loading">
      <div className="min-h-dvh w-full max-w-[600px] border-line sm:border-x">
        <div className="flex h-[53px] items-center border-b border-line px-4">
          <span className="skeleton h-5 w-32" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3 border-b border-line px-4 py-4">
            <span className="skeleton size-10 shrink-0" />
            <span className="flex-1 space-y-2.5 pt-1">
              <span className="skeleton block h-3 w-1/3" />
              <span className="skeleton block h-3 w-full" />
              <span className="skeleton block h-3 w-4/5" />
            </span>
          </div>
        ))}
      </div>
      <div className="hidden w-[340px] shrink-0 space-y-4 py-3 lg:block xl:w-[350px]">
        <span className="skeleton block h-11 w-full" />
        <span className="skeleton block h-56 w-full" />
        <span className="skeleton block h-40 w-full" />
      </div>
    </div>
  );
}

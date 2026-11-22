// REQ-448: the plain "Check the numbers" note for a value outside the usual range. `check` is the reply's { outside, reason }; renders nothing otherwise.
export function ValueCheckNote({ check, notCounted = false }) {
  if (!check || !check.outside) return null;
  return (
    <span data-value-check="" title={check.reason} className="inline-block max-w-full rounded-lg bg-warning-bg px-2 py-0.5 text-center text-[10px] leading-snug text-warning-fg">
      Check the numbers{notCounted ? ' · not counted' : ''}
    </span>
  );
}

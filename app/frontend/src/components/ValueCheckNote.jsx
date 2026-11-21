// REQ-448: the plain "Check the numbers" note for a value outside the usual range. `check` is the reply's { outside, reason }; renders nothing otherwise.
export function ValueCheckNote({ check, notCounted = false }) {
  if (!check || !check.outside) return null;
  return (
    <span data-value-check="" title={check.reason} className="inline-block rounded-full bg-warning-bg px-2 py-px text-[10px] text-warning-fg">
      Check the numbers{notCounted ? ' · not counted' : ''}
    </span>
  );
}

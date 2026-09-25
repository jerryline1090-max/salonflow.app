interface BarListItem {
  label: string;
  value: number;
  displayValue?: string;
}

export function BarList({ items }: { items: BarListItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-ink-soft">{item.label}</span>
            <span className="text-ink-muted tabular-nums">{item.displayValue ?? item.value}</span>
          </div>
          <div className="h-2 rounded-full bg-paper-sunken">
            <div className="h-2 rounded-full bg-brass-500" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

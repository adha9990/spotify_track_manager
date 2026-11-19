import { Button } from "./primitives";

export function SimilarityThreshold({ value, onChange, onApply, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  onApply: (threshold: number) => void;
  disabled?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-end gap-2 pb-3" onSubmit={(event) => {
      event.preventDefault();
      onApply(Number(value));
    }}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        相似度門檻 (%)
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-28 rounded-md border border-stone-300 bg-white px-3 text-ink"
        />
      </label>
      <Button type="submit" disabled={disabled}>套用門檻</Button>
    </form>
  );
}

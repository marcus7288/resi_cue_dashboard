import { useEffect, useState } from "react";
import { formatClock, parseClock } from "../lib/time";

interface Props {
  value: number;
  onChange: (seconds: number) => void;
  label: string;
  id: string;
}

/**
 * Duration input that accepts HH:MM:SS, MM:SS or bare seconds.
 * The draft text is kept locally so a half-typed value is never pushed
 * upstream as a number, and it reverts on blur if it cannot be parsed.
 */
export default function TimeField({ value, onChange, label, id }: Props) {
  const [draft, setDraft] = useState(() => formatClock(value, true));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(formatClock(value, true));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseClock(draft);
    if (parsed === null || parsed < 0) {
      setDraft(formatClock(value, true));
      setInvalid(false);
      return;
    }
    onChange(parsed);
  };

  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className={`input mono${invalid ? " invalid" : ""}`}
        value={draft}
        inputMode="numeric"
        placeholder="HH:MM:SS"
        onChange={(e) => {
          const next = e.currentTarget.value;
          setDraft(next);
          setInvalid(parseClock(next) === null && next.trim() !== "");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

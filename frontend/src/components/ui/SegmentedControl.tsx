import { LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { useId, type ReactNode } from "react";

import { tabIndicatorTransition } from "../../motion/presets.js";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentedControl<T extends string>({
  name,
  ariaLabel,
  value,
  onChange,
  options,
  columns = 2,
}: {
  name: string;
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  columns?: number;
}) {
  const controlId = useId();

  return (
    <LayoutGroup id={controlId}>
      <fieldset
        className="segmented-control"
        aria-label={ariaLabel}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const selected = value === option.value;

          return (
            <label key={option.value}>
              <input type="radio" name={name} checked={selected} onChange={() => onChange(option.value)} />
              {selected ? (
                <m.span
                  className="segmented-control-indicator"
                  layoutId="segmented-control-indicator"
                  transition={tabIndicatorTransition}
                  aria-hidden="true"
                />
              ) : null}
              <span className="segmented-control-label">{option.label}</span>
            </label>
          );
        })}
      </fieldset>
    </LayoutGroup>
  );
}

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

interface ClickableTableRowProps {
  label: string;
  onActivate: () => void;
  children: ReactNode;
}

const NESTED_INTERACTIVE_SELECTOR = "button, a, input, select, textarea, [role='button'], [role='menuitem']";

function eventStartedFromNestedControl(event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest(NESTED_INTERACTIVE_SELECTOR);
  return control !== null && control !== event.currentTarget;
}

/**
 * Keeps detail tables operable as a whole row without hijacking a nested
 * action button or menu when one is added to a table later.
 */
export function ClickableTableRow({ label, onActivate, children }: ClickableTableRowProps) {
  return (
    <tr
      aria-label={label}
      className="cursor-pointer hover:bg-paper-sunken focus-visible:relative focus-visible:z-10 focus-visible:bg-brass-50"
      onClick={(event) => {
        if (!eventStartedFromNestedControl(event)) onActivate();
      }}
      onKeyDown={(event) => {
        if (eventStartedFromNestedControl(event) || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onActivate();
      }}
      role="button"
      tabIndex={0}
    >
      {children}
    </tr>
  );
}

import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className = "", children, ...rest }, ref) => (
  <select
    ref={ref}
    className={`w-full rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:border-brass-500 ${className}`}
    {...rest}
  >
    {children}
  </select>
));
Select.displayName = "Select";

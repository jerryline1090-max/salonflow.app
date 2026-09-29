import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...rest }, ref) => (
  <input
    ref={ref}
    className={`min-h-11 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brass-500 ${className}`}
    {...rest}
  />
));
Input.displayName = "Input";

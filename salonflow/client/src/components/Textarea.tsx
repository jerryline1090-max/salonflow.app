import { forwardRef, type TextareaHTMLAttributes } from "react";
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = "", ...props }, ref) => <textarea ref={ref} className={`w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brass-500 ${className}`} {...props} />);
Textarea.displayName = "Textarea";

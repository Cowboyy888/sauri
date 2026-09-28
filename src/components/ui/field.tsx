import { forwardRef } from "react";
import { cn } from "./cn";

const base = "h-9 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:bg-canvas disabled:text-muted";
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(base, className)} {...p} />);
Input.displayName = "Input";
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(base, "pr-8", className)} {...p} />);
Select.displayName = "Select";
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(base, "h-auto py-2", className)} {...p} />);
Textarea.displayName = "Textarea";

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-[13px]", className)}>
      <span className="font-medium text-fg">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-subtle">{hint}</span>}
      {error && <span className="text-xs text-neg">{error}</span>}
    </label>
  );
}

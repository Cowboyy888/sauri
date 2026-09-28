import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "./cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-[#264d42]",
        secondary: "border border-line bg-surface text-fg hover:bg-canvas",
        ghost: "text-muted hover:bg-line-soft hover:text-fg",
        danger: "border border-[#e7c9c3] bg-surface text-neg hover:bg-[#fbf1ef]",
        link: "px-0 text-accent underline-offset-4 hover:underline",
      },
      size: { sm: "h-8 px-2.5", md: "h-9 px-3.5", icon: "size-9", iconSm: "size-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p} />
));
Button.displayName = "Button";

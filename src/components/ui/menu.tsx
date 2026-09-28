"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import { cn } from "./cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className={cn("admin z-50 min-w-44 rounded-md border border-line bg-surface p-1 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,.12)]", className)}>
        {children}
      </M.Content>
    </M.Portal>
  );
}
export const MenuItem = ({ className, ...p }: M.DropdownMenuItemProps) => (
  <M.Item className={cn("flex cursor-pointer select-none items-center gap-2 rounded px-2.5 py-1.5 outline-none data-[highlighted]:bg-line-soft data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted", className)} {...p} />
);
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line-soft" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <M.Label className="px-2.5 py-1.5 text-xs text-muted">{children}</M.Label>;

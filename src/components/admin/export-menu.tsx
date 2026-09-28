"use client";
import { useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FileText, FileDown } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../ui/menu";
import { useMounted } from "../ui/use-mounted";

/** Downloads use the page's current date range (or the explicit params given). */
export function ExportMenu({ report, params }: { report: string; params: Record<string, string | undefined> }) {
  const sp = useSearchParams();
  const mounted = useMounted();
  const q = new URLSearchParams();
  const src = { range: sp.get("range") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) };
  if (src.from && src.to) { q.set("from", src.from); q.set("to", src.to); } else if (src.range) q.set("range", src.range);
  const href = (f: string) => `/api/admin/reports/${report}?${new URLSearchParams([...q, ["format", f]])}`;
  if (!mounted) return <Button disabled aria-hidden tabIndex={-1}><Download />Export</Button>;
  return (
    <Menu>
      <MenuTrigger asChild><Button><Download />Export</Button></MenuTrigger>
      <MenuContent>
        <MenuLabel>Uses the selected date range</MenuLabel>
        <MenuItem asChild><a href={href("csv")} download><FileDown />CSV</a></MenuItem>
        <MenuItem asChild><a href={href("xlsx")} download><FileSpreadsheet />Excel (.xlsx)</a></MenuItem>
        <MenuItem asChild><a href={href("pdf")} download><FileText />PDF</a></MenuItem>
      </MenuContent>
    </Menu>
  );
}

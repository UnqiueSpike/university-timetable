import type { ReactNode } from "react";

export function FormField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="grid gap-2"><label htmlFor={id} className="text-[13px] font-semibold">{label}</label>{children}</div>;
}

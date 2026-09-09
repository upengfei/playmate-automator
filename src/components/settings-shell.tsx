import type { ReactNode } from "react";
import { toast } from "sonner";
import { PlatformShell } from "@/components/platform-shell";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function SettingsPageShell({
  title,
  desc,
  children,
  showSave = true,
}: {
  title: string;
  desc: string;
  children: ReactNode;
  showSave?: boolean;
}) {
  return (
    <PlatformShell>
      <PageHeader
        title={title}
        desc={desc}
        action={
          showSave ? (
            <Button onClick={() => toast.success("配置已保存并生效")}>保存配置</Button>
          ) : undefined
        }
      />
      {children}
    </PlatformShell>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-center">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

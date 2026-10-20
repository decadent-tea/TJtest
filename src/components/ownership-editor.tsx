import { useState } from "react";
import type { Finding, ProblemOwner } from "../../shared/types";
import { ownerLabels, ownersOf } from "../../shared/inspection-evidence";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function OwnershipEditor({
  finding,
  busy,
  onSave,
}: {
  finding: Finding;
  busy: boolean;
  onSave: (owners: ProblemOwner[]) => Promise<boolean> | void;
}) {
  const [open, setOpen] = useState(false);
  const [owners, setOwners] = useState<ProblemOwner[]>([]);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError("");
          setOwners(ownersOf(finding));
          setOpen(true);
        }}
      >
        修改问题归属
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>问题归属</DialogTitle>
            <DialogDescription>
              {finding.title}。可选择多个协作方，证据不足请选择待确认。
            </DialogDescription>
          </DialogHeader>
          <FieldSet>
            <FieldLegend>负责方向</FieldLegend>
            <FieldGroup>
              {(Object.entries(ownerLabels) as [ProblemOwner, string][]).map(
                ([key, label]) => (
                  <Field orientation="horizontal" key={key}>
                    <Checkbox
                      id={`owner-${finding.id}-${key}`}
                      disabled={busy}
                      checked={owners.includes(key)}
                      onCheckedChange={(checked) =>
                        setOwners((previous) =>
                          checked
                            ? key === "undetermined"
                              ? [key]
                              : [
                                  ...previous.filter(
                                    (v) => v !== "undetermined",
                                  ),
                                  key,
                                ]
                            : previous.filter((v) => v !== key),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`owner-${finding.id}-${key}`}>
                      {label}
                    </FieldLabel>
                  </Field>
                ),
              )}
            </FieldGroup>
          </FieldSet>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !owners.length}
              onClick={async () => {
                setError("");
                if ((await onSave(owners)) !== false) setOpen(false);
                else setError("保存未完成，选择已保留，请重试。");
              }}
            >
              保存归属
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

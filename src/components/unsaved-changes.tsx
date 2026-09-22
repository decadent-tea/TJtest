import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function useUnsavedChanges(
  dirty: boolean,
  busy: boolean,
  onClose: () => void,
) {
  const [confirming, setConfirming] = useState(false);
  const pendingNavigation = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (busy) return;
      pendingNavigation.current = (event as CustomEvent<() => void>).detail;
      setConfirming(true);
    };
    window.addEventListener("studio:before-navigate", intercept);
    return () =>
      window.removeEventListener("studio:before-navigate", intercept);
  }, [dirty, busy]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const requestClose = () => {
    if (busy) return;
    pendingNavigation.current = undefined;
    if (dirty) setConfirming(true);
    else onClose();
  };
  const confirmation = (
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>
            当前修改尚未保存。可以继续编辑，或放弃修改并关闭。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => setConfirming(false)}
          >
            继续编辑
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const proceed = pendingNavigation.current;
              pendingNavigation.current = undefined;
              setConfirming(false);
              onClose();
              proceed?.();
            }}
          >
            放弃修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { requestClose, confirmation };
}

// Shared pieces: the server's snapshot, the hover card, and the one
// confirmation dialog every deletion goes through.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import { toast } from "sonner";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import type { rpcContract } from "./contract";
import { CHANGED, type Outcome, type Snapshot } from "./shared";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "./components/ui/button";
import { formatBytes, plural } from "./format";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

interface Confirmation {
  title: string;
  description: ReactNode;
  action: string;
  run: () => Promise<Outcome>;
}

interface Hover {
  x: number;
  y: number;
  content: ReactNode;
}

interface StorageState {
  snapshot: Snapshot | null;
  /** Bumps whenever the server's data changes, so folders refetch. */
  version: number;
  rpc: Rpc;
  confirm(request: Confirmation): void;
  hover(event: MouseEvent, content: ReactNode): void;
  unhover(): void;
}

const StorageContext = createContext<StorageState | null>(null);

export function useStorage(): StorageState {
  const state = useContext(StorageContext);
  if (!state) throw new Error("useStorage outside StorageProvider");
  return state;
}

export function StorageProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [hovered, setHovered] = useState<Hover | null>(null);
  const refetch = useCallback(() => {
    rpc.call("storageSnapshot").then(
      (next) => {
        setSnapshot(next);
        setVersion((v) => v + 1);
      },
      (cause: unknown) =>
        toast.error(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(CHANGED, refetch);
  const hover = useCallback(
    (event: MouseEvent, content: ReactNode) =>
      setHovered({ x: event.clientX, y: event.clientY, content }),
    [],
  );
  const unhover = useCallback(() => setHovered(null), []);
  const run = () => {
    if (!pending) return;
    toast.promise(pending.run(), {
      loading: "Cleaning…",
      success: ({ freed, failed }: Outcome) =>
        failed.length
          ? `Freed ${formatBytes(freed)}; ${plural(failed.length, "item")} couldn’t be deleted`
          : `Freed ${formatBytes(freed)}`,
      error: (cause: unknown) =>
        cause instanceof Error ? cause.message : "Couldn’t delete",
    });
    setPending(null);
  };
  const value = useMemo(
    () => ({ snapshot, version, rpc, confirm: setPending, hover, unhover }),
    [snapshot, version, rpc, hover, unhover],
  );
  return (
    <StorageContext.Provider value={value}>
      {children}
      {hovered && <HoverCard {...hovered} />}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base leading-none tracking-tight">
              {pending?.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">{pending?.description}</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>
              {pending?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StorageContext.Provider>
  );
}

/** A small card that follows the pointer and stays inside the window. */
function HoverCard({ x, y, content }: Hover) {
  const width = 260;
  const left = Math.min(x + 14, window.innerWidth - width - 8);
  const top = y + 16 + 120 > window.innerHeight ? y - 110 : y + 16;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left, top, width }}
    >
      {content}
    </div>
  );
}

/** The usual hover card body: dot, name, path, then size facts. */
export function HoverBody({
  color,
  name,
  path,
  facts,
}: {
  color: string;
  name: string;
  path?: string;
  facts: [string, string][];
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
      </div>
      {path && <p className="mt-0.5 truncate text-muted-foreground">{path}</p>}
      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {facts.map(([label, value]) => (
          <span key={label} className="contents">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums text-foreground">{value}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/** Ask before deleting one or more paths, then delete them on the server. */
export function useDelete() {
  const { confirm, rpc } = useStorage();
  return (items: { name: string; path: string; frees: number }[]) => {
    const frees = items.reduce((sum, item) => sum + item.frees, 0);
    const one = items.length === 1 ? items[0] : null;
    confirm({
      title: one ? `Delete “${one.name}”?` : `Delete ${items.length} items?`,
      description: (
        <>
          <p>Frees {formatBytes(frees)}. Can’t be undone.</p>
          {one && <p className="break-all font-mono text-xs">{one.path}</p>}
        </>
      ),
      action: "Delete",
      run: () =>
        rpc.call("storageDelete", { paths: items.map((item) => item.path) }),
    });
  };
}

/** The trash button a row shows on hover. */
export function DeleteButton({
  name,
  onClick,
}: {
  name: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete ${name}`}
      className="size-7 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
      onClick={onClick}
    >
      <Icon name="Trash2" className="size-3.5" />
    </Button>
  );
}

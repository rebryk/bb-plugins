import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_usePluginId,
  useComposer,
  useRpc,
  useSdk,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import type { rpcContract } from "./contract";
import {
  pageExpression,
  type PageState,
  type Pin,
  type Shortcut,
} from "./page";
import {
  PROVIDER,
  cropBox,
  noteIds,
  pageMessageSchema,
  pillLabel,
  samePage,
  withoutNote,
  type Note,
} from "./shared";

const warn = (error: unknown) => console.warn("[annotate]", error);
const COMMAND = "annotate-element";
const DEFAULT_SHORTCUT = {
  key: "a",
  mod: true,
  shift: true,
  alt: false,
  control: false,
  meta: false,
};
const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const platform = mac
  ? "mac"
  : /Win/.test(navigator.platform)
    ? "windows"
    : "linux";
const toEvent = (shortcut: typeof DEFAULT_SHORTCUT): Shortcut => ({
  key: shortcut.key.toLowerCase(),
  ctrlKey: shortcut.control || (shortcut.mod && !mac),
  altKey: shortcut.alt,
  shiftKey: shortcut.shift,
  metaKey: shortcut.meta || (shortcut.mod && mac),
});

/** The mounted toolbar controls, so the command finds the one on screen. */
const controls = new Set<{
  threadId: string;
  button: { current: HTMLButtonElement | null };
  toggle(): void;
}>();
const visibleControl = (threadId: string | null) =>
  [...controls].find(
    (control) =>
      (threadId === null || control.threadId === threadId) &&
      !!control.button.current?.getClientRects().length,
  );

/**
 * The command's shortcut as the user bound it in BB. The page matches it
 * itself, because BB does not see keys while a Browser page has the focus.
 * BB's config lists only the user's changes to plugin commands, so the
 * shortcut is the change for this platform, else the one for every platform,
 * else the default. BB leaves a default unbound when one of its own commands
 * has the same keys.
 */
function useShortcut(): Shortcut | null {
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);
  useEffect(() => {
    const refresh = () =>
      sdk.system.config().then((config) => {
        const command = `plugin:${pluginId}/${COMMAND}`;
        const changes = config.keybindingOverrides.filter(
          (change) => change.command === command,
        );
        const change =
          changes.find((item) => item.platform === platform) ??
          changes.find((item) => item.platform === undefined);
        const here = (when: { all: string[]; none: string[] }) =>
          !when.none.includes(`${platform}Platform`) &&
          !when.all.some(
            (key) => key.endsWith("Platform") && key !== `${platform}Platform`,
          );
        const same = (shortcut: typeof DEFAULT_SHORTCUT) =>
          JSON.stringify(toEvent(shortcut)) ===
          JSON.stringify(toEvent(DEFAULT_SHORTCUT));
        const taken =
          config.keybindings.some(
            (binding) => here(binding.when) && same(binding.shortcut),
          ) ||
          config.keybindingOverrides.some(
            (other) =>
              other.command !== command &&
              other.shortcut !== null &&
              (other.platform ?? platform) === platform &&
              same(other.shortcut),
          );
        const bound = change
          ? change.shortcut
          : taken
            ? null
            : DEFAULT_SHORTCUT;
        setShortcut(bound && toEvent(bound));
      }, warn);
    void refresh();
    const stops = [
      sdk.subscribe({ event: "system:config-changed", callback: refresh }),
      sdk.subscribe({ event: "realtime:connection", callback: refresh }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [sdk, pluginId]);
  return shortcut;
}

/** The part of a viewport screenshot around `element`, as a base64 JPEG. */
async function cropShot(
  shot: { base64: string; mimeType: string },
  element: Note["element"],
): Promise<string | null> {
  const crop = cropBox(element.view, element.viewport);
  if (!crop) return null;
  const image = new Image();
  image.src = `data:${shot.mimeType};base64,${shot.base64}`;
  await image.decode();
  const sx = image.naturalWidth / element.viewport.width;
  const sy = image.naturalHeight / element.viewport.height;
  const scale = Math.min(1, 1600 / Math.max(crop.width * sx, crop.height * sy));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * sx * scale));
  canvas.height = Math.max(1, Math.round(crop.height * sy * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(
    image,
    crop.x * sx,
    crop.y * sy,
    crop.width * sx,
    crop.height * sy,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? null;
}

function Icon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 14.5a2 2 0 0 1-2 2H8.5L4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M8.5 8.5h7M8.5 12h4.5" />
    </svg>
  );
}

/**
 * The Annotate button in the Browser's toolbar. It turns the picker on and
 * off, draws the pins of the draft's notes on the page, and turns what the
 * page sends into note pills in the thread's composer. One pick makes one
 * note: the picker turns off when the note is added or dropped.
 */
function AnnotateAction({
  threadId,
  tabId,
  url,
  isCompactViewport,
  experimental_page: page,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const [picking, setPicking] = useState(false);
  const shortcut = useShortcut();
  const button = useRef<HTMLButtonElement>(null);
  const [notes, setNotes] = useState<ReadonlyMap<string, Note>>(new Map());
  // Notes the page added whose pills are not in the draft yet.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const ids = noteIds(composer.draft);
  const idsKey = ids.join(" ");
  const remember = (note: Note) =>
    setNotes((current) => new Map(current).set(note.id, note));

  // Pills from before this control mounted, such as after a reload.
  useEffect(() => {
    const missing = ids.filter((id) => !notes.has(id));
    if (!missing.length) return;
    let live = true;
    rpc
      .call("getNotes", { threadId, ids: missing })
      .then((found) => {
        if (live) found.forEach(remember);
      })
      .catch(warn);
    return () => {
      live = false;
    };
  }, [idsKey, threadId]);

  const drafted = [...new Set([...ids, ...pending])].flatMap(
    (id) => notes.get(id) ?? [],
  );
  const pins: Pin[] = drafted
    .filter((note) => samePage(note.url, url))
    .map(({ id, number, comment, element }) => ({
      id,
      number,
      comment,
      selector: element.selector,
    }));
  const next = Math.max(0, ...drafted.map((note) => note.number)) + 1;
  // A new pick waits until the last note's screenshot is taken, so the
  // screenshot shows only that note.
  const state = JSON.stringify({
    picking: picking && !pending.size,
    next,
    pins,
    shortcut,
  });
  // The page handler reads these without subscribing again on every change.
  const latest = useRef({ notes, pending, state });
  latest.current = { notes, pending, state };
  const forget = (id: string) =>
    setPending((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  // Shows the latest state on the page, with `patch` on top. Only a page
  // without the script gets the whole script.
  const redraw = (patch: Partial<PageState> = {}) => {
    if (!page) return;
    const state = JSON.stringify({
      ...JSON.parse(latest.current.state),
      ...patch,
    });
    page
      .evaluate(`(globalThis.__bbAnnotate?.sync(${state}) ?? false)`)
      .then((installed) => installed || page.evaluate(pageExpression(state)))
      .catch(warn);
  };

  // The script goes into each page this control shows. It draws nothing
  // until there is something to show, but it listens for the shortcut.
  useEffect(() => {
    if (page) redraw();
  }, [page, url, state]);

  // A reload, also of the same URL, drops the script: put it back.
  useEffect(() => {
    if (!page) return;
    const timer = setInterval(() => {
      page
        .evaluate("(globalThis.__bbAnnotate?.sync({}) ?? false)")
        .then((installed) => installed || redraw())
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [page]);

  // While picking, Escape and ↑ also work when BB has the focus, as after a
  // click on this button or the shortcut in the composer.
  useEffect(() => {
    if (!page || !picking) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === "Escape") setPicking(false);
      else if (event.key === "ArrowUp" && !editable)
        page.evaluate("(globalThis.__bbAnnotate?.parent(), null)").catch(warn);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [page, picking]);

  useEffect(() => {
    const control = { threadId, button, toggle: () => setPicking((on) => !on) };
    controls.add(control);
    return () => {
      controls.delete(control);
    };
  }, [threadId]);

  useEffect(() => {
    if (!page) return;
    const unsubscribe = page.onMessage((data) => {
      const parsed = pageMessageSchema.safeParse(data);
      if (!parsed.success) {
        // Drop the pin the page drew for a note it could not describe.
        setPicking(false);
        return redraw({ picking: false });
      }
      const message = parsed.data;
      if (message.kind === "stop") setPicking(false);
      else if (message.kind === "toggle") setPicking((on) => !on);
      else if (message.kind === "delete") {
        forget(message.id);
        composer.replace((draft) => withoutNote(draft, message.id));
      } else if (message.kind === "edit") {
        const note = latest.current.notes.get(message.id);
        if (!note) return;
        const edited = { ...note, comment: message.comment };
        remember(edited);
        rpc.call("saveNote", { threadId, note: edited }).catch(warn);
      } else {
        const { kind: _, ...note } = message;
        // The note's pin stays on the page while its pill is on the way.
        remember(note);
        setPending((current) => new Set(current).add(note.id));
        setPicking(false);
        // The capture starts at once, while the page is still where the note
        // measured the element.
        const shot = rpc.call("captureNoteTab", { threadId, tabId });
        shot.catch(() => undefined);
        const screenshot = async () => {
          const base64 = await cropShot(await shot, note.element);
          if (base64)
            await rpc.call("saveNoteImage", { threadId, id: note.id, base64 });
        };
        void (async () => {
          await rpc.call("saveNote", { threadId, note });
          // The screenshot comes before the pill, so a message sent at once
          // has it too; a slow one gives up after 5 seconds.
          await Promise.race([
            screenshot().catch(warn),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
          // A note deleted from its pin in the meantime gets no pill.
          if (latest.current.pending.has(note.id))
            composer.insert(
              [
                { provider: PROVIDER, id: note.id, label: pillLabel(note) },
                " ",
              ],
              { at: "end" },
            );
        })()
          .catch(warn)
          .finally(() => forget(note.id));
      }
    });
    return () => {
      unsubscribe();
      // Pins and the shortcut without this control would answer no one; the
      // next mount sets them again.
      void page
        .evaluate(
          "(globalThis.__bbAnnotate?.sync({ picking: false, pins: [], shortcut: null }), null)",
        )
        .catch(() => undefined);
    };
  }, [page, threadId, tabId, rpc, composer]);

  useEffect(() => composer.onSubmitted(() => setPicking(false)), [composer]);

  if (!page) return null;
  return (
    <button
      ref={button}
      type="button"
      className="an-browser-button"
      aria-pressed={picking}
      aria-label={picking ? "Stop annotating" : "Annotate"}
      title={
        picking
          ? "Click an element to add a note. ↑ selects its parent; Esc cancels."
          : "Add a note to an element of this page"
      }
      onClick={() => setPicking(!picking)}
    >
      <Icon />
      {!isCompactViewport && <span>{picking ? "Cancel" : "Annotate"}</span>}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "annotate",
    title: "Annotate",
    component: AnnotateAction,
  });
  app.commands.register({
    id: COMMAND,
    title: "Annotate: Pick an element in the Browser",
    defaultShortcut: DEFAULT_SHORTCUT,
    isAvailable: ({ threadId }) => !!visibleControl(threadId),
    run: ({ threadId }) => visibleControl(threadId)?.toggle(),
  });
});

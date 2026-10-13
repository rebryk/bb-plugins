import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useComposer,
  useRpc,
  type ExperimentalPluginBrowserToolbarActionProps,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import type { rpcContract } from "./contract";
import { pageExpression, type Pin } from "./page";
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
 * page sends into note pills in the thread's composer.
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
  const [notes, setNotes] = useState<ReadonlyMap<string, Note>>(new Map());
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

  const drafted = ids.flatMap((id) => notes.get(id) ?? []);
  const pins: Pin[] = drafted
    .filter((note) => samePage(note.url, url))
    .map(({ id, number, comment, element }) => ({
      id,
      number,
      comment,
      selector: element.selector,
    }));
  const next = Math.max(0, ...drafted.map((note) => note.number)) + 1;
  const state = JSON.stringify({ picking, next, pins });
  // The page handler reads these without subscribing again on every change.
  const latest = useRef({ notes, state });
  latest.current = { notes, state };

  // Redraws the page from the latest state, also without the pin of a note
  // the page added but this control could not keep.
  const redraw = () => {
    page?.evaluate(pageExpression(latest.current.state)).catch(warn);
  };

  // The script goes into a page only once there is something to show there,
  // and stays until it shows nothing again.
  const active = picking || pins.length > 0;
  const shown = useRef(false);
  useEffect(() => {
    if (!page || (!active && !shown.current)) return;
    shown.current = active;
    redraw();
  }, [page, url, state]);

  // A reload, also of the same URL, drops the script: put it back.
  useEffect(() => {
    if (!page || !active) return;
    const timer = setInterval(() => {
      page
        .evaluate("(globalThis.__bbAnnotate?.sync({}) ?? false)")
        .then((installed) => installed || redraw())
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [page, active]);

  useEffect(() => {
    if (!page) return;
    const unsubscribe = page.onMessage((data) => {
      const parsed = pageMessageSchema.safeParse(data);
      if (!parsed.success) return redraw();
      const message = parsed.data;
      if (message.kind === "stop") setPicking(false);
      else if (message.kind === "delete")
        composer.replace((draft) => withoutNote(draft, message.id));
      else if (message.kind === "edit") {
        const note = latest.current.notes.get(message.id);
        if (!note) return;
        const edited = { ...note, comment: message.comment };
        remember(edited);
        rpc.call("saveNote", { threadId, note: edited }).catch(warn);
      } else {
        const { kind: _, ...note } = message;
        const screenshot = async () => {
          const shot = await rpc.call("captureNoteTab", { threadId, tabId });
          const base64 = await cropShot(shot, note.element);
          if (base64)
            await rpc.call("saveNoteImage", { threadId, id: note.id, base64 });
        };
        void (async () => {
          await rpc.call("saveNote", { threadId, note });
          remember(note);
          // The screenshot comes before the pill, so a message sent at once
          // has it too; a slow one gives up after 5 seconds.
          await Promise.race([
            screenshot().catch(warn),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
          composer.insert(
            [{ provider: PROVIDER, id: note.id, label: pillLabel(note) }, " "],
            { at: "end" },
          );
        })().catch((error: unknown) => {
          warn(error);
          redraw();
        });
      }
    });
    return () => {
      unsubscribe();
      // Pins without this control would answer no one; the next mount
      // draws them again.
      void page
        .evaluate(
          "(globalThis.__bbAnnotate?.sync({ picking: false, pins: [] }), null)",
        )
        .catch(() => undefined);
    };
  }, [page, threadId, tabId, rpc, composer]);

  useEffect(() => composer.onSubmitted(() => setPicking(false)), [composer]);

  if (!page) return null;
  return (
    <button
      type="button"
      className="an-browser-button"
      aria-pressed={picking}
      aria-label={picking ? "Stop annotating" : "Annotate"}
      title={
        picking
          ? "Click an element to add a note. ↑ selects its parent; Esc stops."
          : "Add notes to elements of this page"
      }
      onClick={() => setPicking(!picking)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && picking) setPicking(false);
      }}
    >
      <Icon />
      {!isCompactViewport && <span>{picking ? "Done" : "Annotate"}</span>}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "annotate",
    title: "Annotate",
    component: AnnotateAction,
  });
});

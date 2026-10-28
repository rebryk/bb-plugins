import { definePluginApp, useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";
import "./app.css";
import { TodoList } from "./todo-list";

/** On the new-thread screen: puts the to-do into the draft and focuses it. */
function ComposerTodoList() {
  const composer = useComposer();
  return (
    <TodoList onStartThread={(text) => {
      composer.insert(text, { at: "end", block: true });
      composer.focus();
    }} />
  );
}

/** In a thread: opens a new thread with the to-do as its prompt. */
function ThreadTodoList() {
  const navigate = useBbNavigate();
  return (
    <TodoList onStartThread={(text) =>
      navigate.toCompose({ initialPrompt: text, focusPrompt: true })} />
  );
}

export default definePluginApp((app) => {
  const tab = { id: "todo", title: "To-do", icon: "CircleCheck" } as const;
  app.slots.homepageSection({ id: "todo-list", title: "To-do", component: ComposerTodoList });
  app.slots.experimental_tab({
    ...tab,
    context: { kind: "thread" },
    availability: "action",
    component: ThreadTodoList,
  });
  app.slots.experimental_newThreadPanelAction({ ...tab, component: ComposerTodoList });
});

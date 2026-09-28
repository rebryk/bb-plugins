/**
 * Lets app.css move BB's bars to the bottom on a phone until the returned
 * function runs.
 */
export function startPhoneLayout(doc: Document): () => void {
  const root = doc.documentElement;
  root.dataset.phoneLayout = "";
  return () => {
    delete root.dataset.phoneLayout;
  };
}

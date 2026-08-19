/**
 * Navigate within the SPA without tearing down the React tree.
 *
 * The router observes the synthetic popstate event and updates its pathname
 * state. Same-origin validation keeps this helper from becoming an accidental
 * external redirect primitive.
 */
export function navigateInApp(path: string, replace = false): void {
  const nextUrl = new URL(path, window.location.origin);
  if (nextUrl.origin !== window.location.origin) {
    throw new Error("In-app navigation requires a same-origin path.");
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentPath === nextPath) return;

  if (replace) {
    window.history.replaceState(null, "", nextPath);
  } else {
    window.history.pushState(null, "", nextPath);
  }

  window.dispatchEvent(new Event("popstate"));
}

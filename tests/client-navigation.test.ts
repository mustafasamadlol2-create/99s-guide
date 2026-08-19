import assert from "node:assert/strict";
import test from "node:test";

import { navigateInApp } from "../src/core/routing/clientNavigation.ts";

type HistoryCall = {
  method: "pushState" | "replaceState";
  path: string;
};

function installFakeWindow(initialPath = "/") {
  const url = new URL(`https://app.test${initialPath}`);
  const historyCalls: HistoryCall[] = [];
  const events: string[] = [];

  const syncLocation = (nextPath: string) => {
    const nextUrl = new URL(nextPath, url.origin);
    url.pathname = nextUrl.pathname;
    url.search = nextUrl.search;
    url.hash = nextUrl.hash;
  };

  const fakeWindow = {
    location: {
      get origin() {
        return url.origin;
      },
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get hash() {
        return url.hash;
      },
    },
    history: {
      pushState: (_state: unknown, _title: string, nextPath: string) => {
        historyCalls.push({ method: "pushState", path: nextPath });
        syncLocation(nextPath);
      },
      replaceState: (_state: unknown, _title: string, nextPath: string) => {
        historyCalls.push({ method: "replaceState", path: nextPath });
        syncLocation(nextPath);
      },
    },
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  } as unknown as Window;

  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  return {
    historyCalls,
    events,
    restore: () => {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    },
  };
}

test("navigates legal routes in-app without a document reload", () => {
  const browser = installFakeWindow();

  try {
    navigateInApp("/privacy");

    assert.deepEqual(browser.historyCalls, [
      { method: "pushState", path: "/privacy" },
    ]);
    assert.deepEqual(browser.events, ["popstate"]);
  } finally {
    browser.restore();
  }
});

test("supports replacing the route for an in-app fallback", () => {
  const browser = installFakeWindow("/privacy");

  try {
    navigateInApp("/", true);

    assert.deepEqual(browser.historyCalls, [
      { method: "replaceState", path: "/" },
    ]);
    assert.deepEqual(browser.events, ["popstate"]);
  } finally {
    browser.restore();
  }
});

test("ignores an in-app navigation to the current URL", () => {
  const browser = installFakeWindow("/privacy");

  try {
    navigateInApp("/privacy");

    assert.deepEqual(browser.historyCalls, []);
    assert.deepEqual(browser.events, []);
  } finally {
    browser.restore();
  }
});

test("rejects cross-origin destinations", () => {
  const browser = installFakeWindow();

  try {
    assert.throws(() => navigateInApp("https://evil.test/privacy"), /same-origin/);
    assert.deepEqual(browser.historyCalls, []);
    assert.deepEqual(browser.events, []);
  } finally {
    browser.restore();
  }
});

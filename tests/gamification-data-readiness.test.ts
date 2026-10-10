import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { GamificationFeatureState } from "../src/features/gamification/GamificationFeatureState.js";

const tx = (_key: string, en: string, ar: string) => en;

function render(status: "loading" | "ready" | "unavailable", enabled: boolean, language = "en") {
  return renderToStaticMarkup(React.createElement(GamificationFeatureState, {
    status,
    enabled,
    onRetry: () => {},
    tx: (_key, en, ar) => language === "ar" ? ar : en,
  }));
}

test("Study Engagement availability renders loading, failed-check, and disabled states separately", () => {
  const loading = render("loading", false, "ar");
  assert.match(loading, /role="status"/u);
  assert.match(loading, /جارٍ التحقق من توفر التفاعل الدراسي/u);

  const unavailable = render("unavailable", false);
  assert.match(unavailable, /role="alert"/u);
  assert.match(unavailable, /availability could not be checked/u);

  const disabled = render("ready", false);
  assert.match(disabled, /role="status"/u);
  assert.match(disabled, /Study engagement is disabled/u);

  assert.equal(render("ready", true), "");
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import rule from "./no-bare-ui-text.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const imports = 'import { getLang, uiText, useLang } from "@/lib/i18n";\n';

// A module whose helpers read the language and are bound by its hook.
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmed-lang-rule-"));
fs.mkdirSync(path.join(projectDir, "src", "model"), { recursive: true });
fs.mkdirSync(path.join(projectDir, "src", "ui"), { recursive: true });
fs.writeFileSync(
  path.join(projectDir, "src", "model", "labels.ts"),
  [
    'import { uiText, useLanguageBound } from "@/lib/i18n";',
    'export function statusLabel(status: string) { return uiText(`status_${status}`); }',
    "export function pureName(name: string) { return name.trim(); }",
    "export const STATUS_LANGUAGE_HELPERS = {",
    "  statusLabel,",
    "};",
    "export function useStatusLabels() {",
    "  return useLanguageBound(STATUS_LANGUAGE_HELPERS);",
    "}",
    "",
  ].join("\n"),
);
afterAll(() => fs.rmSync(projectDir, { recursive: true, force: true }));
const cardFile = path.join(projectDir, "src", "ui", "card.tsx");

const localHelpers = [
  'import { uiText, useLanguageBound } from "@/lib/i18n";',
  "function priorityLabel(value: string) { return uiText(`priority_${value}`); }",
  "const LANGUAGE_HELPERS = {",
  "  priorityLabel,",
  "};",
  "function useLanguageHelpers() {",
  "  return useLanguageBound(LANGUAGE_HELPERS);",
  "}",
  "",
].join("\n");

tester.run("no-bare-ui-text", rule, {
  valid: [
    // The language of the component is passed on.
    `${imports}export function Card() { const { lang } = useLang(); return <p>{uiText("card_title", lang)}</p>; }`,
    `${imports}export function useLabel(key: string) { const { lang } = useLang(); return uiText(key, lang, { count: 1 }); }`,
    // Module helpers and non-component functions are not render code.
    `${imports}function label(key: string) { return uiText(key); }`,
    `${imports}export async function loadThing() { return getLang(); }`,
    // An effect reads the language of its moment.
    `${imports}export function Sync() { useEffect(() => { document.title = uiText("title"); }, []); return null; }`,
    // A local variable named uiText is not the catalog lookup.
    `export function Local({ uiText }: { uiText: (key: string) => string }) { return <p>{uiText("x")}</p>; }`,
    // Language-reading helpers taken from the module's hook.
    {
      filename: cardFile,
      code: 'import { pureName, useStatusLabels } from "@/model/labels";\nexport function Card({ status }: { status: string }) { const { statusLabel } = useStatusLabels(); return <p>{statusLabel(status)} {pureName(" x ")}</p>; }',
    },
    {
      filename: cardFile,
      code: `${localHelpers}export function Row({ value }: { value: string }) { const { priorityLabel } = useLanguageHelpers(); return <span>{priorityLabel(value)}</span>; }`,
    },
    // Outside components the module function is fine.
    {
      filename: cardFile,
      code: 'import { statusLabel } from "@/model/labels";\nexport function describeStatus(status: string) { return statusLabel(status); }',
    },
  ],
  invalid: [
    {
      code: `${imports}export function Card() { return <p>{uiText("card_title")}</p>; }`,
      errors: [{ messageId: "uiText" }],
    },
    {
      code: `${imports}export function Card() { return <p>{uiText("card_count", undefined, { count: 2 })}</p>; }`,
      errors: [{ messageId: "uiText" }],
    },
    {
      code: `${imports}export const Row = memo(function Row() { return <span>{uiText("row")}</span>; });`,
      errors: [{ messageId: "uiText" }],
    },
    {
      code: `${imports}export const Row = ({ items }: { items: string[] }) => <ul>{items.map((item) => <li key={item}>{uiText(item)}</li>)}</ul>;`,
      errors: [{ messageId: "uiText" }],
    },
    {
      code: `${imports}export function usePageContent() { const lang = getLang(); return lang; }`,
      errors: [{ messageId: "getLang" }],
    },
    // A listed helper used straight from its module, imported or local.
    {
      filename: cardFile,
      code: 'import { statusLabel as label } from "@/model/labels";\nexport function Card({ status }: { status: string }) { return <p>{label(status)}</p>; }',
      errors: [{ messageId: "helper", data: { owner: "Card", name: "label", hook: "useStatusLabels" } }],
    },
    {
      filename: cardFile,
      code: 'import { statusLabel } from "../model/labels";\nexport function useCardTitle(status: string) { return statusLabel(status); }',
      errors: [{ messageId: "helper" }],
    },
    {
      filename: cardFile,
      code: `${localHelpers}export function Row({ value }: { value: string }) { return <span>{[value].map(priorityLabel)}</span>; }`,
      errors: [{ messageId: "helper", data: { owner: "Row", name: "priorityLabel", hook: "useLanguageHelpers" } }],
    },
  ],
});

/**
 * React Compiler memoizes what a component computes from its reactive inputs
 * (props, state, hook results). `uiText(key)` without a language and
 * `getLang()` read the language from localStorage, which the compiler does not
 * see: their result is cached, and a live RU→DE switch keeps the old text
 * until the component remounts (QA 2026-10-11, task cards). Inside a
 * component or hook the language comes from `useLang()` and is passed on:
 * `uiText(key, lang)`. Effect callbacks are exempt (they never run during
 * render).
 *
 * Helpers outside components that read the language themselves
 * (`appointmentText`, `statusLabel` …) are listed in their module's
 * `*_LANGUAGE_HELPERS` object and bound to the current language by the
 * module's hook (`useLanguageBound`). Components and hooks take them from that
 * hook; a direct reference to a listed helper is reported.
 */

import fs from "node:fs";
import path from "node:path";

const COMPONENT_NAME = /^[A-Z]/;
const HOOK_NAME = /^use[A-Z0-9]/;
const WRAPPERS = new Set(["memo", "forwardRef"]);

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

function functionName(fn) {
  if (fn.id?.type === "Identifier") return fn.id.name;
  let parent = fn.parent;
  // memo(function Row() {}) / forwardRef((props, ref) => …) assigned to a const.
  while (parent?.type === "CallExpression" && WRAPPERS.has(calleeName(parent.callee))) {
    parent = parent.parent;
  }
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  return null;
}

function isFunction(node) {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** An effect callback never runs during render and reads the language of its moment. */
function isEffectCallback(fn) {
  const parent = fn.parent;
  return (
    parent?.type === "CallExpression" &&
    parent.arguments[0] === fn &&
    EFFECT_HOOKS.has(calleeName(parent.callee))
  );
}

/** The component or hook the call is written in (at any depth), if any. */
function enclosingComponentOrHook(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunction(current)) continue;
    if (isEffectCallback(current)) return null;
    const name = functionName(current);
    if (name && (COMPONENT_NAME.test(name) || HOOK_NAME.test(name))) return name;
  }
  return null;
}

function isImported(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable.defs.some((def) => def.type === "ImportBinding");
  }
  return false;
}

function withoutLanguage(call) {
  const lang = call.arguments[1];
  return !lang || (lang.type === "Identifier" && lang.name === "undefined");
}

// A module lists the helpers that read the UI language in
// `const XXX_LANGUAGE_HELPERS = { a, b }` (or `LANGUAGE_HELPERS` for helpers of
// its own components) and binds them in a hook: `return useLanguageBound(XXX)`.
const HELPERS_OBJECT = /(?:^|\n)(?:export\s+)?const\s+(\w*LANGUAGE_HELPERS)\s*=\s*\{([^}]*)\}/g;

function languageHelpers(text) {
  const objects = [];
  for (const match of text.matchAll(HELPERS_OBJECT)) {
    const [, constant, body] = match;
    const names = body
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[A-Za-z_$][\w$]*$/.test(entry));
    const hookMatch = new RegExp(
      `function\\s+(use\\w+)\\s*\\(\\s*\\)\\s*\\{\\s*return\\s+useLanguageBound\\(\\s*${constant}\\s*\\)`,
    ).exec(text);
    objects.push({ constant, names: new Set(names), hook: hookMatch?.[1] ?? `useLanguageBound(${constant})` });
  }
  return objects;
}

const moduleHelpersCache = new Map();

function resolveModuleFile(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    const srcIndex = fromFile.replace(/\\/g, "/").lastIndexOf("/src/");
    if (srcIndex < 0) return null;
    base = path.join(fromFile.slice(0, srcIndex + 5), specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

function moduleLanguageHelpers(file) {
  if (!moduleHelpersCache.has(file)) {
    let objects = [];
    try {
      objects = languageHelpers(fs.readFileSync(file, "utf8"));
    } catch {
      objects = [];
    }
    moduleHelpersCache.set(file, objects);
  }
  return moduleHelpersCache.get(file);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Inside components and hooks, pass the current language from useLang() to uiText, do not read getLang(), and take the language-reading helpers of a module from its language-bound hook",
    },
    schema: [],
    messages: {
      uiText:
        "{{owner}}: pass the language from useLang() — uiText(key, lang). Without it React Compiler keeps the old text after a language switch.",
      getLang:
        "{{owner}}: use `lang` from useLang() instead of getLang(). React Compiler does not re-run getLang() after a language switch.",
      helper:
        "{{owner}}: take `{{name}}` from {{hook}}() — the module function reads the language itself, and React Compiler keeps its old text after a language switch.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.filename;
    // local name -> hook that binds it
    const tracked = new Map();
    return {
      Program(node) {
        for (const object of languageHelpers(sourceCode.getText(node))) {
          for (const name of object.names) tracked.set(name, object.hook);
        }
      },
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const file = resolveModuleFile(filename, String(node.source.value));
        if (!file) return;
        const objects = moduleLanguageHelpers(file);
        if (objects.length === 0) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const imported = specifier.imported.name ?? specifier.imported.value;
          const object = objects.find((candidate) => candidate.names.has(imported));
          if (object) tracked.set(specifier.local.name, object.hook);
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const name = node.callee.name;
        if (name !== "uiText" && name !== "getLang") return;
        if (name === "uiText" && !withoutLanguage(node)) return;
        const owner = enclosingComponentOrHook(node);
        if (!owner || !isImported(sourceCode, node, name)) return;
        context.report({ node, messageId: name, data: { owner } });
      },
      "Program:exit"(node) {
        if (tracked.size === 0) return;
        const moduleScope = sourceCode.getScope(node).childScopes.find((scope) => scope.type === "module") ?? sourceCode.getScope(node);
        for (const [name, hook] of tracked) {
          const variable = moduleScope.set.get(name);
          if (!variable) continue;
          for (const reference of variable.references) {
            const owner = enclosingComponentOrHook(reference.identifier);
            if (!owner) continue;
            context.report({ node: reference.identifier, messageId: "helper", data: { owner, name, hook } });
          }
        }
      },
    };
  },
};

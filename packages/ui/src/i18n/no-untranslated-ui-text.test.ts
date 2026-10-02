import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A real syntax-tree scan, not a hand-picked list of literals (see
// no-hardcoded-strings.test.ts, which only guards specific strings and so
// missed whole pages). Walks every .tsx file in all three apps and the
// shared UI package and fails on any user-visible English that isn't routed
// through t(): JSX text, user-facing attributes (placeholder/title/aria-*,
// DataTable header/emptyMessage, ...), string literals inside JSX
// expressions and ternaries, and toast/confirm/set*Error messages.
const ROOT = resolve(import.meta.dirname, "../../../..");
const SOURCE_DIRS = ["frontend/src", "merchant-dashboard/src", "admin-dashboard/src", "packages/ui/src"];

// Text that is intentionally not translated: the brand name, the ISO
// currency code, a keyboard-shortcut hint, the literal CSV column tokens
// shown in the bulk-upload format guide, and the stored default value of an
// address label (its displayed text is translated at render time).
const ALLOWED_TEXT = new Set(["Tolo", "ETB", "Ctrl K", "category", "attributes", "key:value", "color:Red, size:M", "image_url", "Home"]);
// MockGateway is a developer tool that stands in for a third-party page.
const EXCLUDED_FILES = new Set(["MockGateway.tsx"]);

const USER_FACING_ATTRS = /^(placeholder|title|aria-label|ariaLabel|alt|label|emptyMessage|description|header|subtitle|helperText)$/;
const IGNORED_ATTRS = new Set(["className", "style", "type", "href", "to", "key", "id", "name", "value", "src", "viewBox", "d", "fill", "stroke", "role", "rel", "target", "autoComplete", "inputMode", "pattern", "htmlFor", "storageKey", "width", "height", "points", "transform", "xmlns"]);
const PROP_NAMES = /^(label|title|description|message|header|emptyMessage|placeholder|ariaLabel|text)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "locales"].includes(entry.name)) sourceFiles(path, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) && !EXCLUDED_FILES.has(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => "${}" + span.literal.text).join("");
  return null;
}

const hasWords = (text: string) => /[A-Za-z]{3,}/.test(text);

function findProblems(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const report = (node: ts.Node, kind: string, text: string) => {
    if (ALLOWED_TEXT.has(text.trim())) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    problems.push(`${relative(ROOT, file).split(sep).join("/")}:${line} ${kind} "${text.slice(0, 80)}"`);
  };

  // Visits the string-literal branches of a ternary / && / ?? expression.
  const visitBranches = (expr: ts.Expression, kind: string) => {
    const text = literalText(expr);
    if (text !== null) {
      if (hasWords(text) && /[A-Z][a-z]+|[a-z]+ [a-z]+/.test(text)) report(expr, kind, text);
    } else if (ts.isConditionalExpression(expr)) {
      visitBranches(expr.whenTrue, kind);
      visitBranches(expr.whenFalse, kind);
    } else if (ts.isBinaryExpression(expr)) {
      visitBranches(expr.right, kind);
    } else if (ts.isParenthesizedExpression(expr)) {
      visitBranches(expr.expression, kind);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (text && hasWords(text)) report(node, "JSX text", text);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText();
      if (ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        const looksLikeProse = !IGNORED_ATTRS.has(name) && /\s/.test(value.trim()) && !/^[a-z0-9:_\-\s/[\].%#()]+$/.test(value);
        if (hasWords(value) && (USER_FACING_ATTRS.test(name) || looksLikeProse)) report(node, `attribute ${name}`, value);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression && USER_FACING_ATTRS.test(name)) {
        visitBranches(node.initializer.expression, `attribute ${name}`);
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      visitBranches(node.expression, "JSX expression");
    } else if (ts.isPropertyAssignment(node) && PROP_NAMES.test(node.name.getText())) {
      const text = literalText(node.initializer);
      if (text !== null && /[A-Z][a-z]+ [A-Za-z]+|^[A-Z][a-z]{3,}$/.test(text)) report(node, `property ${node.name.getText()}`, text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const first = node.arguments[0];
      const isMessageCall =
        /^toast\.(error|success|info|warning)$/.test(callee) ||
        /^(confirm|alert|window\.prompt|window\.confirm)$/.test(callee) ||
        /^set(Error|Message|Notice|FormError|CredError)$/.test(callee);
      if (isMessageCall && first) {
        const text = literalText(first);
        if (text !== null && hasWords(text)) report(node, `${callee}()`, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

describe("no untranslated user-facing text in any app or the shared UI package", () => {
  for (const dir of SOURCE_DIRS) {
    it(`${dir} routes every visible string through t()`, () => {
      const problems = sourceFiles(resolve(ROOT, dir)).flatMap(findProblems);
      expect(problems, `Untranslated UI text found:\n${problems.join("\n")}`).toEqual([]);
    });
  }
});

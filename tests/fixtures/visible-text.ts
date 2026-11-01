import ts from "typescript";

// The text a person can read in a source file, found in the code's syntax tree: string literals, template text, text inside page markup, and
// quoted values inside a database query. Identifiers, imports, comments, types and the words of a query are not text. Shared by the tests that
// scan every screen, email and message (banned words, and the Zoom and Google Meet switch).
export type Found = { text: string; line: number };
const SQL_TAG = /^(sql(\(\))?|db|tx|[a-z]+\.sql)$/;
const IGNORED_ATTRS = new Set(["className", "key", "htmlFor", "id", "type", "role", "name", "d", "viewBox", "fill", "stroke", "width", "height", "style"]);
// A lowercase word or key such as "agency", "client_view" or "a:b" is an internal code, not a sentence.
export const CODE_LIKE = /^[a-z0-9_.:\-/]+$/;

export function visibleText(source: string, fileName = "x.tsx"): Found[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Found[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (text: string, node: ts.Node) => { if (text.trim()) out.push({ text, line: lineOf(node) }); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node)) return;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isTaggedTemplateExpression(node) && SQL_TAG.test(node.tag.getText(sf))) {
      node.template.forEachChild(visitInsideSql);
      const chunks = ts.isNoSubstitutionTemplateLiteral(node.template) ? [node.template.text] : [node.template.head.text, ...node.template.templateSpans.map((s) => s.literal.text)];
      for (const chunk of chunks) for (const m of chunk.matchAll(/'([^']*)'/g)) add(m[1], node.template);
      return;
    }
    if (ts.isCallExpression(node) && /\.unsafe$/.test(node.expression.getText(sf))) return;
    if (ts.isJsxAttribute(node) && IGNORED_ATTRS.has(node.name.getText(sf))) return;
    if (ts.isJsxText(node)) add(node.getText(sf), node);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const comparing = (ts.isBinaryExpression(p) && /^[!=]==?$/.test(p.operatorToken.getText(sf))) || ts.isCaseClause(p) || ts.isElementAccessExpression(p);
      if (!comparing) add(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      node.templateSpans.forEach((s) => add(s.literal.text, s.literal));
    }
    ts.forEachChild(node, visit);
  };
  // Expressions inside a query (${...}) can still hold text, but the query words themselves are not text.
  const visitInsideSql = (node: ts.Node) => { if (ts.isTemplateSpan(node)) visit(node.expression); else ts.forEachChild(node, visitInsideSql); };
  visit(sf);
  return out;
}


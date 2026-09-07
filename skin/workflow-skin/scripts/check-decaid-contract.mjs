// Compare the skin's actual REST calls and telemetry subscriptions with an
// independently checked-out Decaid release, without contacting a machine.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const upstream = process.argv[2];
if (!upstream) throw new Error("Usage: node scripts/check-decaid-contract.mjs /path/to/decaid-release");
const root = fileURLToPath(new URL("../", import.meta.url));
const rest = await readFile(resolve(upstream, "assets/api/rest_v1.yml"), "utf8");
const websocket = await readFile(resolve(upstream, "assets/api/websocket_v1.yml"), "utf8");
const routes = [];
let route;
for (const line of rest.split("\n")) {
  const path = line.match(/^  (\/api\/[^:]+):$/);
  if (path) {
    route = { path: path[1], methods: [] };
    routes.push(route);
  }
  const method = line.match(/^    (get|put|post|delete|patch):$/);
  if (method && route) route.methods.push(method[1].toUpperCase());
}
const wsPaths = [...websocket.matchAll(/^    address: (.+)$/gm)].map((match) => `/${match[1]}`);
const legacy = new Set([
  "GET /api/v1/kv/{value}/{value}",
  "PUT /api/v1/kv/{value}/{value}",
  "POST /api/v1/devices/connect"
]);
function pathText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) =>
    (ts.isConditionalExpression(span.expression) ? "" : "{value}") + span.literal.text
  ).join("");
}
function matches(template, path) {
  return new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path);
}
const failures = [];
const checked = new Set();
const fallbacks = new Set();
for (const name of ["src/api/reaprime.ts", "src/state/useLiveTelemetry.ts"]) {
  const source = ts.createSourceFile(name, await readFile(resolve(root, name), "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length) {
      const callee = node.expression.getText(source);
      const path = pathText(node.arguments[0])?.split("?")[0];
      if (callee === "this.request" && path?.startsWith("/api/")) {
        const init = node.arguments[1];
        const methodProperty = init && ts.isObjectLiteralExpression(init)
          ? init.properties.find((property) => property.name?.getText(source) === "method") : null;
        const method = methodProperty && ts.isPropertyAssignment(methodProperty)
          ? pathText(methodProperty.initializer) : "GET";
        // callPluginEndpoint is intentionally dynamic; inspect each caller separately.
        const key = `${method ?? "DYNAMIC"} ${path}`;
        if (legacy.has(key)) fallbacks.add(key);
        else if (!routes.some((candidate) => matches(candidate.path, path) && (method === null || candidate.methods.includes(method)))) failures.push(key);
        else checked.add(key);
      }
      if (callee === "connect" && path?.startsWith("/ws/")) {
        if (!wsPaths.includes(path)) failures.push(`WS ${path}`);
        else checked.add(`WS ${path}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) throw new Error(`Unsupported Decaid API calls:\n${failures.join("\n")}`);
console.log(`Validated ${checked.size} REST/telemetry contracts against ${upstream}.`);
console.log(`Retained ${fallbacks.size} explicit legacy fallbacks (not part of the current API).`);
console.log("Payload semantics, plugin commands, and physical devices require their separate checks.");

// Minimal Model Context Protocol server over HTTP (JSON-RPC 2.0, one request per POST).
// Pure protocol handling with injected tools, so it is unit tested without a database.

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export const PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

const error = (id: JsonRpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const result = (id: JsonRpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });

/** Returns the JSON-RPC response, or null for notifications (which get no body). */
export async function handleRpc(body: unknown, tools: ToolDef[], serverVersion = "1.0.0"): Promise<object | null> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return error(null, -32600, "Invalid request");
  const req = body as JsonRpcRequest;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return error(req.id, -32600, "Invalid request");
  const isNotification = req.id === undefined;

  switch (req.method) {
    case "initialize": {
      const asked = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : PROTOCOL_VERSION;
      return result(req.id, {
        protocolVersion: SUPPORTED.has(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "subsync", version: serverVersion },
        instructions: "Read-only access to an agency's client accounts: health scores, stale deals, waiting conversations, alerts and contact search.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return result(req.id, {});
    case "tools/list":
      return result(req.id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = req.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return error(req.id, -32602, `Unknown tool: ${String(name)}`);
      const args = (req.params?.arguments && typeof req.params.arguments === "object" ? req.params.arguments : {}) as Record<string, unknown>;
      try {
        const out = await tool.run(args);
        return result(req.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // Tool failures are reported to the model, not as protocol errors.
        return result(req.id, { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : "Tool failed" }] });
      }
    }
    default:
      return isNotification ? null : error(req.id, -32601, `Method not found: ${req.method}`);
  }
}

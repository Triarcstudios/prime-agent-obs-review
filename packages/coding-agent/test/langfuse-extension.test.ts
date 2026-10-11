import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import langfuse from "../examples/extensions/langfuse.js";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.js";

const CONTENT = "private-content-7f3a";
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function load() {
	const handlers = new Map<string, Handler>();
	langfuse({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as unknown as ExtensionAPI);
	return handlers;
}

function stubCredentials(enabled: string | undefined) {
	vi.stubEnv("PI_LANGFUSE_ENABLED", enabled);
	vi.stubEnv("LANGFUSE_HOST", "http://127.0.0.1:9");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "test-public");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "test-secret");
	vi.stubEnv("PI_OTEL_TRACE_ENDPOINT", "http://127.0.0.1:9/v1/traces");
	vi.stubEnv("PI_OTEL_AUTHORIZATION", "Basic collector-test");
}

afterEach(() => vi.unstubAllEnvs());
it.each([false, true])("exports one content-free root span (collector=%s)", async (collector) => {
	const received: { path?: string; auth?: string; version?: string | string[]; body: string }[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		received.push({
			path: req.url,
			auth: req.headers.authorization,
			version: req.headers["x-langfuse-ingestion-version"],
			body,
		});
		res.end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing server address");
		stubCredentials("1");
		vi.stubEnv("LANGFUSE_HOST", collector ? "" : `http://127.0.0.1:${address.port}`);
		vi.stubEnv("PI_OTEL_TRACE_ENDPOINT", collector ? `http://127.0.0.1:${address.port}/v1/traces` : "");
		vi.stubEnv("PI_OTEL_AUTHORIZATION", collector ? "Basic collector-test" : "");
		const handlers = load();
		const text = [{ type: "text", text: CONTENT }];
		const ctx = {
			cwd: `/work/${CONTENT}`,
			model: { id: "test-model", name: CONTENT },
			getSystemPrompt: () => CONTENT,
			sessionManager: { getSessionId: () => "test-session", getEntries: () => [{ content: text }] },
		} as unknown as ExtensionContext;
		const events = [
			{ type: "before_agent_start", prompt: CONTENT, systemPrompt: CONTENT },
			{ type: "agent_start" },
			{ type: "message_end", message: { role: "user", content: text } },
			{ type: "tool_execution_end", toolName: "bash", result: { content: text } },
			{
				type: "agent_end",
				messages: [
					{ role: "user", content: text },
					{ role: "assistant", content: text },
				],
			},
		];
		for (const event of events) await handlers.get(event.type)?.(event, ctx);
		expect(received).toHaveLength(1);
		const [request] = received;
		expect(request).toMatchObject({
			path: collector ? "/v1/traces" : "/api/public/otel/v1/traces",
			auth: collector
				? "Basic collector-test"
				: `Basic ${Buffer.from("test-public:test-secret").toString("base64")}`,
			version: "4",
		});
		expect(request.body).not.toContain(CONTENT);
		expect(request.body).not.toContain("test-secret");
		const [resourceSpan] = JSON.parse(request.body).resourceSpans;
		const [span] = resourceSpan.scopeSpans[0].spans;
		expect(resourceSpan.resource.attributes).toEqual([
			{ key: "service.name", value: { stringValue: "prime-agent" } },
		]);
		expect(Object.keys(span).sort()).toEqual([
			"attributes",
			"endTimeUnixNano",
			"kind",
			"name",
			"spanId",
			"startTimeUnixNano",
			"traceId",
		]);
		expect(span).toMatchObject({
			name: "pi.agent",
			traceId: expect.stringMatching(/^[a-f0-9]{32}$/),
			spanId: expect.stringMatching(/^[a-f0-9]{16}$/),
		});
		expect(span.attributes).toEqual([
			{ key: "langfuse.observation.type", value: { stringValue: "agent" } },
			{ key: "langfuse.session.id", value: { stringValue: "test-session" } },
			{ key: "gen_ai.request.model", value: { stringValue: "test-model" } },
		]);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
it.each([undefined, "", "0", "true", "yes"])(
	"is off unless PI_LANGFUSE_ENABLED=1 (%s) with credentials set",
	(enabled) => {
		stubCredentials(enabled);
		expect(load().size).toBe(0);
	},
);

it.each([
	{
		name: "numeric rejection",
		status: 200,
		body: JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: CONTENT } }),
		errors: ["Langfuse tracing FAIL: collector rejected spans"],
		warnings: [],
	},
	{
		name: "string rejection",
		status: 200,
		body: JSON.stringify({ partialSuccess: { rejectedSpans: "1", errorMessage: CONTENT } }),
		errors: ["Langfuse tracing FAIL: collector rejected spans"],
		warnings: [],
	},
	{
		name: "zero rejected with warning",
		status: 200,
		body: JSON.stringify({ partialSuccess: { rejectedSpans: "0", errorMessage: CONTENT } }),
		errors: [],
		warnings: ["Langfuse tracing WARN: collector reported a warning"],
	},
	{
		name: "zero rejected",
		status: 200,
		body: JSON.stringify({ partialSuccess: { rejectedSpans: 0 } }),
		errors: [],
		warnings: [],
	},
	{ name: "full success", status: 200, body: "{}", errors: [], warnings: [] },
	{ name: "empty success", status: 200, body: "", errors: [], warnings: [] },
	{
		name: "invalid acknowledgement",
		status: 200,
		body: CONTENT,
		errors: ["Langfuse tracing FAIL: export unavailable"],
		warnings: [],
	},
	{ name: "HTTP failure", status: 503, body: CONTENT, errors: ["Langfuse tracing FAIL: HTTP 503"], warnings: [] },
])(
	"handles $name without leaking collector content or retrying an ended run",
	async ({ status, body, errors, warnings }) => {
		let received = 0;
		const server = createServer(async (req, res) => {
			for await (const _chunk of req) {
				/* drain the local request */
			}
			received++;
			res.writeHead(status, { "content-type": "application/json" });
			res.end(body);
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("missing server address");
			stubCredentials("1");
			vi.stubEnv("PI_OTEL_TRACE_ENDPOINT", `http://127.0.0.1:${address.port}/v1/traces`);
			const handlers = load();
			const ctx = {
				model: { id: "test-model" },
				sessionManager: { getSessionId: () => "test-session" },
			} as unknown as ExtensionContext;
			await handlers.get("agent_start")?.({}, ctx);
			await handlers.get("agent_end")?.({}, ctx);
			await handlers.get("agent_end")?.({}, ctx);
			expect(received).toBe(1);
			expect(errorSpy.mock.calls.map((args) => args[0])).toEqual(errors);
			expect(warningSpy.mock.calls.map((args) => args[0])).toEqual(warnings);
			const diagnostics = JSON.stringify([...errorSpy.mock.calls, ...warningSpy.mock.calls]);
			expect(diagnostics).not.toContain(CONTENT);
			expect(diagnostics).not.toContain("collector-test");
			expect(diagnostics).not.toContain("test-secret");
		} finally {
			errorSpy.mockRestore();
			warningSpy.mockRestore();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	},
);

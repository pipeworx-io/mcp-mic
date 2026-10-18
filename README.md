# @pipeworx/mic

ISO 10383 Market Identifier Code (MIC) decoder — venue name, operator, country and status behind the 4-character exchange code, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1831+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `decode_mic(code)` — decode one MIC (e.g. `"XNYS"`, `"XLON"`) to the venue's market name, legal operator, LEI, country, city, website and registry status. Reports whether the code is an **operating MIC** (the venue operator as a whole, e.g. `"XNYS"` for the New York Stock Exchange) or a **segment MIC** (one specific market/order book under an operator, e.g. `"ARCX"`, NYSE Arca, under `"XNYS"`). An operating MIC also carries `segment_count` — call `search_mics` with `operating_mic` to list them.
- `search_mics(country?, operating_mic?, status?, name_contains?, limit?, offset?)` — filter the registry. Returns aggregate counts first (`total`, `by_status`, `by_country`) and a page of rows after. Pass `operating_mic` to list every market under one venue operator; a zero-match combination names the filters tried rather than returning a bare empty array.

**Complements `openfigi`**: openfigi returns `exchCode` on a security's exchange listing with no decoder for it — `decode_mic` is that decoder.

## Data source

Publisher: ISO, delegated to ANNA (the Association of National Numbering Agencies) as the Registration Authority for ISO 10383 — the Market Identifier Code list, ~2,900 codes. The registry is published as a downloadable file only (no query API), so this pack answers from a baked table refreshed on a schedule rather than a live per-call fetch. `data_as_of` in every response is the capture time the answer reflects.

**Licence.** ISO 10383 is a published international standard; ANNA distributes the current MIC list for public reference use.

## Two kinds of MIC

ISO 10383 itself distinguishes an **operating MIC** (the venue operator, e.g. `"XNYS"`) from a **segment MIC** (one market under that operator, e.g. `"ARCX"` under `"XNYS"`, or `"XCHI"`, NYSE Texas, also under `"XNYS"`). A security's `exchCode` can be either kind — `decode_mic` reports which, and for an operating MIC, how many segments sit under it.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "mic": {
      "url": "https://gateway.pipeworx.io/mic/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/mic/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1831+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/decode_mic \
  -H 'Content-Type: application/json' \
  -d '{"code":"XNYS"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/decode_mic`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "mic": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-mic"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-mic
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Mic data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

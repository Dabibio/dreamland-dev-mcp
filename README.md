# `@dreamland_dev/mcp`

MCP server for publishing your built artifact (`./dist`) to **DreamLand** from any MCP-capable agent
(Cursor, Claude Code, Windsurf, …). Designed for vibe coders: install once, then just say "publish
this" in your agent's chat.

---

## What it does

Three tools exposed via the [Model Context Protocol](https://modelcontextprotocol.io):

| Tool | What it does |
|---|---|
| **`dreamland_publish`** | Zip `./dist` (configurable), upload to DreamLand. First run in a directory creates a new project and writes `.dreamland/project.json`; subsequent runs append new versions automatically. |
| **`dreamland_list_projects`** | Return all your DreamLand projects (id, name, public URL, current version). The agent uses this to answer "what do I have on DreamLand", "what is the link for X". |
| **`dreamland_link`** | Bind the current directory to an existing project by writing `.dreamland/project.json`. Useful when switching machines or recovering a lost marker. |

The marker file (`.dreamland/project.json`) is plain JSON, **safe to commit** — it contains a
project id (not a credential), and the server verifies ownership on every write.

---

## Install (Cursor)

Generate an API token at your DreamLand dashboard's **Settings → API Tokens** page and click
**Install in Cursor** — that's the one-click path. The dashboard's deeplink writes the right entry
in your Cursor `mcp.json` for you.

If you need to configure manually, paste the snippet below into `~/.cursor/mcp.json` (or
project-local `.cursor/mcp.json`):

```jsonc
{
  "mcpServers": {
    "dreamland": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/Dabibio/dreamland-dev-mcp.git#v0.1.0"],
      "env": {
        "DREAMLAND_TOKEN": "dl_live_…",
        "DREAMLAND_API_BASE": "https://your-dreamland-instance.example.com"
      }
    }
  }
}
```

After saving, restart Cursor; you should see `dreamland` in your MCP servers list, with the three
tools above ready to call.

---

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `DREAMLAND_TOKEN` | yes | — | Token created at the dashboard. Format: `dl_live_…`. |
| `DREAMLAND_API_BASE` | no | `http://localhost:8080` | Backend base URL. Set this to your real DreamLand origin. |
| `DREAMLAND_LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error`. Goes to stderr only. |

The token is read from the spawning agent's environment and never leaves the local machine — it
does not enter LLM context, tool results, or stdout.

---

## Usage examples (in your agent)

```
You:  Publish this to dreamland.
Tool: dreamland_publish({})
        → Created project "my-app" (v1) on DreamLand.
          Public URL: https://my-app.example.com
          Project ID: 17

You:  Ship a new version.
Tool: dreamland_publish({})
        → Published "my-app" v2 to DreamLand.
          Public URL: https://my-app.example.com

You:  What do I have on DreamLand?
Tool: dreamland_list_projects({})
        → Found 3 project(s) on DreamLand: [...]

You:  Bind this folder to project 17.
Tool: dreamland_link({ project_id: 17 })
        → Linked this directory to "my-app" (project 17). …
```

---

## Local development

```bash
git clone git@github.com:Dabibio/dreamland-dev-mcp.git
cd dreamland-dev-mcp
npm install
npm run build
```

Two ways to test changes without touching Cursor:

**1. Smoke via raw stdio** — fastest, no UI:

```bash
DREAMLAND_TOKEN=dl_live_... DREAMLAND_API_BASE=http://localhost:8080 \
  node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
```

**2. MCP inspector** — interactive UI:

```bash
npm run inspect
```

End-to-end via Cursor: push a tag (e.g. `v0.1.1-dev`), update your `mcp.json` `args` to point at
that tag, and restart Cursor — it'll `npx git+…` install the tagged version. The same install
path used in production npm distribution applies here (via `prepare` script that builds `dist/` on
install).

---

## License

MIT

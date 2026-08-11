import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_TYPES } from "./manifests.js";
import { ensureDir, pathExists, pluginsDir } from "./workspace.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function toDisplayName(id) {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function toClassName(id) {
  return `${id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")}Plugin`;
}

function render(template, values) {
  let content = template;
  for (const [key, value] of Object.entries(values)) {
    content = content.split(`__${key}__`).join(String(value));
  }
  return content;
}

const FALLBACK_TEMPLATES = {
  "_shared/plugin.json": `{
  "id": "__PLUGIN_ID__",
  "type": "__PLUGIN_TYPE__",
  "name": "__PLUGIN_NAME__",
  "version": "0.1.0",
  "description": "__PLUGIN_DESCRIPTION__",
  "enabled": true,
  "role": "__PLUGIN_ROLE__",
  "dependencies": __PLUGIN_DEPENDENCIES__
}
`,
  "_shared/README.md": `# __PLUGIN_NAME__

__PLUGIN_DESCRIPTION__

- ID: \`__PLUGIN_ID__\`
- Type: \`__PLUGIN_TYPE__\`
- Role: \`__PLUGIN_ROLE__\`
- Version: \`0.1.0\`

## 测试

\`\`\`powershell
node tools/ysbot.js test __PLUGIN_ID__
\`\`\`
`,
  "index.js": `export default class __PLUGIN_CLASS__ {
  async init(ctx) {
    this.ctx = ctx;
  }

  async invoke(params = {}, context = {}) {
    return {
      ok: true,
      plugin: "__PLUGIN_ID__",
      params,
      context,
    };
  }
}
`,
  "test/plugin.test.js": `import test from "node:test";
import assert from "node:assert/strict";
import { loadPluginHarness } from "../../test/plugin-harness.js";

test("__PLUGIN_ID__ loads and invokes", async () => {
  const harness = await loadPluginHarness("__PLUGIN_ID__");
  try {
    assert.ok(harness.registry.get("__PLUGIN_ID__"));
    const result = await harness.invoke({ ping: true });
    assert.equal(result.ok, true);
  } finally {
    await harness.cleanup();
  }
});
`,
};

async function readTemplate(relativePath) {
  if (FALLBACK_TEMPLATES[relativePath]) {
    return FALLBACK_TEMPLATES[relativePath];
  }
  const base = relativePath.split("/").slice(1).join("/");
  if (FALLBACK_TEMPLATES[base]) {
    return FALLBACK_TEMPLATES[base];
  }
  throw new Error(`Template not found: ${relativePath}`);
}

export async function createPlugin({
  type,
  id,
  name,
  description = "",
  role,
  depends = [],
  root = pluginsDir,
}) {
  if (!PLUGIN_TYPES.includes(type)) {
    throw new Error(`Unsupported plugin type: ${type}`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      "Plugin id must match [a-z0-9][a-z0-9-]* (lowercase kebab-case).",
    );
  }

  const target = path.join(root, id);
  if (await pathExists(target)) {
    throw new Error(`Plugin already exists: ${target}`);
  }

  const displayName = name || toDisplayName(id);
  const values = {
    PLUGIN_ID: id,
    PLUGIN_TYPE: type,
    PLUGIN_NAME: displayName,
    PLUGIN_DESCRIPTION: description,
    PLUGIN_ROLE: role || (type === "system" ? "admin" : "user"),
    PLUGIN_CLASS: toClassName(id),
    PLUGIN_DEPENDENCIES: JSON.stringify(
      depends.filter(Boolean).map((item) => String(item).trim()),
    ),
  };

  const files = [
    ["plugin.json", "_shared/plugin.json"],
    ["index.js", `${type}/index.js`],
    ["README.md", "_shared/README.md"],
    [`test/${id}.test.js`, `${type}/test/plugin.test.js`],
  ];

  await ensureDir(target);
  await ensureDir(path.join(target, "test"));
  for (const [targetFile, templateFile] of files) {
    const template = await readTemplate(templateFile);
    const output = render(template, values);
    const destination = path.join(target, targetFile);
    await ensureDir(path.dirname(destination));
    await fs.writeFile(destination, output, "utf8");
  }

  return target;
}

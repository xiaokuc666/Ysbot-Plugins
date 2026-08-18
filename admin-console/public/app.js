function componentEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

class YsbotBadge extends HTMLElement {
  static observedAttributes = ["text", "tone"];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const text = this.getAttribute("text") || this.textContent || "";
    const tone = this.getAttribute("tone") || "ok";
    this.shadowRoot.innerHTML = `
      <style>
        .badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          line-height: 18px;
          background: var(--ysbot-surface, #fff);
          border: 1px solid var(--ysbot-border, #d6dde3);
          color: var(--ysbot-text, #1f2933);
        }
        .badge.ok { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
        .badge.warn { background: #fef3c7; color: #92400e; border-color: #fde68a; }
        .badge.error { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
        .badge.disabled { background: var(--ysbot-bg, #f4f6f8); color: var(--ysbot-muted, #64748b); }
      </style>
      <span class="badge ${componentEscapeHtml(tone)}">${componentEscapeHtml(text)}</span>
    `;
  }
}

class YsbotButton extends HTMLElement {
  static observedAttributes = ["variant", "disabled"];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const variant = this.getAttribute("variant") || "primary";
    const disabled = this.hasAttribute("disabled") ? "disabled" : "";
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; }
        button {
          padding: 8px 12px;
          border: 1px solid var(--ysbot-primary, #2563eb);
          border-radius: var(--ysbot-radius, 6px);
          background: var(--ysbot-primary, #2563eb);
          color: #fff;
          font: inherit;
          cursor: pointer;
        }
        button:disabled { opacity: 0.55; cursor: not-allowed; }
        .ghost { background: transparent; color: var(--ysbot-text, #1f2933); border-color: var(--ysbot-border, #d6dde3); }
        .danger { color: var(--ysbot-danger, #b91c1c); border-color: var(--ysbot-danger, #b91c1c); background: transparent; }
        .danger-solid { background: var(--ysbot-danger, #b91c1c); border-color: var(--ysbot-danger, #b91c1c); color: #fff; }
      </style>
      <button class="${componentEscapeHtml(variant)}" ${disabled}><slot></slot></button>
    `;
  }
}

class YsbotModal extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: none; }
        :host([open]) { display: block; }
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .modal {
          width: min(440px, 100%);
          background: var(--ysbot-surface, #fff);
          border: 1px solid var(--ysbot-border, #d6dde3);
          border-radius: var(--ysbot-radius, 8px);
          padding: 20px;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.18);
        }
        h2 { margin: 0 0 12px; font-size: 18px; }
        p { margin: 0 0 20px; color: var(--ysbot-muted, #64748b); }
        .actions { display: flex; justify-content: flex-end; gap: 8px; }
        .actions button {
          padding: 8px 12px;
          border-radius: var(--ysbot-radius, 6px);
          border: 1px solid var(--ysbot-border, #d6dde3);
          background: var(--ysbot-surface, #fff);
          color: var(--ysbot-text, #1f2933);
          cursor: pointer;
          font: inherit;
        }
        .actions .confirm {
          background: var(--ysbot-primary, #2563eb);
          border-color: var(--ysbot-primary, #2563eb);
          color: #fff;
        }
        .actions .confirm.danger {
          background: var(--ysbot-danger, #b91c1c);
          border-color: var(--ysbot-danger, #b91c1c);
        }
      </style>
      <div class="backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h2></h2>
          <p></p>
          <div class="actions">
            <button class="cancel" type="button">取消</button>
            <button class="confirm" type="button">确认</button>
          </div>
        </div>
      </div>
    `;
    this.shadowRoot.querySelector(".cancel").addEventListener("click", () => {
      this.close(false);
    });
    this.shadowRoot.querySelector(".confirm").addEventListener("click", () => {
      this.close(true);
    });
    this.shadowRoot.querySelector(".backdrop").addEventListener("click", (event) => {
      if (event.target === this.shadowRoot.querySelector(".backdrop")) this.close(false);
    });
  }

  show({ title = "确认", message = "", confirmText = "确认", danger = false } = {}) {
    this.shadowRoot.querySelector("h2").textContent = title;
    this.shadowRoot.querySelector("p").textContent = message;
    const confirmButton = this.shadowRoot.querySelector(".confirm");
    confirmButton.textContent = confirmText;
    confirmButton.classList.toggle("danger", Boolean(danger));
    this.setAttribute("open", "");
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  close(result) {
    this.removeAttribute("open");
    if (this._resolve) {
      this._resolve(result);
      this._resolve = null;
    }
  }
}

class YsbotToast extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 1100;
          pointer-events: none;
        }
        .toast {
          max-width: 420px;
          padding: 12px 16px;
          border-radius: var(--ysbot-radius, 6px);
          background: var(--ysbot-danger, #b91c1c);
          color: #fff;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.2s, transform 0.2s;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.2);
        }
        .toast.show { opacity: 1; transform: translateY(0); }
        .toast.ok { background: #15803d; }
      </style>
      <div class="toast"></div>
    `;
  }

  show(message, type = "error") {
    const toast = this.shadowRoot.querySelector(".toast");
    toast.textContent = message;
    toast.className = `toast ${type}`;
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3500);
  }
}

customElements.define("ysbot-badge", YsbotBadge);
customElements.define("ysbot-button", YsbotButton);
customElements.define("ysbot-modal", YsbotModal);
customElements.define("ysbot-toast", YsbotToast);

const state = {
  token: sessionStorage.getItem("ysbot-admin-token") || "",
  plugins: [],
  configs: [],
  pages: [],
  theme: null,
  presets: {},
  activeView: "overview",
  detailId: null,
  activeConfig: null,
  activePage: null,
  pagePickerForced: false,
};

const $ = (selector) => document.querySelector(selector);

function showToast(message, type = "error") {
  const toast = document.querySelector("ysbot-toast");
  if (toast?.show) {
    toast.show(message, type);
    return;
  }
  const fallback = $("#toast");
  if (fallback) {
    fallback.textContent = message;
    fallback.className = `show ${type}`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      fallback.className = "";
    }, 3500);
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let body = options.body;
  if (body && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, headers, body });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") {
      sessionStorage.removeItem("ysbot-admin-token");
      state.token = "";
      renderLogin();
      throw new Error(data.error || "登录已失效");
    }
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

async function fetchText(path) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { headers });
  if (response.status === 401) {
    sessionStorage.removeItem("ysbot-admin-token");
    state.token = "";
    renderLogin();
    throw new Error("登录已失效");
  }
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return response.text();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badge(text, kind = "ok") {
  return `<ysbot-badge text="${escapeHtml(text)}" tone="${escapeHtml(kind)}"></ysbot-badge>`;
}

async function confirmDialog(message, options = {}) {
  const modal = document.querySelector("ysbot-modal");
  if (modal?.show) {
    return modal.show({
      title: options.title || "确认",
      message,
      confirmText: options.confirmText || "确认",
      danger: Boolean(options.danger),
    });
  }
  return window.confirm(message);
}

function renderLogin() {
  $("#main").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

function showMain() {
  $("#login").classList.add("hidden");
  $("#main").classList.remove("hidden");
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  });
  if (view === "overview") loadOverview();
  if (view === "plugins") loadPlugins();
  if (view === "config") loadConfigList();
  if (view === "appearance") loadAppearance();
  if (view === "pages") loadPages();
  if (view === "logs") loadLogs();
}

async function loadOverview() {
  const box = $("#overview");
  box.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api("/api/status");
    const protocol = data.protocol?.connected ? "connected" : "disconnected";
    box.innerHTML = `
      <div class="stats">
        <div><span>运行</span><strong>${data.running ? "是" : "否"}</strong></div>
        <div><span>暂停</span><strong>${data.paused ? "是" : "否"}</strong></div>
        <div><span>协议</span><strong>${protocol}</strong></div>
        <div><span>插件</span><strong>${data.pluginCount}</strong></div>
        <div><span>任务</span><strong>${data.taskCount}</strong></div>
        <div><span>消息</span><strong>${data.stats?.messages || 0}</strong></div>
      </div>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch (error) {
    box.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

async function loadPlugins() {
  const list = $("#plugin-list");
  list.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api("/api/plugins");
    state.plugins = data.plugins || [];
    renderPluginList();
    return true;
  } catch (error) {
    list.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
    return false;
  }
}

function renderPluginList() {
  const query = ($("#plugin-search").value || "").trim().toLowerCase();
  const filtered = state.plugins.filter((plugin) => {
    return [plugin.id, plugin.name, plugin.type, plugin.version]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const rows = filtered.map((plugin) => {
    let actions = `<ysbot-button data-action="toggle">${plugin.enabled ? "禁用" : "启用"}</ysbot-button>
      <ysbot-button data-action="reload" variant="ghost">重载</ysbot-button>
      <ysbot-button data-action="clear" variant="danger">清数据</ysbot-button>
      <ysbot-button data-action="uninstall" variant="danger">卸载</ysbot-button>
      <label class="file-inline">更新<input type="file" accept=".plg" data-action="update"></label>`;
    if (plugin.protected) {
      actions = badge("受保护", "disabled");
    }
    return `<tr data-id="${escapeHtml(plugin.id)}">
      <td>${escapeHtml(plugin.id)}</td>
      <td>${escapeHtml(plugin.name)}</td>
      <td>${escapeHtml(plugin.type)}</td>
      <td>${escapeHtml(plugin.version)}</td>
      <td>${badge(plugin.enabled === false ? "disabled" : plugin.status, plugin.enabled === false ? "disabled" : "ok")}</td>
      <td>${escapeHtml(plugin.source)}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("");
  $("#plugin-list").innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>版本</th><th>状态</th><th>来源</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">无插件</td></tr>'}</tbody>
    </table>`;
}

async function loadDetail(id) {
  const box = $("#plugin-detail");
  box.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api(`/api/plugins/detail?id=${encodeURIComponent(id)}`);
    const plugin = data.plugin;
    state.detailId = id;
    box.innerHTML = `
      <h2>${escapeHtml(plugin.id)} ${plugin.protected ? badge("受保护", "disabled") : ""}</h2>
      <dl>
        <dt>名称</dt><dd>${escapeHtml(plugin.name)}</dd>
        <dt>版本</dt><dd>${escapeHtml(plugin.version)}</dd>
        <dt>类型</dt><dd>${escapeHtml(plugin.type)}</dd>
        <dt>来源</dt><dd>${escapeHtml(plugin.sourceType)}</dd>
        <dt>数据目录</dt><dd>${escapeHtml(plugin.dataDir || "-")}</dd>
        <dt>缓存目录</dt><dd>${escapeHtml(plugin.cacheDir || "-")}</dd>
        <dt>依赖</dt><dd>${escapeHtml((plugin.dependencies || []).join(", ") || "-")}</dd>
      </dl>
      <h3>错误</h3>
      <div>${plugin.errors?.length ? plugin.errors.map((item) => `<div class="error-text">${escapeHtml(item.message)}</div>`).join("") : '<span class="muted">无</span>'}</div>
      <h3>plugin.json</h3>
      <pre>${escapeHtml(JSON.stringify(plugin.manifest, null, 2))}</pre>`;
  } catch (error) {
    box.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function installPlugin() {
  const input = $("#install-file");
  const file = input.files?.[0];
  if (!file) {
    showToast("请选择 .plg 文件");
    return;
  }
  if (!(await confirmDialog(`安装 ${file.name}？`))) return;
  try {
    const plgBase64 = await fileToBase64(file);
    const data = await api("/api/plugins/install", {
      method: "POST",
      body: { fileName: file.name, plgBase64 },
    });
    showToast(`已安装 ${data.id}`, "ok");
    input.value = "";
    await loadPlugins();
    await loadPages();
    await loadConfigList();
    clearInvalidConfigDetail();
  } catch (error) {
    showToast(error.message);
  }
}

async function pluginAction(id, action, options = {}) {
  const confirmText = {
    clear: `确认清理 ${id} 的数据目录？`,
    uninstall: `确认卸载 ${id}？`,
    update: `确认更新 ${id}？`,
  }[action];
  if (confirmText && !(await confirmDialog(confirmText, { danger: action === "clear" || action === "uninstall" }))) return;
  try {
    if (action === "toggle") {
      await api(`/api/plugins/toggle?id=${encodeURIComponent(id)}`, { method: "POST" });
    } else if (action === "reload") {
      await api(`/api/plugins/reload?id=${encodeURIComponent(id)}`, { method: "POST" });
    } else if (action === "clear") {
      await api(`/api/plugins/clear-data?id=${encodeURIComponent(id)}`, { method: "POST" });
    } else if (action === "uninstall") {
      await api(`/api/plugins/uninstall?id=${encodeURIComponent(id)}`, {
        method: "POST",
        body: { removeData: await confirmDialog("同时删除数据目录？", { danger: true, confirmText: "删除" }) },
      });
    } else if (action === "update") {
      const file = options.file;
      const plgBase64 = await fileToBase64(file);
      await api(`/api/plugins/update?id=${encodeURIComponent(id)}`, {
        method: "POST",
        body: { fileName: file.name, plgBase64 },
      });
    }
    showToast(`${id} 操作成功`, "ok");
    await loadPlugins();
    await loadPages();
    await loadConfigList();
    clearInvalidConfigDetail();
    if (state.detailId === id) await loadDetail(id);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadConfigList() {
  const list = $("#config-list");
  list.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api("/api/admin-console/config");
    state.configs = data.configs || [];
    renderConfigList();
  } catch (error) {
    list.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

function renderConfigList() {
  const rows = state.configs.map((item) => {
    return `<div class="config-item" data-plugin="${escapeHtml(item.pluginId)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span class="muted">${escapeHtml(item.pluginId)}</span>
    </div>`;
  }).join("");
  $("#config-list").innerHTML = `
    <div class="list-panel">
      <h2>参数配置</h2>
      ${rows || '<div class="muted">暂无插件声明配置</div>'}
    </div>`;
}

function clearInvalidConfigDetail() {
  if (!state.activeConfig) return;
  const stillExists = state.configs.some(
    (config) => config.pluginId === state.activeConfig.pluginId,
  );
  if (!stillExists) {
    state.activeConfig = null;
    const form = $("#config-form");
    if (form) form.innerHTML = '<div class="muted">请选择插件配置</div>';
  }
}

async function loadConfigDetail(pluginId) {
  const box = $("#config-form");
  box.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api(`/api/admin-console/config/detail?pluginId=${encodeURIComponent(pluginId)}`);
    state.activeConfig = data;
    box.innerHTML = renderConfigForm(data);
  } catch (error) {
    box.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

function renderConfigForm(data) {
  const properties = data.schema?.properties || {};
  const fields = Object.entries(properties).map(([key, prop]) => {
    const value = data.values?.[key];
    const secret = prop.secret === true || (data.secretState && Object.hasOwn(data.secretState, key));
    const isSet = data.secretState?.[key] ? true : false;
    const label = escapeHtml(prop.title || key);
    const description = prop.description ? `<div class="muted">${escapeHtml(prop.description)}</div>` : "";
    let input = "";
    if (secret) {
      input = `
        <input data-config-key="${escapeHtml(key)}" type="password" placeholder="${isSet ? "已设置，留空保持不变" : ""}">
        <label class="inline"><input type="checkbox" data-clear-key="${escapeHtml(key)}"> 清空当前密钥</label>
        <div class="muted">${isSet ? "当前：已设置" : "当前：未设置"}</div>`;
    } else if (prop.type === "boolean") {
      input = `<select data-config-key="${escapeHtml(key)}"><option value="true" ${value === true ? "selected" : ""}>true</option><option value="false" ${value === false ? "selected" : ""}>false</option></select>`;
    } else if (Array.isArray(prop.enum)) {
      input = `<select data-config-key="${escapeHtml(key)}">${prop.enum.map((option) => `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    } else if (prop.type === "number" || prop.type === "integer") {
      input = `<input data-config-key="${escapeHtml(key)}" type="number" value="${escapeHtml(value ?? "")}">`;
    } else if (prop.type === "array") {
      input = `<textarea data-config-key="${escapeHtml(key)}">${escapeHtml(Array.isArray(value) ? JSON.stringify(value) : "")}</textarea>`;
    } else {
      input = `<input data-config-key="${escapeHtml(key)}" value="${escapeHtml(value ?? "")}">`;
    }
    return `<div class="config-field"><label>${label}</label>${input}${description}</div>`;
  }).join("");
  return `
    <h2>${escapeHtml(data.title)}</h2>
    <form id="config-form-body">${fields}</form>
    <div class="toolbar">
      <button id="config-save">保存</button>
      <button id="config-validate" class="ghost">校验</button>
      <button id="config-reset" class="danger ghost">重置</button>
    </div>
    <div id="config-errors"></div>`;
}

function collectConfigForm() {
  const values = {};
  const clearSecret = [];
  document.querySelectorAll("[data-config-key]").forEach((input) => {
    const key = input.dataset.configKey;
    const value = input.value;
    if (input.type === "number") values[key] = value === "" ? null : Number(value);
    else if (input.type === "checkbox" && input.dataset.clearKey) return;
    else if (input.dataset.clearKey) return;
    else if (input.tagName === "SELECT" && input.dataset.configKey && input.value === "true") values[key] = true;
    else if (input.tagName === "SELECT" && input.dataset.configKey && input.value === "false") values[key] = false;
    else if (input.tagName === "TEXTAREA" && input.dataset.configKey) {
      try {
        values[key] = JSON.parse(value || "[]");
      } catch {
        values[key] = value;
      }
    } else values[key] = value;
  });
  document.querySelectorAll("[data-clear-key]").forEach((input) => {
    if (input.checked) clearSecret.push(input.dataset.clearKey);
  });
  return { values, clearSecret };
}

async function saveConfigForm() {
  if (!state.activeConfig) return;
  try {
    const { values, clearSecret } = collectConfigForm();
    await api(`/api/admin-console/config/save?pluginId=${encodeURIComponent(state.activeConfig.pluginId)}`, {
      method: "PUT",
      body: { values, clearSecret },
    });
    showToast("配置已保存", "ok");
    await loadConfigDetail(state.activeConfig.pluginId);
  } catch (error) {
    showToast(error.message);
  }
}

async function validateConfigForm() {
  if (!state.activeConfig) return;
  try {
    const { values } = collectConfigForm();
    const data = await api(`/api/admin-console/config/validate?pluginId=${encodeURIComponent(state.activeConfig.pluginId)}`, {
      method: "POST",
      body: { values },
    });
    $("#config-errors").innerHTML = data.ok
      ? '<div class="ok-text">校验通过</div>'
      : `<div class="error-text">${escapeHtml((data.errors || []).join("; "))}</div>`;
  } catch (error) {
    $("#config-errors").innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

async function resetConfigForm() {
  if (!state.activeConfig) return;
  if (!(await confirmDialog(`重置 ${state.activeConfig.pluginId} 配置？`))) return;
  try {
    await api(`/api/admin-console/config/reset?pluginId=${encodeURIComponent(state.activeConfig.pluginId)}`, {
      method: "POST",
      body: {},
    });
    showToast("配置已重置", "ok");
    await loadConfigDetail(state.activeConfig.pluginId);
  } catch (error) {
    showToast(error.message);
  }
}

function applyTheme(theme) {
  const style = document.documentElement.style;
  style.setProperty("--ysbot-bg", theme.bg);
  style.setProperty("--ysbot-surface", theme.surface);
  style.setProperty("--ysbot-border", theme.border);
  style.setProperty("--ysbot-text", theme.text);
  style.setProperty("--ysbot-muted", theme.muted);
  style.setProperty("--ysbot-primary", theme.primary);
  style.setProperty("--ysbot-danger", theme.danger);
  style.setProperty("--ysbot-radius", theme.radius);
  style.setProperty("--ysbot-font", theme.font);
}

function themeCssInline(theme) {
  return `:root {
    --ysbot-bg: ${theme.bg};
    --ysbot-surface: ${theme.surface};
    --ysbot-border: ${theme.border};
    --ysbot-text: ${theme.text};
    --ysbot-muted: ${theme.muted};
    --ysbot-primary: ${theme.primary};
    --ysbot-danger: ${theme.danger};
    --ysbot-radius: ${theme.radius};
    --ysbot-font: ${theme.font};
  }`;
}

async function loadAppearance() {
  const box = $("#theme-presets");
  box.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api("/api/admin-console/theme");
    state.theme = data.theme;
    state.presets = data.presets || {};
    applyTheme(state.theme);
    renderAppearance();
  } catch (error) {
    box.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

function renderAppearance() {
  const presets = Object.entries(state.presets).map(([key, value]) => {
    return `<div class="config-item" data-preset="${escapeHtml(key)}">
      <strong>${escapeHtml(key)}</strong>
      <span class="muted">${escapeHtml(value.primary)}</span>
    </div>`;
  }).join("");
  $("#theme-presets").innerHTML = `
    <div class="list-panel">
      <h2>主题预设</h2>
      ${presets || '<div class="muted">无主题预设</div>'}
    </div>`;

  const t = state.theme || {};
  $("#theme-custom").innerHTML = `
    <h2>自定义外观</h2>
    <div class="config-field"><label>背景</label><input id="theme-bg" type="color" value="${escapeHtml(t.bg || "#f4f6f8")}"></div>
    <div class="config-field"><label>面板</label><input id="theme-surface" type="color" value="${escapeHtml(t.surface || "#ffffff")}"></div>
    <div class="config-field"><label>边框</label><input id="theme-border" type="color" value="${escapeHtml(t.border || "#d6dde3")}"></div>
    <div class="config-field"><label>文字</label><input id="theme-text" type="color" value="${escapeHtml(t.text || "#1f2933")}"></div>
    <div class="config-field"><label>次要文字</label><input id="theme-muted" type="color" value="${escapeHtml(t.muted || "#64748b")}"></div>
    <div class="config-field"><label>主色</label><input id="theme-primary" type="color" value="${escapeHtml(t.primary || "#2563eb")}"></div>
    <div class="config-field"><label>危险色</label><input id="theme-danger" type="color" value="${escapeHtml(t.danger || "#b91c1c")}"></div>
    <div class="config-field"><label>圆角</label><input id="theme-radius" value="${escapeHtml(t.radius || "6px")}"></div>
    <div class="config-field"><label>字体</label><input id="theme-font" value="${escapeHtml(t.font || "system-ui, sans-serif")}"></div>
    <div class="toolbar">
      <button id="theme-save">保存外观</button>
      <button id="theme-reset" class="danger ghost">恢复默认</button>
    </div>
    <div id="theme-errors"></div>`;
}

function collectTheme() {
  return {
    preset: "custom",
    colors: {
      bg: $("#theme-bg").value,
      surface: $("#theme-surface").value,
      border: $("#theme-border").value,
      text: $("#theme-text").value,
      muted: $("#theme-muted").value,
      primary: $("#theme-primary").value,
      danger: $("#theme-danger").value,
    },
    radius: $("#theme-radius").value,
    font: $("#theme-font").value,
  };
}

async function saveAppearance() {
  try {
    const data = await api("/api/admin-console/theme", {
      method: "PUT",
      body: collectTheme(),
    });
    state.theme = data.theme;
    applyTheme(state.theme);
    showToast("外观已保存", "ok");
    await loadAppearance();
  } catch (error) {
    $("#theme-errors").innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

async function applyThemePreset(preset) {
  try {
    const data = await api("/api/admin-console/theme", {
      method: "PUT",
      body: { preset },
    });
    state.theme = data.theme;
    applyTheme(state.theme);
    showToast("主题已应用", "ok");
    await loadAppearance();
  } catch (error) {
    showToast(error.message);
  }
}

async function resetAppearance() {
  if (!(await confirmDialog("恢复默认外观？"))) return;
  await applyThemePreset("default");
}

function renderSpecialDropdown() {
  const nav = $("#special-nav");
  const dropdown = $("#special-dropdown");
  if (!nav || !dropdown) return;
  nav.classList.remove("hidden");
  if (!state.pages.length) {
    dropdown.innerHTML =
      `<button data-page-all="1">总页面</button>` +
      `<div class="muted" style="padding:8px 10px;">暂无特殊页面</div>`;
    return;
  }
  const sorted = [...state.pages].sort(
    (a, b) =>
      (a.title || a.pluginId).localeCompare(b.title || b.pluginId, "zh-CN") ||
      a.pluginId.localeCompare(b.pluginId),
  );
  dropdown.innerHTML =
    `<button data-page-all="1">总页面</button>` +
    sorted
      .map(
        (page) => `
        <button data-page-plugin="${escapeHtml(page.pluginId)}" data-page-id="${escapeHtml(page.id)}">
          ${escapeHtml(page.title)} <span class="muted">${escapeHtml(page.pluginId)}</span>
        </button>`,
      )
      .join("");
}

async function loadPages() {
  const list = $("#page-list");
  list.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api("/api/admin-console/pages");
    state.pages = data.pages || [];
    renderSpecialDropdown();
    renderPages();
    const activeStillExists =
      state.activePage &&
      state.pages.some(
        (page) =>
          page.pluginId === state.activePage.pluginId &&
          page.id === state.activePage.id,
      );
    if (!activeStillExists) {
      state.activePage = null;
      const frame = $("#page-frame");
      if (frame) {
        frame.classList.add("hidden");
        frame.innerHTML = "";
      }
    }
    if (state.pagePickerForced) {
      showPagePicker();
      state.pagePickerForced = false;
    } else if (activeStillExists) {
      hidePagePicker();
      await openPage(state.activePage.pluginId, state.activePage.id);
    } else {
      showPagePicker();
    }
    return true;
  } catch (error) {
    list.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
    return false;
  }
}

function renderPages() {
  const query = ($("#page-search").value || "").trim().toLowerCase();
  const filtered = state.pages.filter((page) => {
    return [page.title, page.pluginId, page.id]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const rows = filtered.map((page) => {
    return `<div class="page-item" data-plugin="${escapeHtml(page.pluginId)}" data-page="${escapeHtml(page.id)}">
      <strong>${escapeHtml(page.title)}</strong>
      <span class="muted">${escapeHtml(page.pluginId)}</span>
    </div>`;
  }).join("");
  $("#page-list").innerHTML = rows || '<div class="muted">暂无特殊页面</div>';
}

function showPagePicker() {
  $("#page-picker")?.classList.remove("hidden");
  $("#back-to-pages")?.classList.add("hidden");
}

function hidePagePicker() {
  $("#page-picker")?.classList.add("hidden");
}

function exitSpecialPage() {
  state.activePage = null;
  const frame = $("#page-frame");
  if (frame) {
    frame.classList.add("hidden");
    frame.innerHTML = "";
  }
  $("#back-to-pages")?.classList.add("hidden");
  showPagePicker();
}

async function openPage(pluginId, pageId) {
  state.pagePickerForced = false;
  hidePagePicker();
  const page = state.pages.find(
    (item) => item.pluginId === pluginId && item.id === pageId,
  );
  if (!page) return;
  state.activePage = page;
  const frame = $("#page-frame");
  frame.classList.remove("hidden");
  $("#back-to-pages")?.classList.remove("hidden");
  frame.innerHTML = '<div class="muted">页面加载中...</div>';
  try {
    const html = await fetchText(page.entry);
    let theme = state.theme;
    if (!theme) {
      const themeData = await api("/api/admin-console/theme");
      theme = themeData.theme;
      state.theme = theme;
    }
    const token = JSON.stringify(state.token);
    const themeJson = JSON.stringify(theme);
    const headInjection =
      `<base href="${escapeHtml(page.entry)}">` +
      `<style>${themeCssInline(theme)}</style>` +
      `<script>window.__YSBOT_ADMIN_TOKEN__=${token};window.__YSBOT_ADMIN_THEME__=${themeJson};</script>`;
    const pageHtml = /<head[^>]*>/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`)
      : `<!doctype html><html><head>${headInjection}</head><body>${html}</body></html>`;
    frame.innerHTML =
      `<iframe title="${escapeHtml(page.title)}" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" srcdoc="${escapeHtml(pageHtml)}"></iframe>`;
  } catch (error) {
    frame.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
  }
}

async function loadLogs() {
  const level = $("#log-level").value;
  const q = encodeURIComponent($("#log-query").value || "");
  const box = $("#log-list");
  box.innerHTML = '<div class="muted">加载中...</div>';
  try {
    const data = await api(`/api/logs?limit=300&level=${level}&q=${q}`);
    const rows = (data.logs || []).map((entry) => {
      const cls = entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : "";
      return `<div class="log-row ${cls}">
        <span class="log-time">${escapeHtml(entry.ts)}</span>
        <span class="log-level">${escapeHtml(entry.level)}</span>
        <span class="log-module">${escapeHtml(entry.module)}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      </div>`;
    }).join("");
    box.innerHTML = rows || '<div class="muted">无日志</div>';
    return true;
  } catch (error) {
    box.innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
    return false;
  }
}

function bindEvents() {
  const sideNav = $("#side-nav");
  if (sideNav) {
    sideNav.addEventListener("mouseenter", () => {
      document.body.classList.add("side-expanded");
    });
    sideNav.addEventListener("mouseleave", () => {
      setTimeout(() => {
        const dropdown = $("#special-dropdown");
        if (!dropdown?.matches(":hover")) {
          document.body.classList.remove("side-expanded");
        }
      }, 120);
    });
  }

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    sessionStorage.removeItem("ysbot-admin-token");
    state.token = "";
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: {
          username: $("#username").value,
          password: $("#password").value,
        },
      });
      state.token = data.token;
      sessionStorage.setItem("ysbot-admin-token", data.token);
      showToast("登录成功", "ok");
      showMain();
      switchView("overview");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#logout").addEventListener("click", () => {
    sessionStorage.removeItem("ysbot-admin-token");
    state.token = "";
    renderLogin();
  });

  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#plugin-search").addEventListener("input", renderPluginList);
  $("#refresh-plugins").addEventListener("click", async () => {
    const ok = await loadPlugins();
    showToast(ok ? "插件列表已刷新" : "刷新失败", ok ? "ok" : "error");
  });
  $("#install-btn").addEventListener("click", installPlugin);
  $("#refresh-logs").addEventListener("click", async () => {
    const ok = await loadLogs();
    showToast(ok ? "日志已刷新" : "刷新失败", ok ? "ok" : "error");
  });
  $("#log-level").addEventListener("change", loadLogs);
  $("#log-query").addEventListener("change", loadLogs);
  $("#page-search").addEventListener("input", renderPages);
  $("#refresh-pages").addEventListener("click", async () => {
    const ok = await loadPages();
    showToast(ok ? "特殊页面已刷新" : "刷新失败", ok ? "ok" : "error");
  });
  $("#close-page-picker").addEventListener("click", hidePagePicker);
  $("#back-to-pages").addEventListener("click", exitSpecialPage);
  $("#clear-logs").addEventListener("click", async () => {
    if (!(await confirmDialog("清空日志？", { danger: true }))) return;
    try {
      await api("/api/logs/clear", { method: "POST" });
      showToast("日志已清空", "ok");
      await loadLogs();
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#plugin-list").addEventListener("click", async (event) => {
    const row = event.target.closest("tr[data-id]");
    const button = event.target.closest(
      "ysbot-button[data-action], label.file-inline",
    );
    if (!row) return;
    const id = row.dataset.id;
    if (!button) {
      await loadDetail(id);
      return;
    }
    const action = button.dataset.action;
    if (action === "update") {
      return;
    }
    await pluginAction(id, action);
  });

  $("#plugin-list").addEventListener("change", async (event) => {
    const input = event.target.closest('input[data-action="update"]');
    if (!input) return;
    const row = input.closest("tr[data-id]");
    if (!row) return;
    await pluginAction(row.dataset.id, "update", { file: input.files[0] });
    input.value = "";
  });

  $("#config-list").addEventListener("click", (event) => {
    const item = event.target.closest("[data-plugin]");
    if (item) loadConfigDetail(item.dataset.plugin);
  });

  $("#config-form").addEventListener("click", (event) => {
    if (event.target.id === "config-save") saveConfigForm();
    if (event.target.id === "config-validate") validateConfigForm();
    if (event.target.id === "config-reset") resetConfigForm();
  });

  $("#theme-presets").addEventListener("click", (event) => {
    const item = event.target.closest("[data-preset]");
    if (item) applyThemePreset(item.dataset.preset);
  });

  $("#theme-custom").addEventListener("click", (event) => {
    if (event.target.id === "theme-save") saveAppearance();
    if (event.target.id === "theme-reset") resetAppearance();
  });

  $("#page-list").addEventListener("click", (event) => {
    const item = event.target.closest("[data-plugin]");
    if (item) openPage(item.dataset.plugin, item.dataset.page);
  });

  const specialNav = $("#special-nav");
  const specialDropdown = $("#special-dropdown");
  if (specialNav && specialDropdown) {
    let dropdownHideTimer;
    specialNav.addEventListener("mouseenter", () => {
      clearTimeout(dropdownHideTimer);
      document.body.classList.add("side-expanded");
      specialDropdown.classList.remove("hidden");
    });
    specialNav.addEventListener("mouseleave", () => {
      dropdownHideTimer = setTimeout(() => {
        if (!specialDropdown.matches(":hover")) {
          specialDropdown.classList.add("hidden");
        }
      }, 150);
    });
    specialDropdown.addEventListener("mouseenter", () => {
      clearTimeout(dropdownHideTimer);
      document.body.classList.add("side-expanded");
    });
    specialDropdown.addEventListener("mouseleave", () => {
      specialDropdown.classList.add("hidden");
      if (!specialNav.matches(":hover")) {
        document.body.classList.remove("side-expanded");
      }
    });
    specialDropdown.addEventListener("click", async (event) => {
      const all = event.target.closest("[data-page-all]");
      if (all) {
        state.pagePickerForced = true;
        switchView("pages");
        specialDropdown.classList.add("hidden");
        return;
      }
      const item = event.target.closest("[data-page-plugin]");
      if (item) {
        switchView("pages");
        await loadPages();
        await openPage(item.dataset.pagePlugin, item.dataset.pageId);
        specialDropdown.classList.add("hidden");
      }
    });
  }
}

async function boot() {
  bindEvents();
  if (!state.token) {
    renderLogin();
    return;
  }
  try {
    await api("/api/status");
    showMain();
    switchView("overview");
    loadPages();
  } catch {
    renderLogin();
  }
}

boot();

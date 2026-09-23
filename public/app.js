const STATUSES = [
  { id: "novo", label: "Novo" },
  { id: "interessado", label: "Interessado" },
  { id: "nao_respondeu", label: "Não respondeu" },
  { id: "sem_interesse", label: "Sem interesse" },
  { id: "convertido", label: "Convertido" },
];
const tokenKey = "crm-contatos-token";
let pendingContacts = [];
const $ = (id) => document.getElementById(id);
const authToken = () => sessionStorage.getItem(tokenKey) ?? "";
const headers = () => ({ Authorization: `Bearer ${authToken()}` });
const statusLabel = (id) => STATUSES.find((item) => item.id === id)?.label ?? id;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

function showMessage(text) {
  const el = $("message"); el.textContent = text; el.classList.remove("hidden");
  window.setTimeout(() => el.classList.add("hidden"), 5000);
}

function updateStats(summary) {
  $("stat-total").textContent = Number(summary.total).toLocaleString("pt-BR");
  $("stat-interessado").textContent = Number(summary.interessado).toLocaleString("pt-BR");
  $("stat-sem-resposta").textContent = Number(summary.nao_respondeu).toLocaleString("pt-BR");
  $("stat-convertido").textContent = Number(summary.convertido).toLocaleString("pt-BR");
}

function renderContacts(contacts) {
  const tbody = $("contact-rows");
  if (window.crmSummary) updateStats(window.crmSummary);
  if (!contacts.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Nenhum contato encontrado para este filtro.</td></tr>';
    $("table-note").textContent = ""; return;
  }
  tbody.innerHTML = contacts.map((contact) => {
    const options = STATUSES.map((item) => `<option value="${item.id}" ${contact.contact_status === item.id ? "selected" : ""}>${item.label}</option>`).join("");
    return `<tr data-id="${contact.id}"><td><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(contact.email ?? "Sem e-mail")}</small></td><td>${escapeHtml(contact.phone_original ?? "—")}</td><td>${escapeHtml(contact.address ?? "—")}</td><td>${escapeHtml(contact.category ?? "—")}</td><td><select class="status-select" aria-label="Status de ${escapeHtml(contact.name)}">${options}</select></td></tr>`;
  }).join("");
  $("table-note").textContent = contacts.length >= 2000 ? "Mostrando até 2.000 registros. Refine a busca para localizar outros." : `${contacts.length} contato(s) exibido(s).`;
  tbody.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const row = event.target.closest("tr");
      try { await api(`/api/contacts/${row.dataset.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: event.target.value }) }); await loadContacts(); }
      catch (error) { showMessage(error.message); await loadContacts(); }
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function loadContacts() {
  if (!authToken()) return;
  const params = new URLSearchParams({ q: $("search").value, status: $("status-filter").value, limit: "2000" });
  try { const { contacts, summary } = await api(`/api/contacts?${params}`); window.crmSummary = summary; renderContacts(contacts); }
  catch (error) { showMessage(error.message); }
}

function renderPreview(data) {
  pendingContacts = data.ready;
  const preview = $("preview");
  preview.classList.remove("hidden");
  preview.innerHTML = `<div class="preview-top"><span class="preview-title">Revise antes de importar</span><span class="chip">Status inicial: <b>Novo</b></span></div><div class="preview-counts"><span class="chip"><b>${data.total}</b> linhas lidas</span><span class="chip"><b>${data.ready.length}</b> prontas para importar</span><span class="chip"><b>${data.invalid}</b> sem nome ou telefone válido</span><span class="chip"><b>${data.duplicatesInFile}</b> repetidas no arquivo</span><span class="chip"><b>${data.alreadyRegistered}</b> já cadastradas</span></div><div class="preview-actions"><button class="button button-light" id="cancel-import" type="button">Cancelar</button><button class="button button-primary" id="commit-import" type="button" ${data.ready.length ? "" : "disabled"}>Importar ${data.ready.length} contato(s)</button></div>`;
  $("cancel-import").addEventListener("click", () => { pendingContacts = []; preview.classList.add("hidden"); });
  $("commit-import").addEventListener("click", commitImport);
}

async function previewFile() {
  const file = $("file").files[0];
  if (!file) return showMessage("Escolha o arquivo .xlsx antes de continuar.");
  const form = new FormData(); form.append("file", file);
  const button = $("preview-button"); button.disabled = true; button.textContent = "Lendo planilha…";
  try { renderPreview(await api("/api/import/preview", { method: "POST", headers: {}, body: form })); }
  catch (error) { showMessage(error.message); }
  finally { button.disabled = false; button.textContent = "Conferir planilha"; }
}

async function commitImport() {
  if (!pendingContacts.length) return;
  const button = $("commit-import"); button.disabled = true; button.textContent = "Importando…";
  try {
    const result = await api("/api/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: pendingContacts }) });
    showMessage(`${result.imported} contato(s) importado(s). ${result.skippedAsDuplicate} duplicado(s) ignorado(s).`);
    pendingContacts = []; $("preview").classList.add("hidden"); $("file").value = ""; $("file-name").textContent = "Planilha no formato de empresas exportado";
    await loadContacts();
  } catch (error) { showMessage(error.message); button.disabled = false; button.textContent = "Tentar importar novamente"; }
}

$("auth-button").addEventListener("click", async () => {
  const current = authToken();
  const next = window.prompt("Informe o token de acesso configurado no servidor:", current);
  if (next === null) return;
  sessionStorage.setItem(tokenKey, next.trim());
  try { await api("/api/health"); $("auth-button").textContent = "Acesso conectado"; await loadContacts(); }
  catch (error) { sessionStorage.removeItem(tokenKey); $("auth-button").textContent = "Configurar acesso"; showMessage(error.message); }
});
$("file").addEventListener("change", () => { $("file-name").textContent = $("file").files[0]?.name ?? "Planilha no formato de empresas exportado"; });
$("preview-button").addEventListener("click", previewFile);
$("refresh-button").addEventListener("click", loadContacts);
$("status-filter").addEventListener("change", loadContacts);
let searchTimer;
$("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadContacts, 250); });

if (authToken()) { $("auth-button").textContent = "Acesso conectado"; loadContacts(); }

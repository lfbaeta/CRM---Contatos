const STATUSES = [
  { id: "novo", label: "Novo" },
  { id: "interessado", label: "Interessado" },
  { id: "nao_respondeu", label: "Não respondeu" },
  { id: "sem_interesse", label: "Sem interesse" },
  { id: "convertido", label: "Convertido" },
];
const tokenKey = "crm-contatos-token";
let pendingContacts = [];
let page = 1, requestVersion = 0, activeContact = null;
let visibleContacts = [];
const $ = (id) => document.getElementById(id);
const authToken = () => sessionStorage.getItem(tokenKey) ?? "";
const headers = () => ({ Authorization: `Bearer ${authToken()}` });
const statusLabel = (id) => STATUSES.find((item) => item.id === id)?.label ?? id;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) disconnect();
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
  visibleContacts = contacts;
  const tbody = $("contact-rows");
  if (window.crmSummary) updateStats(window.crmSummary);
  if (!contacts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum contato encontrado para este filtro.</td></tr>';
    $("table-note").textContent = ""; return;
  }
  tbody.innerHTML = contacts.map((contact) => {
    const options = STATUSES.map((item) => `<option value="${item.id}" ${contact.contact_status === item.id ? "selected" : ""}>${item.label}</option>`).join("");
    return `<tr data-id="${contact.id}"><td><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(contact.email ?? "Sem e-mail")}</small></td><td>${contact.phone_original ? `<button class="phone-copy" type="button" title="Copiar telefone para colar no WhatsApp" aria-label="Copiar telefone de ${escapeHtml(contact.name)}">${escapeHtml(contact.phone_original)}</button>` : "—"}</td><td>${escapeHtml(contact.address ?? "—")}</td><td>${escapeHtml(contact.category ?? "—")}</td><td><select class="status-select" aria-label="Status de ${escapeHtml(contact.name)}">${options}</select></td><td><div class="contact-actions">${/^55\d{10,11}$/.test(contact.phone_normalized ?? "") ? `<a href="https://wa.me/${contact.phone_normalized}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.name + " " + (contact.address ?? ""))}" target="_blank" rel="noopener noreferrer">Mapa</a><button class="button button-light notes-button" type="button">Observações</button></div><small class="note-snippet">${escapeHtml((contact.notes ?? "").slice(0, 140))}</small></td></tr>`;
  }).join("");
  $("table-note").textContent = contacts.length >= 2000 ? "Mostrando até 2.000 registros. Refine a busca para localizar outros." : `${contacts.length} contato(s) exibido(s).`;
  tbody.querySelectorAll(".phone-copy").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest("tr");
    const contact = visibleContacts.find(item => item.id === row.dataset.id);
    const digits = String(contact?.phone_normalized || contact?.phone_original || "").replace(/\D/g, "");
    const number = digits.length >= 12 && digits.startsWith("55") ? `+${digits}` : digits;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(number);
      else { const field = document.createElement("textarea"); field.value = number; field.style.position = "fixed"; field.style.opacity = "0"; document.body.append(field); field.select(); const copied = document.execCommand("copy"); field.remove(); if (!copied) throw new Error("clipboard indisponível"); }
      button.classList.add("copied"); window.setTimeout(() => button.classList.remove("copied"), 1300); showMessage(`Telefone copiado: ${number}`);
    } catch { showMessage("Não consegui copiar. Selecione o número e copie manualmente."); }
  }));
  tbody.querySelectorAll(".notes-button").forEach(button => button.addEventListener("click", () => openNotes(button.closest("tr").dataset.id)));
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
  const version = ++requestVersion;
  const params = new URLSearchParams({ q: $("search").value, status: $("status-filter").value,
    location: $("location").value, category: $("category-filter").value, sort: $("sort").value, page: String(page), pageSize: "50" });
  try {
    const data = await api(`/api/contacts?${params}`);
    if (version !== requestVersion || !authToken()) return;
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (page > pages) { page = pages; return loadContacts(); }
    window.crmSummary = data.summary; renderContacts(data.contacts);
    $("table-note").textContent = `${data.total} resultado(s) · ${data.contacts.length} nesta página`;
    $("page-label").textContent = `Página ${page} de ${pages}`;
    $("prev-page").disabled = page <= 1; $("next-page").disabled = page >= pages;
  } catch (error) { if (version === requestVersion) showMessage(error.message); }
}
async function loadCategories() {
  try {
    const data = await api('/api/filters');
    if (!authToken()) return;
    const selected = $("category-filter").value;
    $("category-filter").replaceChildren(new Option('Todas', ''), ...data.categories.map(c => new Option(c,c)));
    $("category-filter").value = data.categories.includes(selected) ? selected : '';
  } catch (error) { showMessage(error.message); }
}
function openNotes(id) {
  activeContact = visibleContacts.find(c => c.id === id);
  $("notes-title").textContent = activeContact.name;
  $("notes-text").value = activeContact.notes ?? '';
  $("notes-error").textContent = '';
  $("notes-dialog").showModal();
}
$("notes-cancel").addEventListener('click', () => $("notes-dialog").close());
$("notes-form").addEventListener('submit', async event => {
  event.preventDefault(); $("notes-save").disabled = true;
  try { await api(`/api/contacts/${activeContact.id}/notes`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notes:$("notes-text").value}) }); $("notes-dialog").close(); await loadContacts(); }
  catch(error) { $("notes-error").textContent = error.message; }
  finally { $("notes-save").disabled = false; }
});
function disconnect() {
  sessionStorage.removeItem(tokenKey); requestVersion++;
  visibleContacts = []; pendingContacts = []; activeContact = null; window.crmSummary = null;
  $("preview").classList.add('hidden'); $("preview").replaceChildren();
  $("notes-text").value = ''; $("notes-dialog").close();
  $("auth-button").textContent = 'Configurar acesso'; $("logout-button").classList.add('hidden');
  $("contact-rows").innerHTML = '<tr><td colspan="6" class="empty">Configure seu acesso para carregar os contatos.</td></tr>';
  $("category-filter").replaceChildren(new Option('Todas',''));
  for (const id of ['stat-total','stat-interessado','stat-sem-resposta','stat-convertido']) $(id).textContent = '—';
  $("table-note").textContent = ''; $("prev-page").disabled = true; $("next-page").disabled = true;
}

function renderPreview(data) {
  pendingContacts = data.ready;
  const preview = $("preview");
  preview.classList.remove("hidden");
  preview.innerHTML = `<div class="preview-top"><span class="preview-title">Revise antes de importar</span><span class="chip">Status inicial: <b>Novo</b></span></div><div class="preview-counts"><span class="chip"><b>${data.total}</b> linhas lidas</span><span class="chip"><b>${data.ready.length}</b> prontas para importar</span><span class="chip"><b>${data.invalid}</b> com campos inválidos</span><span class="chip"><b>${data.duplicatesInFile}</b> repetidas no arquivo</span><span class="chip"><b>${data.alreadyRegistered}</b> já cadastradas</span></div><div class="preview-actions"><button class="button button-light" id="cancel-import" type="button">Cancelar</button><button class="button button-primary" id="commit-import" type="button" ${data.ready.length ? "" : "disabled"}>Importar ${data.ready.length} contato(s)</button></div>`;
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
    page = 1; await loadCategories(); await loadContacts();
  } catch (error) { showMessage(error.message); button.disabled = false; button.textContent = "Tentar importar novamente"; }
}

$("auth-button").addEventListener('click', () => { $("token-input").value = ''; $("auth-error").textContent = ''; $("auth-dialog").showModal(); });
$("auth-cancel").addEventListener('click', () => $("auth-dialog").close());
$("auth-form").addEventListener('submit', async event => {
  event.preventDefault();
  sessionStorage.setItem(tokenKey, $("token-input").value.trim()); $("token-input").value = '';
  try { await api('/api/health'); $("auth-dialog").close(); $("auth-button").textContent = 'Acesso conectado'; $("logout-button").classList.remove('hidden'); page = 1; await loadCategories(); await loadContacts(); }
  catch(error) { disconnect(); $("auth-error").textContent = error.message; }
});
$("logout-button").addEventListener('click', disconnect);
$("file").addEventListener('change', () => { pendingContacts = []; $("preview").classList.add('hidden'); $("file-name").textContent = $("file").files[0]?.name ?? 'Planilha no formato de empresas exportado'; });
$("preview-button").addEventListener('click', previewFile);
$("refresh-button").addEventListener('click', loadContacts);
for (const id of ['status-filter','category-filter','sort']) $(id).addEventListener('change', () => { page = 1; loadContacts(); });
let searchTimer;
for (const id of ['search','location']) $(id).addEventListener('input', () => { clearTimeout(searchTimer); requestVersion++; page = 1; searchTimer = setTimeout(loadContacts, 250); });
$("clear-filters").addEventListener('click', () => { clearTimeout(searchTimer); for (const id of ['search','location','category-filter']) $(id).value = ''; $("status-filter").value = 'todos'; $("sort").value = 'recent'; page = 1; loadContacts(); });
$("prev-page").addEventListener('click', () => { if (page > 1) { page--; loadContacts(); } });
$("next-page").addEventListener('click', () => { page++; loadContacts(); });
if (authToken()) {
  api('/api/health').then(async () => { $("auth-button").textContent = 'Acesso conectado'; $("logout-button").classList.remove('hidden'); await loadCategories(); await loadContacts(); }).catch(error => { disconnect(); showMessage(error.message); });
}

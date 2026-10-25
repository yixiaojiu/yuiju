const input = document.querySelector("#connection");
const tabStatus = document.querySelector("#tab-status");
const backendStatus = document.querySelector("#backend-status");
const error = document.querySelector("#error");
const connectButton = document.querySelector("#connect");
const disconnectButton = document.querySelector("#disconnect");

async function updateStatus() {
  const state = await chrome.storage.session.get(["targetTabId", "tabStatus", "backendStatus"]);
  tabStatus.textContent = state.tabStatus ?? "未连接";
  backendStatus.textContent = state.backendStatus ?? "尚未连接";
  const bound = typeof state.targetTabId === "number";
  connectButton.disabled = bound;
  disconnectButton.disabled = !bound;
  input.disabled = bound;
}
async function connect() {
  error.textContent = "";
  try {
    const connection = JSON.parse(input.value);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ type: "connect", connection, tabId: tab.id });
    if (result.error) {
      error.textContent = result.error;
    }
    await updateStatus();
  } catch (cause) {
    error.textContent = String(cause);
  }
}
async function disconnect() {
  error.textContent = "";
  try {
    const result = await chrome.runtime.sendMessage({ type: "disconnect" });
    if (result.error) {
      error.textContent = result.error;
    }
    await updateStatus();
  } catch (cause) {
    error.textContent = String(cause);
  }
}
async function initialize() {
  const { connection } = await chrome.storage.local.get("connection");
  if (connection) {
    input.value = connection;
  }
  await updateStatus();
}
connectButton.addEventListener("click", connect);
disconnectButton.addEventListener("click", disconnect);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "session") {
    updateStatus();
  }
});
initialize();

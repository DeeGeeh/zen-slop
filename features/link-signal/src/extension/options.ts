import { config, settingsSchema } from "../shared.js";

const form = document.querySelector("form");
const token = document.querySelector<HTMLInputElement>("#token");
const enabled = document.querySelector<HTMLInputElement>("#enabled");
const status = document.querySelector<HTMLOutputElement>("output");
if (!form || !token || !enabled || !status) throw new Error("Missing settings form");
const controls = { form, token, enabled, status };
const settings = settingsSchema.parse(await browser.storage.local.get(["enabled", "token"]));
controls.token.value = settings.token;
controls.enabled.checked = settings.enabled;
if (config.hosted) document.querySelector<HTMLElement>("#local-settings")!.hidden = true;
controls.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (controls.enabled.checked && !config.hosted && controls.token.value.length < 32) {
    controls.status.textContent = "Enter the service access token first.";
    return;
  }
  try {
    await browser.storage.local.set({ enabled: controls.enabled.checked, token: controls.token.value });
    controls.status.textContent = controls.enabled.checked ? "Link Signals are on. You're ready to search." : "Link Signals are off.";
  } catch {
    controls.status.textContent = "Could not save. Try again.";
  }
});

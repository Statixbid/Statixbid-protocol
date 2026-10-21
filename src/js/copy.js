export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function announce(msg) {
  const live = document.getElementById("live-msg");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = msg; });
}

// Flip a button into its "done" state for a short moment.
export function flashDone(btn, ms = 1600) {
  btn.classList.add("is-done");
  clearTimeout(btn._doneTimer);
  btn._doneTimer = setTimeout(() => btn.classList.remove("is-done"), ms);
}

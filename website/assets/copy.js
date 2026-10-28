// Copies a handoff prompt to the clipboard; without JavaScript the text stays selectable.
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy).querySelector("p").textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Kopiert";
      setTimeout(() => { button.textContent = "Kopieren"; }, 1600);
    } catch {
      getSelection().selectAllChildren(document.getElementById(button.dataset.copy).querySelector("p"));
    }
  });
}

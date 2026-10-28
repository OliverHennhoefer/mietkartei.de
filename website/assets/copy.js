// Copies a handoff task to the clipboard; without JavaScript the task stays readable under "Was steht im Auftrag?".
for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    const task = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(task.textContent);
      button.textContent = "Kopiert, jetzt einfügen";
      setTimeout(() => { button.textContent = label; }, 2000);
    } catch {
      task.closest("details").open = true;
      getSelection().selectAllChildren(task);
    }
  });
}

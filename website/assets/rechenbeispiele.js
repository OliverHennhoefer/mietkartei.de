// Shows one step of a reference case at a time, with the step list and Zurück/Weiter to move;
// the address keeps the step (#schritt-3), so a link or reload opens the same one. Without
// JavaScript every step shows one below the other.
const steps = [...document.querySelectorAll(".case-step")];
const links = [...document.querySelectorAll(".case-steps a")];
const pager = document.querySelector(".case-pager");

if (steps.length > 0 && pager) {
  const [back, next] = pager.querySelectorAll("button");
  let current = 0;

  const show = (index, scroll) => {
    current = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((step, i) => { step.hidden = i !== current; });
    links.forEach((link, i) => {
      if (i === current) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
    back.disabled = current === 0;
    next.disabled = current === steps.length - 1;
    if (scroll) document.querySelector(".case-steps").scrollIntoView({ block: "start" });
  };
  const fromHash = () => Math.max(0, steps.findIndex((step) => `#${step.id}` === location.hash));

  pager.hidden = false;
  document.documentElement.classList.add("case-paged");
  for (const button of [back, next]) {
    button.addEventListener("click", () => {
      show(current + Number(button.dataset.step), true);
      history.replaceState(null, "", `#${steps[current].id}`);
    });
  }
  links.forEach((link, i) => link.addEventListener("click", (event) => {
    event.preventDefault();
    show(i, false);
    history.replaceState(null, "", `#${steps[i].id}`);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select") || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === "ArrowRight") next.click();
    if (event.key === "ArrowLeft") back.click();
  });
  addEventListener("hashchange", () => show(fromHash(), false));
  show(fromHash(), false);
}

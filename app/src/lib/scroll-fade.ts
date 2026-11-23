// Marks a box that scrolls sideways with the sides where more content waits, so the styles can fade
// that edge (`.scroll-fade` in app.css). Without the mark nothing tells that a chart goes on.
export function scrollFade(node: HTMLElement) {
	const update = () => {
		const hidden = node.scrollWidth - node.clientWidth;
		node.classList.toggle('more-before', node.scrollLeft > 1);
		node.classList.toggle('more-after', node.scrollLeft < hidden - 1);
	};
	const observer = new ResizeObserver(update);
	observer.observe(node);
	node.addEventListener('scroll', update, { passive: true });
	update();
	return {
		destroy() {
			observer.disconnect();
			node.removeEventListener('scroll', update);
		}
	};
}

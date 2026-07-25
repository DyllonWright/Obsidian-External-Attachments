/*
 * DOM predicates for placing embeds. Plain DOM only — no Obsidian imports and
 * no filesystem — so the test suite can drive it through jsdom.
 */

/**
 * Containers that hold whole stretches of a note. `text-align` inherits, so
 * marking one of these would re-align every paragraph and heading inside it.
 */
export const LAYOUT_CONTAINERS = [
	"markdown-preview-view", "markdown-preview-sizer", "markdown-preview-section",
	"markdown-rendered", "markdown-source-view", "markdown-embed",
	"cm-content", "cm-sizer", "cm-contentContainer", "cm-scroller", "cm-editor"
];

/**
 * Structural filler that carries no content of its own.
 *
 * CodeMirror pads every widget in a line with `img.cm-widgetBuffer` markers and
 * empty spans, so a row of embeds in Live Preview arrives as
 * `[buffer, span, buffer, buffer, embed, buffer, " ", buffer, embed]`. Reading
 * those as "not embeds, therefore prose" is what made a real row look like a
 * paragraph. Anything carrying text or media of its own still counts as
 * content, which keeps the prose test honest.
 */
function isScaffolding(el: Element): boolean {
	if (el.tagName === "BR") return true;
	if (el.classList.contains("cm-widgetBuffer")) return true;
	if ((el.textContent || "").trim()) return false;
	return el.querySelector("img, video, audio, iframe, canvas, svg, picture") === null;
}

/**
 * True for a wrapper built purely around embeds — an image paragraph or a Live
 * Preview line of images, whose alignment nothing else in the note shares.
 *
 * Anything holding prose fails, on purpose. An earlier build set `text-align`
 * on whatever ancestor happened to contain an embed, and since the property
 * inherits, one right-aligned image swung every heading and paragraph around
 * it. A wrapper qualifies only when every element child is either an embed or
 * empty scaffolding, and every direct text node reads as whitespace.
 */
export function holdsEmbedsOnly(el: Element): boolean {
	for (const cls of LAYOUT_CONTAINERS) {
		if (el.classList.contains(cls)) return false;
	}

	let embeds = 0;
	for (let i = 0; i < el.childNodes.length; i++) {
		const node = el.childNodes[i];
		if (node.nodeType === 3 /* TEXT_NODE */) {
			if (node.textContent && node.textContent.trim()) return false;
			continue;
		}
		if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
		const child = node as Element;
		if (child.classList.contains("internal-embed")) {
			embeds++;
			continue;
		}
		if (!isScaffolding(child)) return false;
	}
	return embeds > 0;
}

/** How many embeds share this wrapper — one means the embed owns its line. */
export function countEmbeds(el: Element): number {
	let n = 0;
	for (let i = 0; i < el.children.length; i++) {
		if (el.children[i].classList.contains("internal-embed")) n++;
	}
	return n;
}

/**
 * True when this wrapper really holds a row of embeds written on one line.
 *
 * Counting alone can't tell a row from a whole note: in Live Preview an embed's
 * parent is `.cm-content`, which holds every embed in the file, so a note with
 * two images anywhere would read as a two-image row. The embeds-only test
 * rejects that container first — it holds `.cm-line` prose too.
 */
export function isEmbedRow(el: Element | null): boolean {
	return el !== null && holdsEmbedsOnly(el) && countEmbeds(el) > 1;
}

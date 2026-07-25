// Bundle the resolver (pure Node, no Obsidian imports) and run the suite
// against real temporary directories.
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import assert from "assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, ".build");
const src = path.join(here, "..", "src");

await build({
	entryPoints: [path.join(src, "resolver.ts"), path.join(src, "layout.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "es2020",
	outExtension: { ".js": ".mjs" },
	outdir
});

const {
	MountResolver, buildIndex, linkpathOf, mimeFor, mountStatus,
	parseEmbedAlign, parseEmbedSize
} = await import(pathToFileURL(path.join(outdir, "resolver.mjs")).href);

const { countEmbeds, holdsEmbedsOnly, isEmbedRow } =
	await import(pathToFileURL(path.join(outdir, "layout.mjs")).href);

let passed = 0;
function ok(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => {
			passed++;
			console.log(`  ✓ ${name}`);
		})
		.catch((err) => {
			console.error(`  ✗ ${name}`);
			console.error(err);
			process.exitCode = 1;
		});
}

// --- fixtures -------------------------------------------------------------
const rootA = mkdtempSync(path.join(tmpdir(), "ea-mount-a-"));
const rootB = mkdtempSync(path.join(tmpdir(), "ea-mount-b-"));
writeFileSync(path.join(rootA, "photo.png"), "A-photo");
writeFileSync(path.join(rootA, "shared.pdf"), "A-shared");
writeFileSync(path.join(rootB, "shared.pdf"), "B-shared");
writeFileSync(path.join(rootB, "clip.mp4"), "B-clip");
mkdirSync(path.join(rootB, "nested", "deep"), { recursive: true });
writeFileSync(path.join(rootB, "nested", "deep", "buried.jpg"), "B-buried");

// --- pure helpers ---------------------------------------------------------
await ok("linkpathOf strips #section and |alias", () => {
	assert.equal(linkpathOf("photo.png#page=3"), "photo.png");
	assert.equal(linkpathOf("photo.png|400"), "photo.png");
	assert.equal(linkpathOf("dir/photo.png#x|300"), "dir/photo.png");
});

await ok("mimeFor maps known and unknown extensions", () => {
	assert.equal(mimeFor("a.PNG"), "image/png");
	assert.equal(mimeFor("b.flac"), "audio/flac");
	assert.equal(mimeFor("c.xyz"), "application/octet-stream");
});

// --- embed sizing ----------------------------------------------------------
await ok("parseEmbedSize reads |WIDTH and |WIDTHxHEIGHT off a raw target", () => {
	assert.deepEqual(parseEmbedSize("photo.png|400"), { width: "400" });
	assert.deepEqual(parseEmbedSize("photo.png|400x300"), { width: "400", height: "300" });
	assert.deepEqual(parseEmbedSize("dir/photo.png#page=2|400"), { width: "400" });
});

await ok("parseEmbedSize tolerates the spaces people actually type", () => {
	assert.deepEqual(parseEmbedSize("photo.png | 400"), { width: "400" });
	assert.deepEqual(parseEmbedSize("photo.png | 400 x 300"), { width: "400", height: "300" });
});

await ok("parseEmbedSize accepts a bare size, as a resolved embed's alt gives it", () => {
	assert.deepEqual(parseEmbedSize("400"), { width: "400" });
	assert.deepEqual(parseEmbedSize("400x300"), { width: "400", height: "300" });
});

await ok("parseEmbedSize takes the last numeric segment, past any alias", () => {
	assert.deepEqual(parseEmbedSize("photo.png|a caption|400"), { width: "400" });
});

await ok("parseEmbedSize returns null when no segment reads as a size", () => {
	assert.equal(parseEmbedSize("photo.png"), null);
	assert.equal(parseEmbedSize("photo.png|a caption"), null);
	assert.equal(parseEmbedSize("2026.png"), null);
	assert.equal(parseEmbedSize("photo.png|400px"), null);
	assert.equal(parseEmbedSize(null, undefined, ""), null);
});

await ok("parseEmbedSize falls through candidates in order", () => {
	// src carries nothing; the link text an unresolved embed renders carries it.
	assert.deepEqual(parseEmbedSize("photo.png", "photo.png", null, "photo.png|400"), { width: "400" });
	// An earlier candidate with a size wins over a later one.
	assert.deepEqual(parseEmbedSize("photo.png|400", "photo.png|900"), { width: "400" });
});

await ok("parseEmbedAlign reads an alignment word off the wikilink", () => {
	assert.equal(parseEmbedAlign("photo.png|right"), "right");
	assert.equal(parseEmbedAlign("photo.png|400|right"), "right");
	assert.equal(parseEmbedAlign("photo.png | Center "), "center");
});

await ok("parseEmbedAlign ignores the filename segment and unknown words", () => {
	assert.equal(parseEmbedAlign("left.png"), null);
	assert.equal(parseEmbedAlign("photo.png"), null);
	assert.equal(parseEmbedAlign("photo.png|400"), null);
	assert.equal(parseEmbedAlign("photo.png|justified"), null);
});

await ok("size and alignment coexist on one link, in either order", () => {
	assert.deepEqual(parseEmbedSize("photo.png|400|right"), { width: "400" });
	assert.equal(parseEmbedAlign("photo.png|400|right"), "right");
	assert.deepEqual(parseEmbedSize("photo.png|right|400x300"), { width: "400", height: "300" });
	assert.equal(parseEmbedAlign("photo.png|right|400x300"), "right");
});

// --- alignment guard (real DOM via jsdom) -----------------------------------
// A regression net for the bug where aligning an embed re-aligned the whole
// note: text-align inherits, so only an embeds-only wrapper may carry it.
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const doc = dom.window.document;

function frag(html) {
	const host = doc.createElement("div");
	host.innerHTML = html;
	return host.firstElementChild;
}

await ok("holdsEmbedsOnly accepts a paragraph built only of embeds", () => {
	assert.equal(holdsEmbedsOnly(frag('<p><span class="internal-embed"></span></p>')), true);
	assert.equal(
		holdsEmbedsOnly(frag(
			'<p><span class="internal-embed"></span> <span class="internal-embed"></span></p>'
		)),
		true,
		"two embeds separated by whitespace still qualify"
	);
	assert.equal(
		holdsEmbedsOnly(frag('<p><span class="internal-embed"></span><br></p>')),
		true,
		"a trailing line break is harmless"
	);
});

await ok("holdsEmbedsOnly refuses any wrapper that also holds prose", () => {
	assert.equal(
		holdsEmbedsOnly(frag('<p>See this: <span class="internal-embed"></span></p>')),
		false,
		"stray text would inherit the alignment"
	);
	assert.equal(
		holdsEmbedsOnly(frag(
			'<div><h2>Heading</h2><p><span class="internal-embed"></span></p></div>'
		)),
		false,
		"a heading sibling would swing with the image"
	);
	assert.equal(
		holdsEmbedsOnly(frag('<div><span class="internal-embed"></span><em>caption</em></div>')),
		false
	);
});

await ok("holdsEmbedsOnly refuses Obsidian's own layout containers", () => {
	for (const cls of [
		"markdown-preview-view", "markdown-preview-sizer", "markdown-preview-section",
		"markdown-rendered", "markdown-source-view", "cm-content", "cm-sizer",
		"cm-contentContainer", "cm-scroller", "cm-editor"
	]) {
		assert.equal(
			holdsEmbedsOnly(frag(`<div class="${cls}"><span class="internal-embed"></span></div>`)),
			false,
			`${cls} must never take an alignment class`
		);
	}
});

await ok("countEmbeds tells a solo embed from a row", () => {
	// One embed on its line takes the auto-margin path, which no inherited
	// text-align can override; a row keeps inline-block so it flows side by side.
	assert.equal(countEmbeds(frag('<p><span class="internal-embed"></span></p>')), 1);
	assert.equal(
		countEmbeds(frag(
			'<p><span class="internal-embed"></span> <span class="internal-embed"></span></p>'
		)),
		2
	);
	assert.equal(countEmbeds(frag('<p><span class="internal-embed"></span><br></p>')), 1);
	assert.equal(countEmbeds(frag("<p><img></p>")), 0);
});

// Captured from Obsidian's DevTools: a Live Preview line holding a row of
// embeds, CodeMirror's widget buffers and empty spans included verbatim.
const CM_ROW =
	'<div class="cm-line">' +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	"<span></span>" +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	'<div class="internal-embed"><img src="x"></div>' +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	" " +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	'<div class="internal-embed"><img src="x"></div>' +
	'<img class="cm-widgetBuffer" aria-hidden="true">' +
	"</div>";

await ok("a Live Preview row of embeds reads as a row, buffers and all", () => {
	const line = frag(CM_ROW);
	assert.equal(countEmbeds(line), 2);
	assert.equal(
		holdsEmbedsOnly(line),
		true,
		"cm-widgetBuffer images and empty spans are scaffolding, not prose"
	);
	assert.equal(isEmbedRow(line), true);
});

await ok("a Live Preview line mixing prose with an embed is not a row", () => {
	const line = frag(
		'<div class="cm-line">' +
		'<img class="cm-widgetBuffer" aria-hidden="true">' +
		"<span>See this: </span>" +
		'<div class="internal-embed"><img src="x"></div>' +
		'<div class="internal-embed"><img src="x"></div>' +
		"</div>"
	);
	assert.equal(isEmbedRow(line), false, "the span carries text, so it's prose");
});

await ok("scaffolding tolerance does not admit a sibling image", () => {
	// A bare <img> beside an embed is content someone put there, not filler.
	const line = frag(
		'<div class="cm-line"><div class="internal-embed"></div>' +
		'<span><img src="x"></span><div class="internal-embed"></div></div>'
	);
	assert.equal(isEmbedRow(line), false);
});

await ok("isEmbedRow refuses .cm-content, however many embeds it holds", () => {
	// Live Preview parents every embed to .cm-content, so a bare count would
	// read a note with two images anywhere as one two-image row, shrink-wrap
	// both containers, and then decline to align them.
	const livePreview = frag(
		'<div class="cm-content cm-lineWrapping">' +
		'<div class="cm-gap"></div>' +
		'<div class="cm-line">Some prose.</div>' +
		'<div class="internal-embed"></div>' +
		'<div class="cm-line">More prose.</div>' +
		'<div class="internal-embed"></div>' +
		"</div>"
	);
	assert.equal(countEmbeds(livePreview), 2, "the count alone still sees two");
	assert.equal(isEmbedRow(livePreview), false, "but they share a note, not a line");
});

await ok("isEmbedRow accepts a genuine row and rejects a lone embed", () => {
	assert.equal(
		isEmbedRow(frag(
			'<p><span class="internal-embed"></span> <span class="internal-embed"></span></p>'
		)),
		true
	);
	assert.equal(isEmbedRow(frag('<p><span class="internal-embed"></span></p>')), false);
	assert.equal(isEmbedRow(null), false);
});

await ok("holdsEmbedsOnly refuses a wrapper with no embed at all", () => {
	assert.equal(holdsEmbedsOnly(frag("<p></p>")), false);
	assert.equal(holdsEmbedsOnly(frag("<p><img></p>")), false);
});

// --- direct (flat) resolution ----------------------------------------------
await ok("resolves from a single mount root", async () => {
	const r = new MountResolver({ mounts: [rootA], recursive: false });
	assert.equal(await r.resolve("photo.png"), path.join(rootA, "photo.png"));
});

await ok("returns null when the file exists nowhere", async () => {
	const r = new MountResolver({ mounts: [rootA, rootB], recursive: false });
	assert.equal(await r.resolve("ghost.png"), null);
});

await ok("earlier mounts win on duplicate filenames", async () => {
	const r = new MountResolver({ mounts: [rootA, rootB], recursive: false });
	assert.equal(await r.resolve("shared.pdf"), path.join(rootA, "shared.pdf"));
	const r2 = new MountResolver({ mounts: [rootB, rootA], recursive: false });
	assert.equal(await r2.resolve("shared.pdf"), path.join(rootB, "shared.pdf"));
});

await ok("flat mode ignores files in subfolders", async () => {
	const r = new MountResolver({ mounts: [rootB], recursive: false });
	assert.equal(await r.resolve("buried.jpg"), null);
});

// --- recursive index --------------------------------------------------------
await ok("recursive mode finds files in nested subfolders", async () => {
	const r = new MountResolver({ mounts: [rootB], recursive: true });
	assert.equal(await r.resolve("buried.jpg"), path.join(rootB, "nested", "deep", "buried.jpg"));
});

await ok("index lookups match case-insensitively", async () => {
	const r = new MountResolver({ mounts: [rootB], recursive: true });
	assert.equal(await r.resolve("BURIED.JPG"), path.join(rootB, "nested", "deep", "buried.jpg"));
});

await ok("invalidate() picks up files added after first index build", async () => {
	const r = new MountResolver({ mounts: [rootB], recursive: true });
	assert.equal(await r.resolve("late.png"), null);
	writeFileSync(path.join(rootB, "nested", "late.png"), "B-late");
	assert.equal(await r.resolve("late.png"), null, "stale index should miss");
	r.invalidate();
	assert.equal(await r.resolve("late.png"), path.join(rootB, "nested", "late.png"));
});

await ok("buildIndex tolerates unreadable mounts", async () => {
	const index = await buildIndex([path.join(rootA, "does-not-exist"), rootA]);
	assert.equal(index.get("photo.png"), path.join(rootA, "photo.png"));
});

await ok("empty mount entries stay inert", async () => {
	const r = new MountResolver({ mounts: ["", rootA], recursive: false });
	assert.equal(r.active, true);
	assert.equal(await r.resolve("photo.png"), path.join(rootA, "photo.png"));
	const off = new MountResolver({ mounts: [""], recursive: false });
	assert.equal(off.active, false);
});

// --- mount status ------------------------------------------------------------
await ok("mountStatus reports ok / missing / not-a-folder", () => {
	assert.equal(mountStatus(rootA).ok, true);
	assert.equal(mountStatus(path.join(rootA, "nope")).ok, false);
	assert.equal(mountStatus(path.join(rootA, "photo.png")).ok, false);
	assert.equal(mountStatus("").ok, false);
});

// --- cleanup -----------------------------------------------------------------
rmSync(rootA, { recursive: true, force: true });
rmSync(rootB, { recursive: true, force: true });

if (process.exitCode) {
	console.error("\nFAILED");
} else {
	console.log(`\n${passed} assertions passed`);
}

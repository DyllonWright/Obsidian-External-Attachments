// Bundle the resolver (pure Node, no Obsidian imports) and run the suite
// against real temporary directories.
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import assert from "assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, ".build", "resolver.mjs");

await build({
	entryPoints: [path.join(here, "..", "src", "resolver.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "es2020",
	outfile
});

const { MountResolver, buildIndex, linkpathOf, mimeFor, mountStatus } =
	await import(pathToFileURL(outfile).href);

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

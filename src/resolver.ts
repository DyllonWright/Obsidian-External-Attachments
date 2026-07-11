/*
 * Mount resolution: pure Node fs/path logic, no Obsidian imports,
 * so the test suite can exercise it directly.
 */
import * as fs from "fs";
import * as path from "path";

export const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
export const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac)$/i;
export const PDF_EXT = /\.pdf$/i;

export const MIME: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
	webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
	mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v",
	mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
	pdf: "application/pdf"
};

export function mimeFor(basename: string): string {
	const ext = path.extname(basename).slice(1).toLowerCase();
	return MIME[ext] || "application/octet-stream";
}

/** Strip #section and |alias from a wikilink target, keep just the link path. */
export function linkpathOf(src: string): string {
	return src.split(/[#|]/)[0].trim();
}

export interface ResolverOptions {
	/** Ordered list of external folders; earlier entries win. */
	mounts: string[];
	/** Also search subfolders of each mount (uses a cached index). */
	recursive: boolean;
}

const MAX_DEPTH = 24;

async function walk(dir: string, mountRoot: string, index: Map<string, string>, depth: number): Promise<void> {
	if (depth > MAX_DEPTH) return;
	let entries;
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(full, mountRoot, index, depth + 1);
		} else if (entry.isFile()) {
			const key = entry.name.toLowerCase();
			if (!index.has(key)) index.set(key, full);
		}
		// Symlinks get skipped on purpose: no loops, no surprises.
	}
}

/** Map lowercased basename → absolute path, across all mounts, earlier mounts winning. */
export async function buildIndex(mounts: string[]): Promise<Map<string, string>> {
	const index = new Map<string, string>();
	for (const mount of mounts) {
		if (!mount) continue;
		await walk(mount, mount, index, 0);
	}
	return index;
}

export class MountResolver {
	private opts: ResolverOptions;
	private index: Map<string, string> | null = null;
	private indexing: Promise<Map<string, string>> | null = null;

	constructor(opts: ResolverOptions) {
		this.opts = opts;
	}

	setOptions(opts: ResolverOptions): void {
		this.opts = opts;
		this.invalidate();
	}

	/** Drop the cached subfolder index; the next recursive lookup rebuilds it. */
	invalidate(): void {
		this.index = null;
		this.indexing = null;
	}

	get active(): boolean {
		return this.opts.mounts.some((m) => m.length > 0);
	}

	/**
	 * Find a file by basename. Checks the root of each mount in order first
	 * (the fast path), then falls back to the recursive index when enabled.
	 * Returns the absolute path, or null when no mount holds the file.
	 */
	async resolve(basename: string): Promise<string | null> {
		for (const mount of this.opts.mounts) {
			if (!mount) continue;
			const direct = path.join(mount, basename);
			try {
				const stat = await fs.promises.stat(direct);
				if (stat.isFile()) return direct;
			} catch {
				/* keep looking */
			}
		}
		if (this.opts.recursive) {
			if (!this.index) {
				// Share one in-flight build between concurrent lookups.
				if (!this.indexing) {
					this.indexing = buildIndex(this.opts.mounts);
				}
				this.index = await this.indexing;
				this.indexing = null;
			}
			return this.index.get(basename.toLowerCase()) ?? null;
		}
		return null;
	}

	async read(absolutePath: string): Promise<Buffer> {
		return fs.promises.readFile(absolutePath);
	}
}

export interface MountStatus {
	ok: boolean;
	detail: string;
}

/** Human-readable health check for one mount path (settings UI). */
export function mountStatus(mount: string): MountStatus {
	if (!mount) return { ok: false, detail: "empty path" };
	try {
		const stat = fs.statSync(mount);
		if (!stat.isDirectory()) return { ok: false, detail: "path exists but points to a file, not a folder" };
		const entries = fs.readdirSync(mount);
		return { ok: true, detail: `connected — ${entries.length} entries` };
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		return { ok: false, detail: `cannot access (${code || String(e)})` };
	}
}

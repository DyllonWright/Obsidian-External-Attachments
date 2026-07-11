import { MarkdownView, Notice, Plugin } from "obsidian";
import * as path from "path";
import {
	AUDIO_EXT, IMG_EXT, PDF_EXT, VIDEO_EXT,
	MountResolver, linkpathOf, mimeFor
} from "./resolver";
import { DEFAULT_SETTINGS, ExternalAttachmentsSettingTab, ExternalAttachmentsSettings, migrateSettings } from "./settings";

interface EmbedContext {
	sourcePath: string;
}

export default class ExternalAttachmentsPlugin extends Plugin {
	settings: ExternalAttachmentsSettings;
	resolver: MountResolver;
	private blobUrls = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.resolver = new MountResolver({
			mounts: this.settings.mounts,
			recursive: this.settings.recursive
		});

		this.addSettingTab(new ExternalAttachmentsSettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el, ctx) => {
			this.processEmbeds(el, ctx);
		});

		// Live Preview doesn't fire the markdown post-processor for unresolved
		// embeds. Watch the workspace DOM and intercept embed elements as
		// CodeMirror inserts them.
		const liveObserver = new MutationObserver((mutations) => {
			if (!this.resolver.active) return;
			for (const m of mutations) {
				for (const n of m.addedNodes) {
					if (!(n instanceof Element)) continue;
					if (n.matches(".internal-embed:not([data-external-attachment])")) {
						void this.tryResolveExternal(n, { sourcePath: "" });
					}
					n.querySelectorAll(".internal-embed:not([data-external-attachment])").forEach((em) => {
						void this.tryResolveExternal(em, { sourcePath: "" });
					});
				}
			}
		});
		liveObserver.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
		this.register(() => liveObserver.disconnect());

		this.addCommand({
			id: "rescan-current-view",
			name: "Rescan current view for external attachments",
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				view?.previewMode?.rerender(true);
			}
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild external folder index",
			callback: () => {
				this.resolver.invalidate();
				new Notice("External Attachments: index cleared; it rebuilds on the next lookup.");
			}
		});
	}

	onunload(): void {
		for (const url of this.blobUrls) URL.revokeObjectURL(url);
		this.blobUrls.clear();
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const { settings, migrated } = migrateSettings(raw);
		this.settings = settings;
		if (migrated) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.resolver.setOptions({
			mounts: this.settings.mounts,
			recursive: this.settings.recursive
		});
	}

	private processEmbeds(el: HTMLElement, ctx: EmbedContext): void {
		if (!this.resolver.active) return;
		el.querySelectorAll("span.internal-embed, div.internal-embed").forEach((embed) => {
			void this.tryResolveExternal(embed, ctx);
		});
	}

	private async tryResolveExternal(embed: Element, ctx: EmbedContext): Promise<void> {
		try {
			await this.resolveEmbed(embed as HTMLElement, ctx);
		} catch (err) {
			console.warn("External Attachments: resolve failed for", embed.getAttribute("src"), err);
		}
	}

	private async resolveEmbed(embed: HTMLElement, ctx: EmbedContext): Promise<void> {
		const src = embed.getAttribute("src");
		if (!src) return;
		if (embed.getAttribute("data-external-attachment")) return;

		const linkpath = linkpathOf(src);
		const sourcePath = ctx?.sourcePath ?? "";

		// If the vault already resolves it, stay out of the way and let
		// Obsidian render normally.
		const vaultFile = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (vaultFile) return;

		const basename = path.basename(linkpath);
		const found = await this.resolver.resolve(basename);
		if (!found) {
			// Not present externally either — leave the broken embed as-is,
			// but remember the miss so we don't re-stat on every DOM change.
			embed.setAttribute("data-external-attachment", "miss");
			return;
		}

		const buffer = await this.resolver.read(found);
		const blob = new Blob([new Uint8Array(buffer)], { type: mimeFor(basename) });
		const url = URL.createObjectURL(blob);
		this.blobUrls.add(url);

		// Free the blob URL when this embed leaves the DOM.
		const parent = embed.parentNode;
		if (parent) {
			const observer = new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const n of m.removedNodes) {
						if (n === embed || (n instanceof Element && n.contains(embed))) {
							URL.revokeObjectURL(url);
							this.blobUrls.delete(url);
							observer.disconnect();
							return;
						}
					}
				}
			});
			observer.observe(parent, { childList: true });
		}

		embed.empty();
		embed.removeClass("is-unresolved");
		embed.removeClass("mod-error");
		embed.removeClass("file-embed");

		let mediaEl: HTMLElement | null = null;
		if (IMG_EXT.test(basename)) {
			mediaEl = embed.createEl("img", { attr: { src: url, alt: basename } });
		} else if (VIDEO_EXT.test(basename)) {
			mediaEl = embed.createEl("video", { attr: { src: url, controls: "controls" } });
		} else if (AUDIO_EXT.test(basename)) {
			mediaEl = embed.createEl("audio", { attr: { src: url, controls: "controls" } });
		} else if (PDF_EXT.test(basename)) {
			mediaEl = embed.createEl("iframe", { attr: { src: url, width: "100%", height: "600px" } });
		} else {
			embed.createEl("a", { text: "↗ " + basename, attr: { href: url, download: basename } });
		}

		// Honor |WIDTH or |WIDTHxHEIGHT on the wikilink (Obsidian puts it in
		// the alt attribute).
		const alt = embed.getAttribute("alt") || "";
		const dim = alt.match(/^(\d+)(?:x(\d+))?$/);
		if (dim && mediaEl) {
			mediaEl.setAttribute("width", dim[1]);
			if (dim[2]) mediaEl.setAttribute("height", dim[2]);
		}

		embed.setAttribute("data-external-attachment", "true");
		if (this.settings.showIndicator) {
			embed.addClass("external-attachment-indicator");
		}
	}
}

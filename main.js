var import_obsidian = require("obsidian");
// NOTE: Do not use Node's 'path' on mobile; provide a small POSIX join using Obsidian's normalizePath
function joinRepoPath(folderPath, fileName) {
    const raw = (folderPath || "").replace(/\\/g, "/").trim();
    const folder = raw.replace(/^\/+|\/+$/g, "");
    const combined = folder ? `${folder}/${fileName}` : fileName;
    try {
        return import_obsidian.normalizePath ? import_obsidian.normalizePath(combined) : combined.replace(/\/+/g, "/");
    } catch (_) {
        return combined.replace(/\/+/g, "/");
    }
}

// Convert binary data to base64 without quadratic string concatenation costs.
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 32768;
    const chunks = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        chunks.push(String.fromCharCode.apply(null, chunk));
    }
    return btoa(chunks.join(""));
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Platform detection
const isMobile = !!(import_obsidian.Platform && import_obsidian.Platform.isMobile);

// crypto.ts
var PBKDF2_ITERATIONS = 1e5;
var ALGORITHM = "AES-GCM";
async function getKey(password, salt) {
    const passwordBuffer = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey(
        "raw",
        passwordBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256"
        },
        baseKey,
        { name: ALGORITHM, length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}
async function encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await getKey(password, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedPlaintext = new TextEncoder().encode(plaintext);
    const encryptedContent = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        encodedPlaintext
    );
    const saltB64 = btoa(String.fromCharCode(...new Uint8Array(salt)));
    const ivB64 = btoa(String.fromCharCode(...new Uint8Array(iv)));
    const encryptedB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedContent)));
    return `${saltB64}:${ivB64}:${encryptedB64}`;
}
async function decrypt(encryptedString, password) {
    const [saltB64, ivB64, encryptedB64] = encryptedString.split(":");
    if (!saltB64 || !ivB64 || !encryptedB64) {
        throw new Error("Invalid encrypted data format.");
    }
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const encryptedContent = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const key = await getKey(password, salt);
    const decryptedContent = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        encryptedContent
    );
    return new TextDecoder().decode(decryptedContent);
}

// main.ts
var DEFAULT_SETTINGS = {
    githubUser: "",
    repoName: "",
    encryptedToken: "",
    plainToken: "",
    branchName: "main",
    folderPath: "assets/",
    deleteLocal: false,
    useEncryption: true,
    repoVisibility: 'auto',
    repoHistory: [],
    uploadOnPaste: 'always',
    localImageFolder: 'Notepixs-local',
    uploadImageFolder: 'Notepixs-uploads',
    autoUpload: true,
    extraWatchedFolders: '',
    extraWatchedList: [],
    localOnlyFolders: '',
    localOnlyList: [],
    attachmentsFolderName: 'attachment',
    integrateAttachmentsOnMobile: true,
    lastPromptedAt: 0,
    lastPromptedRepo: ''
};

var MyPlugin = class extends import_obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.decryptedToken = null;
        this.isPromptingForPassword = false;
        this.mobileAttachmentFolder = '';
        this.userApprovedUploads = new Map();
        this.pendingLinkReplacements = new Map();
        this.recentPlaceholdersByName = new Map();
        this.repoPrivacyCache = null;
        this._fileOpenDebounceTimer = null;
        this._mismatchNoticeShown = false;
        this._lastRenderTokenNoticeAt = 0;
        this.failedImageFetches = new Map();
        this.pendingLegacyMigrations = new Map();
        this.pendingLegacyMigrationTimers = new Map();
        this.repoListCache = null;
        this.legacyResolvedRepoByKey = new Map();
        this.legacyUnresolvedUntil = new Map();
    }

    // --- NEW METHOD: UPLOAD ALL EXISTING IMAGES ---
    async uploadAllLocalImagesInNote(activeFile) {
        if (!this.settings.githubUser || !this.settings.repoName) {
            new import_obsidian.Notice("GitHub User and Repo Name must be configured first.");
            return;
        }

        const cache = this.app.metadataCache.getFileCache(activeFile);
        const embeds = cache?.embeds || [];
        if (embeds.length === 0) {
            new import_obsidian.Notice("No embedded files found in this note.");
            return;
        }

        const imageExtensions = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"];
        const localImageFiles = [];
        const seenPaths = new Set();

        for (const embed of embeds) {
            const linkPath = embed.link;
            if (!linkPath) continue;

            // Make case-insensitive match for protocol checks
            const lowerLink = linkPath.toLowerCase();
            if (lowerLink.startsWith("http://") || lowerLink.startsWith("https://") || lowerLink.startsWith("obsidian://")) {
                continue;
            }

            const abstractFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, activeFile.path);
            if (abstractFile instanceof import_obsidian.TFile) {
                const ext = abstractFile.extension.toLowerCase();
                if (imageExtensions.includes(ext) && !seenPaths.has(abstractFile.path)) {
                    seenPaths.add(abstractFile.path);
                    localImageFiles.push(abstractFile);
                }
            }
        }

        if (localImageFiles.length === 0) {
            new import_obsidian.Notice("No local images found to upload.");
            return;
        }

        new import_obsidian.Notice(`Found ${localImageFiles.length} local image(s). Starting migration...`);
        
        let successCount = 0;
        for (const file of localImageFiles) {
            try {
                this.captureFilePlaceholder(file);
                await this.handleImageUpload(file, false);
                successCount++;
            } catch (err) {
                console.error(`Notepixs error migrating file: ${file.name}`, err);
            }
        }

        new import_obsidian.Notice(`Finished note migration! Successfully processed ${successCount}/${localImageFiles.length} images.`);
    }

    getVaultFolderPaths() {
        const res = [];
        const root = this.app.vault.getRoot();
        const walk = (folder) => {
            const p = (folder.path || "").replace(/^\/+|\/+$/g, "");
            res.push(p);
            const children = folder.children || [];
            for (const child of children) {
                if (child instanceof import_obsidian.TFolder) {
                    walk(child);
                }
            }
        };
        walk(root);
        return res;
    }

    normalizeVaultPath(path) {
        return (path || '').replace(/\\\\/g, "/").replace(/^\/+|\/+$/g, "");
    }

    getLegacyRepoCandidates(primaryRepo) {
        const normalizedPrimary = (primaryRepo || '').trim();
        const history = Array.isArray(this.settings.repoHistory) ? this.settings.repoHistory : [];
        const set = new Set();

        if (normalizedPrimary) set.add(normalizedPrimary);

        for (const entry of history) {
            const repo = String(entry || '').trim();
            if (repo) set.add(repo);
        }

        if (normalizedPrimary) {
            if (normalizedPrimary.endsWith('s') && normalizedPrimary.length > 1) {
                set.add(normalizedPrimary.slice(0, -1));
            } else {
                set.add(`${normalizedPrimary}s`);
            }
        }

        return Array.from(set.values());
    }

    clearRepoListCache() {
        this.repoListCache = null;
        if (this.legacyResolvedRepoByKey) {
            this.legacyResolvedRepoByKey.clear();
        }
        if (this.legacyUnresolvedUntil) {
            this.legacyUnresolvedUntil.clear();
        }
    }

    async getConfiguredUserRepoList(token) {
        const configuredUser = (this.settings.githubUser || '').trim();
        if (!configuredUser || !token) return [];

        if (this.repoListCache &&
            this.repoListCache.user === configuredUser &&
            (Date.now() - this.repoListCache.timestamp) < 10 * 60 * 1000) {
            return this.repoListCache.repos || [];
        }

        try {
            const collected = [];
            const userLower = configuredUser.toLowerCase();
            for (let page = 1; page <= 10; page++) {
                const url = `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&type=all&affiliation=owner,collaborator,organization_member`;
                const response = await fetch(url, {
                    headers: {
                        "Authorization": `token ${token}`,
                        "Accept": "application/vnd.github.v3+json"
                    }
                });
                if (!response.ok) break;
                const arr = await response.json();
                if (!Array.isArray(arr) || arr.length === 0) break;

                for (const repo of arr) {
                    const ownerLogin = String(repo?.owner?.login || '').toLowerCase();
                    const name = String(repo?.name || '').trim();
                    if (name && ownerLogin === userLower) {
                        collected.push(name);
                    }
                }
                if (arr.length < 100) break;
            }

            const unique = Array.from(new Set(collected));
            this.repoListCache = {
                user: configuredUser,
                repos: unique,
                timestamp: Date.now()
            };
            return unique;
        } catch (e) {
            console.error('Notepixs: Failed to fetch repo list for configured user', e);
            return [];
        }
    }

    queueLegacyLinkMigration(sourcePath, oldUrl, newUrl) {
        const path = (sourcePath || '').trim();
        if (!path || !oldUrl || !newUrl || oldUrl === newUrl) return;

        let map = this.pendingLegacyMigrations.get(path);
        if (!map) {
            map = new Map();
            this.pendingLegacyMigrations.set(path, map);
        }
        map.set(oldUrl, newUrl);

        const existing = this.pendingLegacyMigrationTimers.get(path);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.applyLegacyLinkMigrations(path);
        }, 800);
        this.pendingLegacyMigrationTimers.set(path, timer);
    }

    async applyLegacyLinkMigrations(sourcePath) {
        const path = (sourcePath || '').trim();
        if (!path) return;

        const timer = this.pendingLegacyMigrationTimers.get(path);
        if (timer) {
            clearTimeout(timer);
            this.pendingLegacyMigrationTimers.delete(path);
        }

        const migrations = this.pendingLegacyMigrations.get(path);
        if (!migrations || migrations.size === 0) return;
        this.pendingLegacyMigrations.delete(path);

        try {
            const abs = this.app.vault.getAbstractFileByPath(path);
            if (!(abs instanceof import_obsidian.TFile) || !abs.path.endsWith('.md')) return;
            const startMtime = abs.stat?.mtime || 0;

            const content = await this.app.vault.read(abs);
            let updated = content;
            let replacedCount = 0;

            for (const [oldUrl, newUrl] of migrations.entries()) {
                if (!oldUrl || !newUrl || oldUrl === newUrl) continue;
                if (!updated.includes(oldUrl)) continue;
                updated = updated.split(oldUrl).join(newUrl);
                replacedCount++;
            }

            if (updated !== content) {
                const latest = this.app.vault.getAbstractFileByPath(path);
                const latestMtime = (latest instanceof import_obsidian.TFile) ? (latest.stat?.mtime || 0) : 0;
                if (startMtime && latestMtime && latestMtime !== startMtime) {
                    let map = this.pendingLegacyMigrations.get(path);
                    if (!map) {
                        map = new Map();
                        this.pendingLegacyMigrations.set(path, map);
                    }
                    for (const [oldUrl, newUrl] of migrations.entries()) {
                        map.set(oldUrl, newUrl);
                    }
                    if (!this.pendingLegacyMigrationTimers.get(path)) {
                        const retryTimer = setTimeout(() => {
                            this.applyLegacyLinkMigrations(path);
                        }, 1200);
                        this.pendingLegacyMigrationTimers.set(path, retryTimer);
                    }
                    return;
                }
                await this.app.vault.modify(abs, updated);
                new import_obsidian.Notice(`Notepixs: Migrated ${replacedCount} legacy image link(s) to v2 format.`, 3500);
            }
        } catch (e) {
            console.error('Notepixs: Failed to migrate legacy links', e);
        }
    }

    markFileAsUserApproved(path) {
        const norm = this.normalizeVaultPath(path);
        if (!norm) return;
        const existing = this.userApprovedUploads.get(norm);
        if (existing) {
            clearTimeout(existing);
        }
        const timeoutId = setTimeout(() => {
            this.userApprovedUploads.delete(norm);
        }, 6e4);
        this.userApprovedUploads.set(norm, timeoutId);
    }

    consumeUserApprovedUpload(path) {
        const norm = this.normalizeVaultPath(path);
        if (!norm) return false;
        const timeoutId = this.userApprovedUploads.get(norm);
        if (!timeoutId) return false;
        clearTimeout(timeoutId);
        this.userApprovedUploads.delete(norm);
        return true;
    }

    getPrimaryLocalFolderPath() {
        const fromList = (Array.isArray(this.settings.localOnlyList) && this.settings.localOnlyList.length > 0)
            ? (this.settings.localOnlyList[0]?.path || this.settings.localOnlyList[0] || '')
            : (this.settings.localImageFolder || 'Notepixs-local');
        const cleaned = this.normalizeVaultPath(fromList || 'Notepixs-local');
        return cleaned || 'Notepixs-local';
    }

    async ensureFolderExists(folderPath) {
        if (!folderPath) return;
        try {
            await this.app.vault.createFolder(folderPath);
        } catch (_) {}
    }

    async moveFileToLocalOnly(file) {
        if (!file) return null;
        const originalPath = file.path;
        const originalName = file.name;
        const folderPath = this.getPrimaryLocalFolderPath();
        if (!folderPath) return null;
        await this.ensureFolderExists(folderPath);
        const hasExtension = !!(file.extension || (originalName && originalName.includes('.')));
        const extension = hasExtension ? (file.extension || originalName.split('.').pop()) : '';
        const baseName = hasExtension && originalName ? originalName.slice(0, -(extension.length + 1)) : originalName;
        let counter = 1;
        let targetPath = `${folderPath}/${originalName}`;
        const adapter = this.app.vault.adapter;
        while (await adapter.exists(targetPath)) {
            const suffix = baseName ? `${baseName}-${counter}` : `image-${counter}`;
            targetPath = hasExtension ? `${folderPath}/${suffix}.${extension}` : `${folderPath}/${suffix}`;
            counter++;
        }
        await this.app.vault.rename(file, targetPath);
        return { newPath: targetPath, originalPath, originalName };
    }

    registerMobileEditorPlaceholderTracking() {
        if (!isMobile) return;
        const attachHandler = (leaf) => {
            const view = leaf?.view;
            if (!view || !(view instanceof import_obsidian.MarkdownView)) return;
            const editor = view.editor;
            if (!editor) return;
            const cm = editor.cm || editor;
            if (!cm || typeof cm.on !== 'function') return;
            const handler = (instance, changeObj) => {
                try {
                    const text = changeObj?.text;
                    if (!text || !Array.isArray(text)) return;
                    const joined = text.join('\n');
                    if (!joined) return;
                    const wikiRegex = /!\[\[([^\]]+)\]\]/g;
                    const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
                    let m;
                    const now = Date.now();
                    while ((m = wikiRegex.exec(joined)) !== null) {
                        const inner = m[1] || '';
                        const fileName = inner.split('|')[0].split('/').pop();
                        if (!fileName) continue;
                        this.recentPlaceholdersByName.set(fileName, {
                            placeholder: m[0],
                            ts: now
                        });
                    }
                    while ((m = mdImgRegex.exec(joined)) !== null) {
                        const pathPart = m[1] || '';
                        const fileName = decodeURIComponent(pathPart.split('/').pop() || '');
                        if (!fileName) continue;
                        this.recentPlaceholdersByName.set(fileName, {
                            placeholder: m[0],
                            ts: now
                        });
                    }
                    for (const [name, rec] of this.recentPlaceholdersByName.entries()) {
                        if (!rec || typeof rec.ts !== 'number') continue;
                        if (now - rec.ts > 60 * 1000) {
                            this.recentPlaceholdersByName.delete(name);
                        }
                    }
                } catch (e) {
                    console.error('Notepixs: error tracking mobile placeholders', e);
                }
            };
            cm.on('change', handler);
            this.register(() => {
                try {
                    cm.off('change', handler);
                } catch (_) {}
            });
        };
        this.registerEvent(this.app.workspace.on('active-leaf-change', attachHandler));
        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf) attachHandler(activeLeaf);
    }

    recordPendingLinkPlaceholder(path, placeholderText, sourcePath = "") {
        const norm = this.normalizeVaultPath(path);
        if (!norm || !placeholderText) return;
        const sourcePathNorm = this.normalizeVaultPath(sourcePath || "");
        const entry = this.pendingLinkReplacements.get(norm);
        if (entry?.timeoutId) {
            clearTimeout(entry.timeoutId);
        }
        const timeoutId = setTimeout(() => {
            this.pendingLinkReplacements.delete(norm);
        }, 5 * 60 * 1e3);
        this.pendingLinkReplacements.set(norm, { placeholderText, sourcePath: sourcePathNorm, timeoutId });
    }

    peekPendingLinkPlaceholder(pathOrKey) {
        const norm = this.normalizeVaultPath(pathOrKey);
        const key = norm || pathOrKey;
        if (!key) return null;
        const entry = this.pendingLinkReplacements.get(key);
        if (!entry) return null;
        return {
            key,
            placeholderText: entry.placeholderText || null,
            sourcePath: entry.sourcePath || ""
        };
    }

    consumePendingLinkPlaceholder(pathOrKey) {
        const norm = this.normalizeVaultPath(pathOrKey);
        const key = norm || pathOrKey;
        if (!key) return null;
        const entry = this.pendingLinkReplacements.get(key);
        if (!entry) return null;
        if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
        }
        this.pendingLinkReplacements.delete(key);
        return {
            key,
            placeholderText: entry.placeholderText || null,
            sourcePath: entry.sourcePath || ""
        };
    }

    async promptUploadConfirmation(file) {
        const modal = new ConfirmationModal(this.app, "Upload Image?", `Do you want to upload ${file.name} to GitHub?`);
        return await modal.open();
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new GitHubUploaderSettingTab(this.app, this));

        // --- REGISTER COMMAND PALETTE ITEM ---
        this.addCommand({
            id: 'upload-all-local-images-in-note',
            name: 'Upload all local images in current note',
            editorCallback: async (editor, view) => {
                const activeFile = view.file;
                if (!activeFile) {
                    new import_obsidian.Notice("No active note found.");
                    return;
                }
                await this.uploadAllLocalImagesInNote(activeFile);
            }
        });

        this.imageCache = new Map();
        this.registerMobileEditorPlaceholderTracking();

        if (isMobile && (this.settings.integrateAttachmentsOnMobile !== false)) {
            try {
                const attachFolder = (this.settings.attachmentsFolderName || 'attachment')
                    .replace(/\\\\/g, "/")
                    .replace(/^\/+|\/+$/g, "");
                if (attachFolder) {
                    try { await this.app.vault.createFolder(attachFolder); } catch (_) {}
                    try { this.app.vault.setConfig('attachmentFolderPath', attachFolder); } catch (_) {}
                    this.mobileAttachmentFolder = attachFolder;
                }
            } catch (_) {}
        }

        this.registerMarkdownPostProcessor(this.postProcessImages.bind(this));

        this.registerEvent(
            this.app.workspace.on("editor-paste", this.handlePaste.bind(this))
        );

        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (!(file instanceof import_obsidian.TFile)) return;
                const imageExtensions = ["png", "jpg", "jpeg", "gif", "bmp", "svg"];
                if (!imageExtensions.includes(file.extension.toLowerCase())) return;

                const filePathNorm = file.path.replace(/\\\\/g, "/");
                const localOnly = (Array.isArray(this.settings.localOnlyList) && this.settings.localOnlyList.length > 0
                    ? this.settings.localOnlyList
                    : (this.settings.localOnlyFolders || this.settings.localImageFolder || 'Notepixs-local').split(','))
                    .map(s => (typeof s === 'string' ? s : s.path || ''))
                    .map(s => (s || '').trim())
                    .filter(Boolean)
                    .map(s => s.replace(/\\\\/g, "/").replace(/^\/+|\/+$/g, ""));
                if (localOnly.some(ign => filePathNorm === ign || filePathNorm.startsWith(ign + "/"))) return;

                if (!this.settings.autoUpload) return;

                const uploadNorm = (this.settings.uploadImageFolder || 'Notepixs-uploads')
                    .replace(/\\\\/g, "/")
                    .replace(/^\/+|\/+$/g, "");
                const extra = (Array.isArray(this.settings.extraWatchedList) && this.settings.extraWatchedList.length > 0
                    ? this.settings.extraWatchedList.map(e => e?.path || '')
                    : (this.settings.extraWatchedFolders || '').split(','))
                    .map(s => (s || '').trim())
                    .filter(Boolean)
                    .map(s => s.replace(/\\\\/g, "/").replace(/^\/+|\/+$/g, ""));

                const attachNorm = (this.mobileAttachmentFolder || '')
                    .replace(/\\\\/g, "/")
                    .replace(/^\/+|\/+$/g, "");

                const inUpload = uploadNorm && (filePathNorm === uploadNorm || filePathNorm.startsWith(uploadNorm + "/"));
                const inExtra = extra.some(f => filePathNorm === f || filePathNorm.startsWith(f + "/"));
                const inAttach = attachNorm && (filePathNorm === attachNorm || filePathNorm.startsWith(attachNorm + "/"));
                if (!(inUpload || inExtra || inAttach)) return;

                this.captureFilePlaceholder(file);

                const alreadyConfirmed = this.consumeUserApprovedUpload(file.path);
                const shouldPrompt = (this.settings.uploadOnPaste === 'ask') && !alreadyConfirmed;

                if (shouldPrompt) {
                    const confirmed = await this.promptUploadConfirmation(file);
                    if (confirmed) {
                        await this.handleImageUpload(file);
                    } else {
                        await this.handleDeclinedUpload(file);
                    }
                    return;
                }

                await this.handleImageUpload(file);
            })
        );

        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (!file) return;
                await this.sanitizeFileOnOpen(file);
                this.checkRepoMismatchOnFileOpen(file);
            })
        );
    }

    onunload() {
        this.decryptedToken = null;
        this.repoPrivacyCache = null;
        if (this._fileOpenDebounceTimer) {
            clearTimeout(this._fileOpenDebounceTimer);
            this._fileOpenDebounceTimer = null;
        }
        if (this.imageCache) {
            this.imageCache.forEach(url => URL.revokeObjectURL(url));
            this.imageCache.clear();
        }
        if (this.userApprovedUploads) {
            this.userApprovedUploads.forEach((timeoutId) => clearTimeout(timeoutId));
            this.userApprovedUploads.clear();
        }
        if (this.pendingLinkReplacements) {
            this.pendingLinkReplacements.forEach(entry => {
                if (entry?.timeoutId) clearTimeout(entry.timeoutId);
            });
            this.pendingLinkReplacements.clear();
        }
        if (this.failedImageFetches) {
            this.failedImageFetches.clear();
        }
        if (this.pendingLegacyMigrationTimers) {
            this.pendingLegacyMigrationTimers.forEach((timer) => clearTimeout(timer));
            this.pendingLegacyMigrationTimers.clear();
        }
        if (this.pendingLegacyMigrations) {
            this.pendingLegacyMigrations.clear();
        }
        this.repoListCache = null;
        if (this.legacyResolvedRepoByKey) {
            this.legacyResolvedRepoByKey.clear();
        }
        if (this.legacyUnresolvedUntil) {
            this.legacyUnresolvedUntil.clear();
        }
    }

    async handlePaste(evt) {
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;
        
        const imageFile = Array.from(files).find(file => file.type.startsWith("image/"));
        if (!imageFile) return;

        if (this.settings.uploadOnPaste === 'always') {
            evt.preventDefault();
            await this.uploadPastedImage(imageFile);
            return;
        }

        if (this.settings.uploadOnPaste === 'ask') {
            evt.preventDefault();
            const modal = new ConfirmationModal(this.app, "Upload Image?", "Do you want to upload this image to GitHub?");
            const confirmed = await modal.open();
            if (confirmed) {
                await this.uploadPastedImage(imageFile);
            } else {
                await this.saveImageLocally(imageFile);
            }
        }
    }

    async uploadPastedImage(imageFile) {
        const arrayBuffer = await imageFile.arrayBuffer();
        const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!activeView) {
            new import_obsidian.Notice("Cannot process image: No active editor view.");
            return;
        }

        const uploadFolder = (this.settings.uploadImageFolder || 'Notepixs-uploads')
            .replace(/\\\\/g, "/")
            .replace(/^\/+|\/+$/g, "");
        try {
            if (uploadFolder) {
                await this.app.vault.createFolder(uploadFolder);
            }
        } catch {}

        const noteName = activeView.file ? activeView.file.basename : 'Untitled';
        const extension = imageFile.name.split('.').pop() || 'png';
        let i = 1;
        let newFilePath;
        do {
            newFilePath = uploadFolder
                ? `${uploadFolder}/${noteName}-${i}.${extension}`
                : `${noteName}-${i}.${extension}`;
            i++;
        } while (await this.app.vault.adapter.exists(newFilePath));

        this

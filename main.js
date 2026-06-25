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
    localImageFolder: 'notepix-local',
    uploadImageFolder: 'notepix-uploads',
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

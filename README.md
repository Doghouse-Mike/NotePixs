# NotePix - GitHub Image Uploader

[![Built for Obsidian](https://img.shields.io/badge/Built%20for-Obsidian-7B68EE.svg?style=for-the-badge)](https://obsidian.md)
[![Release Version](https://img.shields.io/github/v/release/AyushParkara/NotePix?style=for-the-badge&sort=semver)](https://github.com/AyushParkara/NotePix/releases/)

NotePix automatically uploads images, screenshots, and other assets from your Obsidian vault to a designated GitHub repository. It then replaces local links with either a GitHub-hosted URL or a secure internal private link, with smart Auto/Public/Private mode handling.

![NotePix Demo GIF](https://raw.githubusercontent.com/AyushParkara/NotePix/main/assets/notepix-demo.gif)

## ✨ Features

-   **Seamless Automation**: Just paste or drag an image into a note. NotePix handles the rest.
-   **Private Repository Support**: Securely store your images in a private GitHub repository. NotePix fetches and displays them on-the-fly in Reading View.
-   **Repo Mode Intelligence**: Use **Auto (Recommended)** to detect repo privacy and choose the correct link format automatically.
-   **Mismatch Prompt (3 Options)**: If your repo is private but notes contain public raw links, NotePix prompts: **Use Auto Mode**, **Switch to Private**, or **Keep Public**.
-   **Private Raw-Link Fallback**: Existing `raw.githubusercontent.com` links for your configured repo can still render in preview when the repo is private.
-   **Self-Describing Private Links**: New private links include repo context (`owner/repo/branch/path`) so they remain resolvable even if you change repository settings later.
-   **Smart Hover Detection**: Password prompts only appear in main document views. Hover previews and page previews work seamlessly without interrupting your workflow.
-   **Secure Token Storage**: Your GitHub Personal Access Token (PAT) is **never** stored in plain text. It is encrypted using AES-GCM, and you are prompted for a master password to decrypt it once per session.
-   **GitHub-Hosted Links**: For public repositories, NotePix uses direct GitHub links to serve images.
-   **Customizable**: Configure the target repository, branch, and folder path to fit your workflow.
-   **Clean Up**: Optionally delete the local image file after a successful upload to save space.
-   **Mobile Compatible**: Works on both Obsidian Desktop and Mobile.
-   **Mobile improvements (Android/iOS)**: Uses the Obsidian attachment folder on mobile, fixes link replacement for attachment-button screenshots, and only deletes local images after the note link has been successfully updated.

## ⚙️ How it Works

### Repository visibility modes

#### Auto (Recommended)
1. On upload, NotePix checks repo privacy (cached for 10 minutes).
2. If repo is public → inserts `https://raw.githubusercontent.com/...`.
3. If repo is private → inserts private internal link in v2 format, e.g. `![](obsidian://notepix/v2/<owner>/<repo>/<branch>/<path>)`.

#### Public
- Uploads always insert raw GitHub URLs.
- If the configured repo is actually private, those URLs may fail in editor/browser contexts, but NotePix can still render matching existing raw links in preview via authenticated API fetch.

#### Private
- Uploads always insert private internal links.
- Private links are fetched and rendered in Reading/Preview contexts using your token.

### Existing links and mismatch handling
- If repo appears private while notes contain matching raw links, NotePix can show a 3-button mismatch modal:
	- **Use Auto Mode**
	- **Switch to Private**
	- **Keep Public**
- Prompt suppression is applied per repo with a cooldown window to avoid repeated interruptions.

### Editor vs Reading View
- Private images are rendered in Reading/Preview contexts through authenticated API fetch.
- In Source/Live Preview text editing, the markdown editor itself cannot directly render authenticated private URL fetches in the same way.

If encryption is enabled, the plugin prompts for master password when token unlock is needed. After successful decrypt, the token is cached for the session.

## 🚀 Setup Guide

Follow these steps to get NotePix running.

### Step 1: Create a GitHub Repository (Public or Private)

First, you need a GitHub repository to store your images. This can now be **public** or **private**.

1.  Go to [GitHub](https://github.com) and create a **new repository**.
2.  You can name it anything you like (e.g., `obsidian-assets`, `my-notes-images`).
3.  Choose the visibility: **Public** or **Private**.

### Step 2: Generate a GitHub Personal Access Token (PAT)

NotePix needs a token to be able to upload files to your repository.

1.  Go to your GitHub **Settings**.
2.  Navigate to **Developer settings** > **Personal access tokens** > **Tokens (classic)**.
3.  Click **"Generate new token"** and select **"Generate new token (classic)"**.
4.  Give the token a descriptive name (e.g., `obsidian-notepix-token`).
5.  Set the **Expiration** as desired (e.g., 90 days or "No expiration").
6.  Under **Select scopes**, check the box for **`repo`**. This is the only permission required for both public and private repos.
7.  Click **"Generate token"** at the bottom.
8.  **Immediately copy the token!** You will not be able to see it again.

### Step 3: Install and Configure the Plugin

1.  Install NotePix from the Obsidian **Community Plugins** browser.
2.  Enable the plugin in your settings.
3.  Open the NotePix settings tab and fill in the details:

| Setting | Description | Example |
| :--- | :--- | :--- |
| **GitHub Username** | Your GitHub username (case-sensitive). | `AyushParkara` |
| **Repository Name** | The name of the repository you created in Step 1. | `obsidian-assets` |
| **Repository Visibility** | **Auto (Recommended)** detects privacy and picks the correct link format. Public/Private force behavior. | `Auto` / `Public` / `Private` |
| **Branch Name** | The branch to upload files to. | `main` or `master` |
| **Folder Path in Repository** | The directory inside your repo to store images. A `/` is added automatically. | `assets/` |
| **Delete Local File** | If enabled, the original image file is deleted from your vault after a successful upload. | `true` / `false` |

#### Encryption Setup (Highly Recommended)

1.  Toggle on **"Enable Encryption"**.
2.  Enter a strong, memorable password in the **"Master Password"** field. **This password is not saved anywhere.**
3.  Paste the **GitHub PAT** you generated in Step 2 into the "GitHub Personal Access Token" field.
4.  Click **"Save Encrypted Token"**. A notice will confirm it has been saved securely.

You are all set! The next time you paste an image, NotePix will handle the upload according to your settings.



## 🙏 Support

This plugin is created by [Ayush Parkara](https://github.com/AyushParkara). If you find it useful and want to show your appreciation, you can support me here:

<a href="https://www.paypal.com/paypalme/AyushParkara" target="_blank"><img src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif" alt="Donate with PayPal"></a>

## 📄 License

This plugin is released under the MIT License.

# Getting started with tidy-core

Written for designers. You do not need to know how to code. You will copy and paste a few lines, and I will tell you exactly what should happen after each one.

Set aside about 20 minutes for the first time.

---

## What this actually does

You know how when you ask an AI assistant to help with your design system, it invents token names that do not exist? It says `color-primary-500` when your file actually calls it `bg/brand/default`.

That happens because the AI cannot see your Figma file. It is guessing.

tidy-core is a small program that runs on your computer and lets your AI assistant read your real design system: your actual token names, your actual components, your actual naming conventions.

Once it is set up, you can ask things like *"what are the text colour tokens in this file?"* and get a real answer instead of a plausible-sounding invention.

### A word you will keep seeing: MCP

MCP stands for Model Context Protocol. Think of it as a **plug socket for AI assistants**.

Your AI assistant is the appliance. tidy-core is a device you plug in. MCP is the shape of the plug that lets them connect. That is all you need to know about it.

---

## Before you start

You need four things. Check each one off.

| What | How to check | If you do not have it |
|---|---|---|
| **A Mac or Windows PC** | You have one | |
| **Figma Desktop** | The Figma **app**, not Figma in Chrome or Safari | [Download it](https://www.figma.com/downloads/) |
| **Node** | See below | See below |
| **An AI assistant that supports MCP** | Claude Code, Claude Desktop, Cursor, or Windsurf | Install one |

> **Figma Desktop is not optional.** tidy-core will not work with Figma open in a browser tab. This is the single most common reason people get stuck. Browsers block the kind of connection tidy-core needs, and there is no workaround.

### Checking whether you have Node

Node is a program that runs other programs. tidy-core is written for it.

**Open your terminal.** The terminal is a window where you type commands instead of clicking buttons.

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** press the Start button, type `PowerShell`, press Enter.

A window opens with some text and a blinking cursor. Type this and press Enter:

```bash
node --version
```

**If you see something like `v20.11.0`** you have Node. Any number **18 or higher** is fine. Move on to Step 1.

**If you see `command not found`** you do not have Node yet. Go to [nodejs.org](https://nodejs.org), download the button marked **LTS**, open the file, and click through the installer. Then close your terminal, open a new one, and try `node --version` again.

---

## Step 1: Get the files

The project lives on GitHub. Because the repository is private, you need to be signed in to a GitHub account that has been given access.

1. Go to **https://github.com/rominak/tidy-core**
2. Click the green **Code** button
3. Click **Download ZIP**
4. Open the downloaded file to unzip it
5. Move the unzipped `tidy-core` folder somewhere you will remember. Your **Documents** folder is a good choice.

> If you see a 404 page instead of the project, your GitHub account has not been given access yet. Ask for an invite.

### Getting the folder's address

You will need the full address of that folder twice, so let us find it now and keep it handy.

**Mac:** right-click the `tidy-core` folder → hold down the `Option` key → click **Copy "tidy-core" as Pathname**.

**Windows:** right-click the folder → **Copy as path**.

Paste it into a notes app. It looks something like:

```
/Users/yourname/Documents/tidy-core
```

Keep that. We will call it **YOUR-FOLDER-PATH** from here on.

---

## Step 2: Build it

In your terminal, type `cd ` (the letters c and d, then a space), then paste YOUR-FOLDER-PATH, then press Enter:

```bash
cd /Users/yourname/Documents/tidy-core
```

`cd` means "change directory". You have just told the terminal which folder to work in.

Now run these two commands, one at a time. Wait for each to finish before typing the next.

```bash
npm install
```

This downloads the pieces tidy-core needs. It takes a minute or two and prints a lot of text. Some of it may be yellow warnings. **Yellow warnings are normal.** You are looking for it to finish and give you your cursor back.

```bash
npm run build
```

This one is quick and quiet. **No news is good news.** If it prints nothing and returns your cursor, it worked.

> **If you see red text with the word `error`,** copy the whole message and ask for help. Do not continue.

---

## Step 3: Connect it to your AI assistant

Pick the one you use.

### Claude Code

One command. Replace `YOUR-FOLDER-PATH` with the path you saved:

```bash
claude mcp add tidy-core -s user -- node YOUR-FOLDER-PATH/dist/index.js
```

So it ends up looking like:

```bash
claude mcp add tidy-core -s user -- node /Users/yourname/Documents/tidy-core/dist/index.js
```

Note the `/dist/index.js` on the end. That part matters.

### Claude Desktop, Cursor, or Windsurf

These use a settings file. You need to open it in a text editor and add a few lines.

**Find your file:**

| App | Mac | Windows |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |

> The `~` symbol means your home folder. On a Mac that is `/Users/yourname`. On Windows it is `C:\Users\yourname`.
>
> **Mac tip:** in Finder, press `Cmd + Shift + G` and paste the path to jump straight there.

**If the file does not exist,** create it. A plain text file with that exact name is fine.

**If the file is empty,** paste this in, with your own path:

```json
{
  "mcpServers": {
    "tidy-core": {
      "command": "node",
      "args": ["YOUR-FOLDER-PATH/dist/index.js"]
    }
  }
}
```

**If the file already has things in it,** add only the `"tidy-core"` block inside the existing `"mcpServers"` section, and make sure there is a comma between entries.

> **The most common mistake here is a missing or extra comma.** The whole file has to be valid JSON. If your app says it cannot read the config afterwards, paste the file into [jsonlint.com](https://jsonlint.com) and it will point at the broken line.

**Now fully quit and reopen the app.** Not just close the window. On Mac, `Cmd + Q`.

---

## Step 4: Install the Figma plugin

This is the piece that lets tidy-core see inside Figma.

1. Open **Figma Desktop** (the app, remember)
2. Open any design file
3. In the menu: **Plugins → Development → Import plugin from manifest...**
4. Navigate to your `tidy-core` folder → open the `plugin` folder → select **`manifest.json`**
5. Now run it: **Plugins → Development → tidy-core bridge**

A small panel opens. Within a few seconds you should see a **green dot** and **"Connected on 9240"**.

**Leave this panel open while you work.** If you close it, the connection stops. That is not a bug, it is just how Figma plugins work.

If you see a red dot saying "No server found", see [Troubleshooting](#when-something-goes-wrong) below.

---

## Step 5: Check it works

Go back to your AI assistant and type:

```
Check tidy status
```

**If it worked,** you get something like this:

```json
{
  "connected": true,
  "routing": "Commands go to \"My Design File\" (the only connected file).",
  "connections": [
    { "fileName": "My Design File", "isTarget": false }
  ]
}
```

The `routing` line is the one to read. It tells you in plain English which Figma file your commands will go to.

**If it says `"connected": false`,** it also gives you a numbered list of things to try. Read that list. It is usually the Figma-in-a-browser problem.

---

## What you can ask it right now

Three things work today. Copy and paste these.

**See your design system:**
```
Load the design system contract from Figma.
```
You get your collections, modes, token names grouped by type, your components with their variants, and the naming conventions your file actually uses.

**Use it while working:**
```
Look at my design system, then tell me which token I should use
for the background of a warning message.
```
Now the answer comes from your real tokens instead of a guess.

**Working with more than one file open:**
```
Which Figma file am I pointed at?
```
```
Point me at the Foundations file.
```

---

## Things that will look like errors but are not

**"tidy_health is specified but not implemented yet"**

This is expected. tidy-core is early. Three of its thirteen tools are built. The other ten are listed so you can see what is coming, and they tell you honestly that they do not work yet instead of returning a made-up answer.

Built and working: `tidy_status`, `tidy_target`, `tidy_context`.

**"2 Figma files are connected and no target is set"**

You have the plugin running in two Figma files at once. tidy-core will not guess which one you mean, because guessing wrong means changing the wrong file.

Fix it by telling it which one:

```
Point me at the Foundations file.
```

**Yellow warnings during `npm install`**

Normal. Ignore them. Only red `error` text matters.

---

## When something goes wrong

### The plugin says "No server found"

Work down this list in order. The first one is the answer roughly nine times out of ten.

1. **Are you in Figma Desktop, or Figma in a browser?** It must be the app. A browser tab cannot make this connection.
2. **Is your AI assistant open?** tidy-core starts up when your AI assistant starts it. No assistant running means nothing for the plugin to find.
3. **Did you restart your assistant after Step 3?** Fully quit it (`Cmd + Q` on Mac) and reopen.
4. **Was the plugin already open before you started your assistant?** Close the plugin panel and run it again. It does not reconnect on its own.

### My AI assistant does not know what "tidy status" means

It cannot see tidy-core. Usually one of:

- The settings file has a typo. Check it at [jsonlint.com](https://jsonlint.com).
- The path is wrong. It must end in `/dist/index.js`.
- You skipped `npm run build`, so `dist` does not exist yet. Go back to Step 2.
- You did not fully quit and reopen the app.

### "Cannot find module" when it starts

`npm install` did not finish, or did not run. Go back to Step 2 and run both commands again.

### It connected on 9241 instead of 9240

That is fine, nothing is wrong. If something else on your computer is already using 9240, tidy-core moves to the next free port and the plugin finds it automatically. It deliberately does not shut down whatever was there first.

---

## Words you will see

| Word | What it means |
|---|---|
| **Terminal** | A window where you type commands instead of clicking |
| **MCP** | The plug shape that lets AI assistants connect to tools like this |
| **Node** | The program that runs tidy-core |
| **npm** | Comes with Node. Downloads the pieces tidy-core needs |
| **Build** | Turning the written code into something runnable |
| **Path** | A folder's full address, like `/Users/you/Documents/tidy-core` |
| **JSON** | A text format for settings files. Very fussy about commas |
| **Port** | A numbered door on your computer. tidy-core uses 9240 |
| **Bridge / plugin** | The Figma plugin that lets tidy-core see your file |
| **Token** | A named design value, like `bg/brand/default` |

---

## Where to learn more

For the wider thinking behind this, how design systems get measured and where AI genuinely helps, see **[aidesign.guide](https://aidesign.guide)**.

## Still stuck?

Open an issue on the repository with:

1. What you were trying to do
2. What you typed
3. What came back, copied and pasted in full
4. Whether you are on Mac or Windows
5. Whether Figma is open in the **app** or a **browser**

That last one saves everybody a lot of time.

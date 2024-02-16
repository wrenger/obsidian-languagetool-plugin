# Obsidian LanguageTool Plugin

This plugin for [Obsidian.md](https://obsidian.md) integrates [LanguageTool](https://languagetool.org/) to provide advanced grammar and spellchecking.

> This is a fork of the original [obsidian-languagetool-plugin](https://github.com/Clemens-E/obsidian-languagetool-plugin).

Note: if you are worried about the privacy of your notes, you should self-host languagetool locally on your PC or on a server: [Docker Image](https://hub.docker.com/r/erikvl87/languagetool)

If you decide to self-host the service, you must change the link in the configuration accordingly.

## Installation

1. In Obsidian, under Settings / Community plugins, turn off "Safe mode" (read the safety warning).
2. Click the Browse button for Community plugins.
3. In the top-left search field, search for "LanguageTool Integration". Click the Install button.
4. After the installation is successful, click Enable to enable the plugin.

## Setting Up & Use Case

After installing and enabling the plugin, you can set up hotkeys (under Settings / Hotkeys), which can be found under the description "LanguageTool Integration" through the Filter search field, to find specific hotkey functions quicker. Ensure no conflict exists with existing hotkeys and the spellcheck function within Obsidian if enabled (Settings / Editor / Spellcheck ON/OFF).

* **"Check Text"** checks the whole document in view if no text is selected. If you want to check only a word, sentence, or paragraph, select the text of choice and press the keyboard shortcut you have previously set. Click on the red underlined word that LanguageTool identified as a possible spelling mistake to get corrective suggestions in a popover window, with the option to add the word to a personal dictionary.
* **"Clear Suggestions"** clears the document or selected text of all red underlines from words or passages that were not corrected or changed.
* **"Toggle Automatic Checking"** toggles ON/OFF the automatic spellchecking function as you write or change the document's contents.

**LanguageTool tries to auto-detect the language used.** Selecting a specific language (under Settings / Plugin Options / LanguageTool Integration / Static language) usually is not necessary. **This feature enables the user to spellcheck in different languages within the same document** (e.g. a dissertation written in English with quotes in a foreign language), which is ordinarily not possible with the built-in spellcheck function of Obsidian.

## Premium Accounts
We finally support LanguageTool Premium.

⚠️ Please report any bugs, issues, or suggestions related to this Plugin to us (this GitHub Repository) directly and ***not*** to LanguageTool, as this is an unofficial community plugin

You (obviously) need a Premium Account and an API key to use the premium features.
You can generate your API key at https://languagetool.org/editor/settings/access-tokens

Configure your email, API key, and the new URL (https://api.languagetoolplus.com) in the plugin settings

## Manually installing the plugin

- Run `yarn install` and `yarn build` in the root directory of the repository.
- Copy over `main.js`, `styles.css`, `manifest.json` from the latest release to your vault `VaultFolder/.obsidian/plugins/obsidian-languagetool-plugin/`.

# Demo

![demo-02022022](https://user-images.githubusercontent.com/98941594/152318322-83abb30d-fee0-44cf-9700-262f4c0de4c4.png)

# metaconfig-vscode

## Features

Imports support and syntax highlighting for metaconfig files.

## Installing
### Manual installation
Download the `.vsix` file from the [releases page](https://github.com/ZolibraBond/metaconfig-vscode/releases) and install it using the `Extensions: Install from VSIX...` command in the command palette.

### Install script
Run this command in your terminal:
```bash
curl -s https://api.github.com/repos/ZolibraBond/metaconfig-vscode/releases/latest | grep "browser_download_url" | cut -d : -f 2,3 | tr -d \" | wget -qi - && code --install-extension ./metaconfig-extension.vsix && rm metaconfig-extension.vsix
```
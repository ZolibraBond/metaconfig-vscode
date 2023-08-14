/*
The "metaconfig" system that is used to generate `sdkconfig` files based on inheritance. Here's an example of `target/zermatt-pro/metaconfig`:
```
!boot-zermatt-pro
!chip-esp32-wrover-16mb
!genus-zermatt-pro
-CONFIG_ADC_FORCE_XPD_FSM
-CONFIG_APP_EXCLUDE_PROJECT_NAME_VAR
-CONFIG_APP_EXCLUDE_PROJECT_VER_VAR
-CONFIG_APP_ROLLBACK_ENABLE
-CONFIG_AWS_IOT_DONT_START
CONFIG_ADC_CAL_EFUSE_TP_ENABLE=y
CONFIG_ADC_CAL_EFUSE_VREF_ENABLE=y
CONFIG_ADC_CAL_LUT_ENABLE=y
CONFIG_APP_BUILD_BOOTLOADER=y
```

Lines starting with `!` are imports, lines starting with `-` are exclusions, and other lines are inclusions. The `!` lines are processed first, then the `-` lines, then the inclusion lines. All of the lines are processed in order, but duplicates are not allowed.

The imports come from the folder `metaconfig` in the root of the project. The `!` is replaced with the name of the file, and the file is read. The file is processed recursively, so you can have `!` lines in the imported files.
So for example, `!genus-zermatt-pro` imports `metaconfig/genus-zermatt-pro.metaconfig`, which contains:
```
!family-zermatt
-CONFIG_BETHERNET
-CONFIG_BFTL_PORT_ESP32_3V3_EFUSE
-CONFIG_BHK
-CONFIG_BI2C
-CONFIG_BONDSCRIPT_PRO
CONFIG_BETHERNET=y
CONFIG_BFTL_PORT_ESP32_3V3_EFUSE=y
CONFIG_BHK=y
CONFIG_BI2C=y
CONFIG_BI2C_CLOCK_RATE=100000
CONFIG_BI2C_SCL_PIN=13
CONFIG_BI2C_SDA_PIN=12
```

This plugin should:
- Find duplicate lines in the metaconfig files, including the imported files, and show them as errors with a helpful message
- Highlight the `!` lines in the metaconfig files and open the imported file when clicked
*/

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');


function activate(context) {
	vscode.workspace.onDidOpenTextDocument(checkForDuplicates, null, context.subscriptions);
	vscode.workspace.onDidSaveTextDocument(checkForDuplicates, null, context.subscriptions);
	vscode.workspace.onDidChangeTextDocument(event => checkForDuplicates(event.document), null, context.subscriptions);

	let disposable = vscode.commands.registerTextEditorCommand('metaconfig.openImport', (textEditor, edit) => {
		console.log('Opening import');
		const line = textEditor.document.lineAt(textEditor.selection.start.line);
		const lineText = line.text.trim();

		if (lineText.startsWith('!')) {
			const fileNameWithExtension = lineText.substring(1) + '.metaconfig'; // Remove the ! and add file extension
			const fileNameWithoutExtension = lineText.substring(1); // Just the name without the extension

			const filePathWithExtension = path.join(vscode.workspace.rootPath, 'metaconfig', fileNameWithExtension);
			const filePathWithoutExtension = path.join(vscode.workspace.rootPath, 'metaconfig', fileNameWithoutExtension);

			// Attempt to open with extension
			vscode.workspace.openTextDocument(filePathWithExtension).then(doc => {
				vscode.window.showTextDocument(doc);
			}).catch(err => {
				// If failed, attempt to open without extension
				vscode.workspace.openTextDocument(filePathWithoutExtension).then(doc => {
					vscode.window.showTextDocument(doc);
				}).catch(err => {
					vscode.window.showErrorMessage('Failed to open imported MetaConfig file: ' + err.message);
				});
			});
		}
	});

	// Register a definition provider for metaconfig
	const provider = vscode.languages.registerDefinitionProvider({ language: 'metaconfig' }, {
		provideDefinition(document, position, token) {
			const line = document.lineAt(position).text;
			const importPattern = /^!(.+)$/;
			const match = line.match(importPattern);

			if (match) {
				const importPath = match[1];
				const rootPath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
				const fullPath = path.join(rootPath, 'metaconfig', importPath + (importPath.endsWith('metaconfig') ? '' : '.metaconfig'));

				// Print a debug log with the full path
				console.log(fullPath);

				// Check if the file exists before returning the location.
				console.log('Checking if file exists...');
				if (fs.existsSync(fullPath)) {
					console.log('File exists');
					return new vscode.Location(vscode.Uri.file(fullPath), new vscode.Position(0, 0));
				} else {
					console.log('File does not exist');
					vscode.window.showErrorMessage(`File ${fullPath} not found.`);
					return null;
				}
			}

			return null;
		}
	});

	context.subscriptions.push(provider);
	context.subscriptions.push(disposable);
}

async function parseMetaconfigFile(filePath) {
	const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
	const lines = fileContent.toString().split('\n');

	let allLines = [];

	for (const line of lines) {
		const trimmedLine = line.trim();

		if (trimmedLine.startsWith('!')) {
			const fileNameWithExtension = trimmedLine.substring(1) + '.metaconfig';
			const fileNameWithoutExtension = trimmedLine.substring(1);
			const importPathWithExtension = path.join(vscode.workspace.rootPath, 'metaconfig', fileNameWithExtension);
			const importPathWithoutExtension = path.join(vscode.workspace.rootPath, 'metaconfig', fileNameWithoutExtension);

			if (await fileExists(importPathWithExtension)) {
				allLines = allLines.concat(await parseMetaconfigFile(importPathWithExtension));
			} else if (await fileExists(importPathWithoutExtension)) {
				allLines = allLines.concat(await parseMetaconfigFile(importPathWithoutExtension));
			} else {
				// This might be an error because the imported file doesn't exist, but you can handle this as you see fit.
			}
		} else {
			allLines.push(trimmedLine);
		}
	}

	return allLines;
}

async function fileExists(filePath) {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
		return true;
	} catch (error) {
		return false;
	}
}

function findDuplicates(lines) {
	const uniqueLines = new Set();
	const duplicates = [];

	for (const line of lines) {
		if (uniqueLines.has(line)) {
			duplicates.push(line);
		} else {
			uniqueLines.add(line);
		}
	}

	return [...new Set(duplicates)];
}

const diagnosticsCollection = vscode.languages.createDiagnosticCollection('metaconfig');

async function checkForDuplicates(document) {
	if (document.languageId !== 'metaconfig') return;

	const allLines = await parseMetaconfigFile(document.fileName);
	const duplicateLines = findDuplicates(allLines);

	const diagnostics = [];
	for (let i = 0; i < document.lineCount; i++) {
		const line = document.lineAt(i);
		if (duplicateLines.includes(line.text.trim())) {
			const diagnostic = new vscode.Diagnostic(
				line.range,
				`Duplicate configuration: "${line.text.trim()}"`,
				vscode.DiagnosticSeverity.Error
			);
			diagnostics.push(diagnostic);
		}
	}

	diagnosticsCollection.set(document.uri, diagnostics);
}


exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {
	diagnosticsCollection.clear();
}

module.exports = {
	activate,
	deactivate
};

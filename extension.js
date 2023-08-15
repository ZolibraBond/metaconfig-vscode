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

class MetaLine {
	constructor(filename, lineNumber, importOrder, type, key, value) {
		this.filename = filename;
		this.lineNumber = lineNumber;
		this.importOrder = importOrder
		this.type = type; // "inclusion" or "exclusion"
		this.key = key; // everything before "=", excluding "-" "!" or "#"
		this.value = value; // everything after "=" (may be empty)
	}

	static fromLine(filename, lineNumber, importOrder, line) {
		const type = line.startsWith('-') ? 'exclusion' : 'inclusion';
		const key = line.match(/^[#!-]?(.+?)(?:=.*)?$/)[1];
		const value = line.includes('=') ? line.substring(line.indexOf('=') + 1) : '';
		return new MetaLine(filename, lineNumber, importOrder, type, key, value);
	}
}


function activate(context) {
	vscode.workspace.onDidOpenTextDocument(checkForIssues, null, context.subscriptions);
	vscode.workspace.onDidSaveTextDocument(checkForIssues, null, context.subscriptions);
	vscode.workspace.onDidChangeTextDocument(event => checkForIssues(event.document), null, context.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			checkForIssues(editor.document);
		}
	});

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

async function parseMetaconfigFile(filePath, importOrder = 0) {
	console.log('Parsing metaconfig file: ' + filePath);
	const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
	const lines = fileContent.toString().split('\n');

	let allMetalines = [];

	for (const line of lines) {
		// Get line number from file
		const lineNumber = lines.indexOf(line) + 1;
		const trimmedLine = line.trim();
		if (trimmedLine === '') continue;

		if (trimmedLine.startsWith('!')) { // this is an import line
			const rootPath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
			const fileNameWithExtension = trimmedLine.substring(1) + '.metaconfig';
			const fileNameWithoutExtension = trimmedLine.substring(1);
			const importPathWithExtension = path.join(rootPath, 'metaconfig', fileNameWithExtension);
			const importPathWithoutExtension = path.join(rootPath, 'metaconfig', fileNameWithoutExtension);

			// Open the file and parse it, but remember which file those lines came from
			if (await fileExists(importPathWithExtension)) {
				const importedLines = await parseMetaconfigFile(importPathWithExtension, importOrder + 1);
				allMetalines = allMetalines.concat(importedLines);
			} else if (await fileExists(importPathWithoutExtension)) {
				const importedLines = await parseMetaconfigFile(importPathWithoutExtension, importOrder + 1);
				allMetalines = allMetalines.concat(importedLines);
			} else {
				// This might be an error because the imported file doesn't exist, but you can handle this as you see fit.
			}
		} else {
			allMetalines.push(MetaLine.fromLine(filePath, lineNumber, importOrder, trimmedLine));
		}
	}

	console.log('Returning metalines for file: ' + filePath);
	return allMetalines;
}

function parseKeyFromLine(line) {
	const matches = line.match(/^[#!-]?(.+?)(?:=.*)?$/);
	if (matches && matches.length > 1) {
		return matches[1];
	}
	return null;
}

async function fileExists(filePath) {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
		return true;
	} catch (error) {
		return false;
	}
}


function findIssues(document, metalines) {
	const issues = [];
	const key_tracker = {};

	// Sort metalines first by importOrder (in descending order), then by lineNumber
	metalines.sort((a, b) => {
		if (a.importOrder !== b.importOrder) {
			return b.importOrder - a.importOrder; // reversed order
		}
		return a.lineNumber - b.lineNumber;
	});

	for (const metaline of metalines) {
		const filename = path.relative(path.dirname(document.fileName), metaline.filename);
		const key = metaline.key;
		const line_type = metaline.type;
		const value = metaline.value;
		const lineNumber = metaline.lineNumber;

		if (!key_tracker[key]) {
			key_tracker[key] = [];
		}

		const existing_entries = key_tracker[key];
		const last_inclusion_entry = existing_entries.slice().reverse().find(entry => entry.type === 'inclusion');

		if (last_inclusion_entry) {
			const previous_value = last_inclusion_entry.value;
			const previous_filename = last_inclusion_entry.filename;

			// Check for redefinition without exclusion or unnecessary redefinition
			if (line_type === 'inclusion') {
				if (key_tracker[key].some(entry => entry.type === 'exclusion' && entry.filename === filename)) {
					if (previous_value === value && existing_entries.slice().reverse().findIndex(entry => entry.type === 'exclusion') < existing_entries.slice().reverse().findIndex(entry => entry.type === 'inclusion')) {
						issues.push({
							error: "Unnecessary redefinition. Value on " + filename + ":" + lineNumber + " is the same as the excluded value.",
							metaline: metaline
						});
					}
				} else {
					issues.push({
						error: "Redefined without exclusion.\nOriginal value (on " + previous_filename + ":" + last_inclusion_entry.lineNumber + ")=" + previous_value + "\nRedefined value (on " + filename + ":" + lineNumber + ")=" + value + ".",
						metaline: metaline
					});
				}
			}
		}

		key_tracker[key].push({ type: line_type, value: value, filename: filename, lineNumber: lineNumber });
	}

	return issues;
}


const diagnosticsCollection = vscode.languages.createDiagnosticCollection('metaconfig');

async function checkForIssues(document) {
	if (document.languageId !== 'metaconfig') return;
	console.log('Checking for issues');

	console.log('Parsing metaconfig file: ' + document.fileName);
	const allLines = await parseMetaconfigFile(document.fileName, 0);
	console.log("allLines: " + JSON.stringify(allLines));
	const issues = findIssues(document, allLines);

	const diagnostics = [];
	for (let i = 0; i < document.lineCount; i++) {
		const line = document.lineAt(i);
		const key = parseKeyFromLine(line.text.trim()) || line.text.trim();
		console.log('Checking line: ' + key);
		if (issues.some(issue => issue.metaline.filename === document.fileName && issue.metaline.key === key)) {
			const relevant_issues = issues.filter(issue => issue.metaline.filename === document.fileName && issue.metaline.key === key);
			const diagnostic = new vscode.Diagnostic(
				line.range,
				// Show all error messages for this key in the same diagnostic
				`${relevant_issues.map(issue => issue.error).join('\n')}`,
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

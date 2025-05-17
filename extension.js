// The module 'vscode' contains the VS Code extensibility API
const vscode = require("vscode");
const path = require("path");

// Preview the extracted functions as WebView
let panel;


async function getFunctionSymbols(document) {
  const symbols = await vscode.commands.executeCommand(
    "vscode.executeDocumentSymbolProvider",
    document.uri
  );

  const functions = [];

  function extract(symbols, classStack = []) {
    if (!symbols) return;

    for (const symbol of symbols) {
      if (symbol.kind === vscode.SymbolKind.Class) {
        // Push class name onto the stack
        classStack.push(symbol.name);
        extract(symbol.children, classStack);
        classStack.pop(); // Done with this class
      } else if (
        symbol.kind === vscode.SymbolKind.Function ||
        symbol.kind === vscode.SymbolKind.Method
      ) {
        const startLine = symbol.range.start.line;
        const lineText = document.lineAt(startLine).text.trim();
        const match = lineText.match(/\((.*)\)/);
        const args = match ? match[1].trim() : "";

        // Prefix with class name if in a class
        const qualifiedName =
          classStack.length > 0
            ? `${classStack.join(".")}.${symbol.name}`
            : symbol.name;

        functions.push({
          name: qualifiedName,
          args: args,
        });
      } else {
        extract(symbol.children, classStack);
      }
    }
  }

  extract(symbols);
  return functions;
}

async function pickFilesAndShowFunctions(fileType) {
  // Let user pick multiple files
  if (!fileType) {
    vscode.window.showInformationMessage("No type selected");
    return;
  }
  const selectedFiles = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: { Files: [fileType] },
  });

  if (!selectedFiles || selectedFiles.length === 0) {
    vscode.window.showInformationMessage("No files selected");
    return;
  }

  const allFunctionsPerFile = [];

  for (const fileUri of selectedFiles) {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const functions = await getFunctionSymbols(document);
    allFunctionsPerFile.push({
      file: fileUri.fsPath,
      functions,
    });
  }

  return allFunctionsPerFile;
}

function generateHTML(functionsPerFile) {
  let html = `
  <html>
  <head>
    <style>
      body {
        font-family: sans-serif;
        padding: 18px;
      }
      .file-section {
        margin-bottom: 14px;
      }
      .function-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .function-card {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 8px 12px;
        font-family: monospace;
        font-size: 14px;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        max-width: 100%;
        box-sizing: border-box;
      }
      .controls {
        margin-top: 20px;
      }
      #copy_result {
        display: none;
        margin-top: 10px;
      }
    </style>
  </head>
  <body>
    <h2>Extracted Function Signatures</h2><ol>
  `;

  for (const file of functionsPerFile) {
    html += `<li><div class="file-section"><h3>${file.file}</h3></li><div class="function-container">`;

    if (file.functions.length === 0) {
      html += `<div>No functions found</div>`;
    } else {
      for (const fn of file.functions) {
        const sig = `${fn.name}(${fn.args})`;
		const escapedSig = encodeURIComponent(sig);

        html += `
          <div style="cursor: pointer;" class="function-card">
            <label style="cursor: pointer; display: block;"><input type="checkbox" class="select-fn" value="${escapedSig}" /> ${sig}</label>
          </div>
        `;
      }
    }

    html += `</div></div>`;
  }
    html += `</ol>`;

  html += `
    <div class="controls">
      <button onclick="copySelected()">Copy Selected</button>
      <button onclick="copyAll()">Copy All</button>
      <div id="copy_result" style="color:#008000;">Copied!</div>
    </div>

    <script>
		document.querySelectorAll('.function-card').forEach(card => {
			card.addEventListener('click', () => {
				const checkbox = card.querySelector('input[type="checkbox"]');
				if (checkbox) checkbox.checked = !checkbox.checked;
			});
		});
      function copySelected() {
        const items = document.querySelectorAll('input.select-fn:checked');
        const text = Array.from(items).map(i => decodeURIComponent(i.value)).join('\\n');
        const result = document.querySelector("#copy_result");

        if (text.length !== 0) {
          navigator.clipboard.writeText(text).then(() => {
            result.innerText = "Copied!";
            result.style.color = "#008000";
            result.style.display = "block";
          });
        } else {
          result.innerText = "Nothing to Copy!";
          result.style.color = "#ff0000";
          result.style.display = "block";
        }
      }

      function copyAll() {
        const items = document.querySelectorAll('input.select-fn');
        items.forEach(cb => cb.checked = true);
        const text = Array.from(items).map(i => decodeURIComponent(i.value)).join('\\n');
        navigator.clipboard.writeText(text).then(() => {
          const result = document.querySelector("#copy_result");
          result.innerText = "Copied All!";
          result.style.color = "#008000";
          result.style.display = "block";
        });
      }
    </script>
  </body></html>`;

  return html;
}

function showFunctionPanel(context, functionsPerFile) {
	if(!functionsPerFile){
		vscode.window.showInformationMessage(
          "No file selected."
        );
        return;
	}
	
  if (panel) {
    // If panel exists, reveal it
    panel.reveal(vscode.ViewColumn.Two);
    // Optionally update content if needed:
    panel.webview.html = generateHTML(functionsPerFile);
    return;
  }

  // Otherwise, create a new panel
  panel = vscode.window.createWebviewPanel(
    'functionSignatures', // Identifier
    'Code Outline - Function Signatures', // Title
    vscode.ViewColumn.Two, // Show in second editor column
    { enableScripts: true }
  );

  // Set the HTML content
  panel.webview.html = generateHTML(functionsPerFile);

  // Clear panel ref when closed
  panel.onDidDispose(() => {
    panel = undefined;
  }, null, context.subscriptions);
}

// This method is called when your extension is activated (when command is executed)

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  const disposable = vscode.commands.registerCommand(
    "code-outline.codeOutline",
    async function () {
		// Display a message box to the user
      vscode.window.showInformationMessage("Outlining your code from code_outline!");


      const files = await vscode.workspace.findFiles("**/*.*");
      if (files.length === 0) {
        vscode.window.showInformationMessage(
          "No files found in the workspace."
        );
        return;
      }
      let fileExt = [];

      files.map((fileUri) => {
        const ext = path.extname(fileUri.fsPath).replace(".", ""); 
        if (ext && !fileExt.includes(ext)) {
          fileExt.push(ext);
        }
      });

      const selectedFileType = await vscode.window.showQuickPick(fileExt, {
        placeHolder: "Select a file type",
      });


	  showFunctionPanel(context,  await pickFilesAndShowFunctions(selectedFileType))

    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
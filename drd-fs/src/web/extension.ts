// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { MemFS, WebDavOptions } from "./memfs";

function isValidHttpUrl(str: string) {
  let url;

  try {
    url = new URL(str);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

async function enableFs(
  context: vscode.ExtensionContext,
  webdavUrl: string,
  credentials?: WebDavOptions
): Promise<MemFS> {
  const memFs = new MemFS(webdavUrl, credentials);

  try {
    await memFs.readDavDirectory("/");
    context.subscriptions.push(memFs);

    return memFs;
  } catch (e) {
    memFs.dispose();
    throw e;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  /*const disposable = vscode.commands.registerCommand(
    "drd-fs.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed

      // Display a message box to the user
      vscode.window.showInformationMessage(
        "Hello World from drd-fs in a web extension host!"
      );
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse("memfs:/"),
        name: "MemFS - Sample",
      });
    }
  );
  context.subscriptions.push(disposable);

  //const webdavUrl = "http://localhost:8011";
  const webdavUrl = "http://localhost:9190/webdav";
  let apikey = "admin";
  let accessToken = undefined;
  let pathPrefix = undefined;*/

  let apikey = await context.secrets.get("druidfsprovider.apikey");
  let accessToken = await context.secrets.get("druidfsprovider.accessToken");
  let webdavUrl = await context.secrets.get("druidfsprovider.webdavUrl");
  let pathPrefix = await context.secrets.get("druidfsprovider.pathPrefix");

  context.messagePassingProtocol?.postMessage({ type: "ready" });

  context.messagePassingProtocol?.onDidReceiveMessage(async (message) => {
    console.log("Received message:", message);
    if (message.type === "setCredentials") {
      apikey = message.payload.apikey;
      accessToken = message.payload.accessToken;
      webdavUrl = message.payload.webdavUrl as string;
      pathPrefix = message.payload.pathPrefix;

      vscode.window.showInformationMessage("Connecting to remote server...");
      const memFs = await enableFs(context, webdavUrl, {
        basicAuthApikey: apikey,
        accessToken,
        prefix: pathPrefix,
      });
      //vscode.workspace.registerFileSystemProvider("memfs", memFs, {
      //  isCaseSensitive: true,
      //});
      vscode.window.showInformationMessage("Connected to remote server.");
    }
  });
}

// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode";
import { MemFS, WebDavOptions } from "./fileSystemProvider";

function isValidHttpUrl(str: string) {
  let url;

  try {
    url = new URL(str);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

export async function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("memfs.workspaceInit", (_) => {
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse("memfs:/"),
        name: "DruidFS - Sample",
      });
    })
  );
  //debugger;
  let apikey = await context.secrets.get("druidfsprovider.apikey");
  let accessToken = await context.secrets.get("druidfsprovider.accessToken");
  let webdavUrl = await context.secrets.get("druidfsprovider.webdavUrl");
  let pathPrefix = await context.secrets.get("druidfsprovider.pathPrefix");

  if ((!apikey && !accessToken) || !webdavUrl) {
    while (!webdavUrl || !isValidHttpUrl(webdavUrl)) {
      webdavUrl = await vscode.window.showInputBox({
        placeHolder: "Enter the webdavUrl ",
        prompt: "Enter the webdavUrl",
        validateInput(value) {
          return isValidHttpUrl(value) ? "" : "Invalid URL";
        },
      });
    }
    while (!apikey) {
      apikey = await vscode.window.showInputBox({
        placeHolder: "Enter the apikey ",
        prompt: "Enter the apikey",
      });
    }
  }
  try {
    vscode.window.showInformationMessage("Connecting to remote server...");
    const memFs = await enableFs(context, webdavUrl, {
      basicAuthApikey: apikey,
      accessToken,
      prefix: pathPrefix,
    });
    /*
    vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.parse(`memfs:/deployment`)
    );*/
    vscode.window.showInformationMessage("Connected to remote server.");
  } catch (e) {
    const error = e as Error;
    //error pops up a message box with the error message,
    //if the connection to the remote server fails

    vscode.window.showErrorMessage(
      "Failed to connect to remote server: " + error.message,
      { modal: true }
    );

    activate(context);
  }
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//
// ############################################################################
//
//						! USED FOR RUNNING VSCODE OUT OF SOURCES FOR WEB !
//										! DO NOT REMOVE !
//
// ############################################################################
//

import * as vscode from "vscode";
import { MemFS } from "./memfs";

export async function activate(context: vscode.ExtensionContext) {
  debugger;
  const apikey = await context.secrets.get("druidfsprovider.apikey");
  const webdavUrl = await context.secrets.get("druidfsprovider.webdavUrl");
  if (!apikey || !webdavUrl) {
    vscode.window.showErrorMessage(
      "Please set the apikey and webdavUrl in the secrets."
    );
    return;
  }
  const memFs = enableFs(context, webdavUrl, apikey);
  try {
    vscode.window.showInformationMessage("Connecting to remote server...");
    /*
    vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.parse(`memfs:/deployment`)
    );*/
    vscode.window.showInformationMessage("Connected to remote server.");
  } catch (e) {
    console.error(e);
    vscode.window.showErrorMessage(`Error: ${e}`);
  }
}

function enableFs(
  context: vscode.ExtensionContext,
  webdavUrl: string,
  apiKey: string
): MemFS {
  console.log("Enabling FS");
  const memFs = new MemFS(webdavUrl, apiKey);
  context.subscriptions.push(memFs);

  return memFs;
}

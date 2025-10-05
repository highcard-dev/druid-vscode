import * as vscode from "vscode";
import { MemFS } from "./memfs.js";

interface WebDavOptions {
  webdavUrl: string;
  basicAuthApikey?: string;
  accessToken?: string;
  prefix?: string;
}

let memfs: MemFS | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Druid FS extension is now active!");

  if (context.messagePassingProtocol) {
    // IPC mode - for web embedding like Cloudflare
    activateIPCMode(context);
  } else {
    // Direct WebDAV mode - for standalone extension usage
    activateWebDavMode(context);
  }
}

function activateIPCMode(context: vscode.ExtensionContext) {
  // Initialize MemFS for IPC mode
  memfs = new MemFS();
  context.subscriptions.push(memfs);

  void vscode.commands.executeCommand("workbench.action.closeAllEditors");

  // Create setEntrypoint customisation with the right click menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.setEntrypoint",
      async (event: vscode.Uri) => {
        const filePath =
          event.path ?? vscode.window.activeTextEditor?.document.fileName;

        if (filePath) {
          context.messagePassingProtocol?.postMessage({
            type: "SetEntryPoint",
            body: {
              path: filePath,
            },
          });
        }
      }
    )
  );

  // Listen for messages from host
  context.messagePassingProtocol?.onDidReceiveMessage(async (data) => {
    if (data.type === "WorkerLoaded") {
      console.log("WorkerLoaded", data.body);
      await memfs?.seed(data.body);

      void vscode.commands.executeCommand(
        "vscode.open",
        vscode.Uri.parse(`memfs:/${data.body.name}/${data.body.entrypoint}`),
        { preview: false }
      );
    }
  });

  // Send ready signal
  context.messagePassingProtocol?.postMessage({ type: "ready" });
}

async function activateWebDavMode(context: vscode.ExtensionContext) {
  // Create MemFS instance for WebDAV without IPC
  memfs = new MemFS();
  context.subscriptions.push(memfs);

  // Initialize credentials asynchronously
  await initializeCredentials(context, memfs);

  async function initializeCredentials(
    context: vscode.ExtensionContext,
    memFs: MemFS
  ) {
    try {
      // Get stored credentials
      let apikey = await context.secrets.get("druidfsprovider.apikey");
      let accessToken = await context.secrets.get(
        "druidfsprovider.accessToken"
      );
      let webdavUrl = await context.secrets.get("druidfsprovider.webdavUrl");
      let pathPrefix = await context.secrets.get("druidfsprovider.pathPrefix");

      // If we have credentials, configure the MemFS immediately
      if (webdavUrl && (apikey || accessToken)) {
        try {
          await memFs.configureWebDav({
            webdavUrl,
            basicAuthApikey: apikey,
            accessToken,
            prefix: pathPrefix,
          });

          // Add workspace folder if it's not already added
          const existingFolder = vscode.workspace.workspaceFolders?.find(
            (folder) => folder.uri.scheme === "memfs"
          );
          if (!existingFolder) {
            vscode.workspace.updateWorkspaceFolders(0, 0, {
              uri: vscode.Uri.parse("memfs:/"),
              name: "Druid - Filesystem",
            });
          }

          vscode.window.showInformationMessage("Connected to remote server.");
        } catch (error) {
          console.error("Failed to connect to remote server:", error);
          vscode.window.showErrorMessage(
            `Failed to connect to remote server: ${error}`
          );
        }
      }
    } catch (error) {
      console.error("Failed to initialize credentials:", error);
    }
  }

  // Handle credential updates via message protocol if available
  context.messagePassingProtocol?.onDidReceiveMessage(async (message) => {
    console.log("Received message:", message);
    if (message.type === "setCredentials") {
      try {
        vscode.window.showInformationMessage("Connecting to remote server...");

        // Store credentials for future sessions
        await context.secrets.store(
          "druidfsprovider.apikey",
          message.payload.apikey || ""
        );
        await context.secrets.store(
          "druidfsprovider.accessToken",
          message.payload.accessToken || ""
        );
        await context.secrets.store(
          "druidfsprovider.webdavUrl",
          message.payload.webdavUrl || ""
        );
        await context.secrets.store(
          "druidfsprovider.pathPrefix",
          message.payload.pathPrefix || ""
        );

        // Update MemFS configuration
        await memfs?.configureWebDav({
          webdavUrl: message.payload.webdavUrl,
          basicAuthApikey: message.payload.apikey,
          accessToken: message.payload.accessToken,
          prefix: message.payload.pathPrefix,
        });

        // Add workspace folder if it's not already added
        const existingFolder = vscode.workspace.workspaceFolders?.find(
          (folder) => folder.uri.scheme === "memfs"
        );
        if (!existingFolder) {
          vscode.workspace.updateWorkspaceFolders(0, 0, {
            uri: vscode.Uri.parse("memfs:/"),
            name: "Druid - Filesystem",
          });
        }

        vscode.window.showInformationMessage("Connected to remote server.");
      } catch (error) {
        console.error("Failed to connect to remote server:", error);
        vscode.window.showErrorMessage(
          `Failed to connect to remote server: ${error}`
        );
      }
    }
  });

  // Register command to set entry point for standalone mode
  const setEntrypoint = vscode.commands.registerCommand(
    "druidfsprovider.setEntrypoint",
    async () => {
      const webdavUrl = await vscode.window.showInputBox({
        prompt: "Enter WebDAV URL",
        placeHolder: "https://example.com/webdav",
      });

      if (!webdavUrl) {
        return;
      }

      // Get API key from configuration or prompt user
      const config = vscode.workspace.getConfiguration("druidfsprovider");
      let apikey = config.get<string>("apikey");

      if (!apikey) {
        apikey = await vscode.window.showInputBox({
          prompt: "Enter API Key",
          password: true,
        });

        if (!apikey) {
          return;
        }

        // Optionally save to configuration
        const saveKey = await vscode.window.showQuickPick(["Yes", "No"], {
          placeHolder: "Save API key to settings?",
        });

        if (saveKey === "Yes") {
          await config.update(
            "apikey",
            apikey,
            vscode.ConfigurationTarget.Global
          );
        }
      }

      // Configure WebDAV
      const options: WebDavOptions = {
        webdavUrl,
        basicAuthApikey: apikey,
      };

      try {
        await memfs?.configureWebDav(options);
        vscode.window.showInformationMessage(
          "WebDAV connection configured successfully!"
        );

        // Open the file system
        const uri = vscode.Uri.parse("memfs:/");
        await vscode.commands.executeCommand("vscode.openFolder", uri);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to configure WebDAV: ${error}`);
      }
    }
  );

  context.subscriptions.push(setEntrypoint);

  // Signal ready if message protocol is available
  context.messagePassingProtocol?.postMessage({ type: "ready" });
}

export function deactivate() {
  memfs?.dispose();
}

import { create } from "vs/workbench/workbench.web.main";
import { URI, UriComponents } from "vs/base/common/uri";
import {
  ColorScheme,
  IWorkbenchConstructionOptions,
} from "vs/workbench/browser/web.api";
import { IWorkspace, IWorkspaceProvider } from "vs/workbench/browser/web.api";
import { ISecretStorageProvider } from "vs/platform/secrets/common/secrets";

declare const window: any;

export function setCookie(name: string, val: string) {
  const date = new Date();
  const value = val;

  // Set it expire in 7 days
  date.setTime(date.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Set it
  document.cookie =
    name + "=" + value + "; expires=" + date.toUTCString() + "; path=/";
}

export function getCookie(name: string) {
  const value = "; " + document.cookie;
  const parts = value.split("; " + name + "=");

  if (parts.length == 2) {
    return parts.pop()?.split(";").shift();
  }
  return null;
}

export function deleteCookie(name: string) {
  const date = new Date();

  // Set it expire in -1 days
  date.setTime(date.getTime() + -1 * 24 * 60 * 60 * 1000);

  // Set it
  document.cookie = name + "=; expires=" + date.toUTCString() + "; path=/";
}

export class LocalStorageSecretStorageProvider
  implements ISecretStorageProvider
{
  private readonly _storageKey = "secrets.provider";

  private _secretsPromise: Promise<Record<string, string>> = this.load();

  type: "in-memory" | "persisted" | "unknown" = "persisted";

  private async load(): Promise<Record<string, string>> {
    const record = this.loadAdditionalSecrets();
    // Get the secrets from localStorage
    const encrypted = localStorage.getItem(this._storageKey);
    if (encrypted) {
      try {
        const decrypted = JSON.parse(encrypted);
        return { ...record, ...decrypted };
      } catch (err) {
        // TODO: send telemetry
        console.error("Failed to decrypt secrets from localStorage", err);
        localStorage.removeItem(this._storageKey);
      }
    }

    return record;
  }

  private loadAdditionalSecrets(): Record<string, string> {
    const c = getCookie("vscode-workbench-web-secrets");
    if (c) {
      const secrets = JSON.parse(c);
      deleteCookie("vscode-workbench-web-secrets");
      return secrets;
    }
    const configElement = window.document.getElementById(
      "vscode-workbench-web-secrets"
    );
    const configElementAttribute = configElement
      ? configElement.getAttribute("data-settings")
      : undefined;
    let records = {};
    if (!configElement || !configElementAttribute) {
      console.warn("Missing web configuration element");
    } else {
      records = JSON.parse(configElementAttribute);
      console.log("Overwrite", records);

      //delete element for security reasons
      configElement.remove();
    }
    return records;
  }

  async get(key: string): Promise<string | undefined> {
    const secrets = await this._secretsPromise;
    debugger;
    return secrets[key];
  }
  async set(key: string, value: string): Promise<void> {
    const secrets = await this._secretsPromise;
    secrets[key] = value;
    this._secretsPromise = Promise.resolve(secrets);
    this.save();
  }
  async delete(key: string): Promise<void> {
    const secrets = await this._secretsPromise;
    delete secrets[key];
    this._secretsPromise = Promise.resolve(secrets);
    this.save();
  }

  private async save(): Promise<void> {
    try {
      const encrypted = JSON.stringify(await this._secretsPromise);
      localStorage.setItem(this._storageKey, encrypted);
    } catch (err) {
      console.error(err);
    }
  }
}

(async function () {
  // create workbench
  let config: IWorkbenchConstructionOptions & {
    folderUri?: UriComponents;
    workspaceUri?: UriComponents;
    domElementId?: string;
  } = {};

  if (window.product) {
    config = window.product;
  } else {
    const result = await fetch("/product.json");
    config = await result.json();
  }

  if (Array.isArray(config.additionalBuiltinExtensions)) {
    const tempConfig = { ...config };

    tempConfig.additionalBuiltinExtensions =
      config.additionalBuiltinExtensions.map((ext) => URI.revive(ext));
    config = tempConfig;
  }

  let workspace;
  if (config.folderUri) {
    workspace = { folderUri: URI.revive(config.folderUri) };
  } else if (config.workspaceUri) {
    workspace = { workspaceUri: URI.revive(config.workspaceUri) };
  } else {
    workspace = undefined;
  }

  if (workspace) {
    const workspaceProvider: IWorkspaceProvider = {
      workspace,
      open: async (
        workspace: IWorkspace,
        options?: { reuse?: boolean; payload?: object }
      ) => true,
      trusted: true,
    };

    const configElement = window.document.getElementById(
      "vscode-workbench-web-configuration"
    );
    const configElementAttribute = configElement
      ? configElement.getAttribute("data-settings")
      : undefined;
    let overwrite = {};
    if (!configElement || !configElementAttribute) {
      console.warn("Missing web configuration element");
    } else {
      overwrite = JSON.parse(configElementAttribute);
      console.log("Overwrite", overwrite);
    }

    config = {
      ...config,
      ...overwrite,
      workspaceProvider,
      initialColorTheme: {
        themeType: ColorScheme.DARK,
      },
      configurationDefaults: {
        "druidfsprovider.apikey": "lol",
        "workbench.colorTheme": "Default Dark+", // Default Dark+
      },
      secretStorageProvider: new LocalStorageSecretStorageProvider(),
    };
  }

  const domElement =
    (!!config.domElementId && document.getElementById(config.domElementId)) ||
    document.body;
  create(domElement, config);
})();

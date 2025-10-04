// Adapted from https://github.com/microsoft/vscode-web-playground/blob/main/src/memfs.ts
// Original license:
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Disposable,
  EventEmitter,
  FileChangeType,
  FilePermission,
  FileSystemError,
  FileType,
  Position,
  Range,
  Uri,
  workspace,
} from "vscode";
import { XMLParser } from "fast-xml-parser";
import type {
  CancellationToken,
  Event,
  FileChangeEvent,
  FileSearchOptions,
  FileSearchProvider,
  FileSearchQuery,
  FileStat,
  FileSystemProvider,
  Progress,
  ProviderResult,
  TextSearchComplete,
  TextSearchOptions,
  TextSearchProvider,
  TextSearchQuery,
  TextSearchResult,
} from "vscode";

export interface WebDavOptions {
  webdavUrl: string;
  basicAuthApikey?: string;
  accessToken?: string;
  prefix?: string;
}

// Type definitions for IPC messages
interface FileData {
  path: string;
  contents: Uint8Array;
}

interface WorkerData {
  name?: string;
  files: FileData[];
  readOnly?: boolean;
  entrypoint?: string;
}

export class File implements FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;
  permissions?: FilePermission;

  constructor(public uri: Uri, name: string) {
    this.type = FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
  }
  public setReadOnly() {
    this.permissions = FilePermission.Readonly;
  }
}

export class Directory implements FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  entries: Map<string, File | Directory>;

  constructor(public uri: Uri, name: string) {
    this.type = FileType.Directory;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
    this.entries = new Map();
  }
}

export type Entry = File | Directory;
const encoder = new TextEncoder();

export class MemFS
  implements
    FileSystemProvider,
    FileSearchProvider,
    TextSearchProvider,
    Disposable
{
  static scheme = "memfs";
  private rootFolder = "memfs:/worker";
  private webdavOptions?: WebDavOptions;
  private _isWebDavInitialized = false;

  private readonly disposable: Disposable;

  private readRoot: ((value: [string, FileType][]) => void) | null = null;

  constructor() {
    this.disposable = Disposable.from(
      workspace.registerFileSystemProvider(MemFS.scheme, this, {
        isCaseSensitive: true,
      }),
      workspace.registerFileSearchProvider(MemFS.scheme, this),
      workspace.registerTextSearchProvider(MemFS.scheme, this)
    );
  }

  dispose() {
    this.disposable?.dispose();
  }

  // IPC Mode: Seed with data from host
  async seed(files: WorkerData) {
    this.rootFolder = files.name ?? this.rootFolder;
    this.createDirectory(Uri.parse(`memfs:/${this.rootFolder}/`));

    for (const file of files.files) {
      this.writeFile(
        Uri.parse(`memfs:/${this.rootFolder}${file.path}`),
        file.contents,
        {
          create: true,
          overwrite: true,
          readOnly: files.readOnly,
          suppressChannelUpdate: true,
        }
      );
    }

    if (this.readRoot) {
      this.readRoot(
        files.files.map((file: FileData) => [
          file.path.substring(1), // Remove leading slash
          FileType.File,
        ])
      );
      this.readRoot = null;
    }
  }

  // WebDAV Mode: Configure WebDAV connection
  async configureWebDav(options: WebDavOptions) {
    this.webdavOptions = {
      ...options,
      webdavUrl: options.webdavUrl.replace(/\/$/, ""), // Remove trailing slash
    };
    this._isWebDavInitialized = true;

    // Test the connection
    await this.readDavDirectory("/");

    // Fire change events to refresh any open files
    this._emitter.fire([
      {
        type: FileChangeType.Changed,
        uri: Uri.parse("memfs:/"),
      },
    ]);
  }

  private async waitForWebDavInitialization(
    maxWaitMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    while (!this._isWebDavInitialized && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this._isWebDavInitialized) {
      throw FileSystemError.Unavailable(
        "WebDAV file system not yet initialized. Please configure credentials first."
      );
    }
  }

  private getAuthHeader() {
    if (this.webdavOptions?.accessToken) {
      return "Bearer " + this.webdavOptions.accessToken;
    }
    if (this.webdavOptions?.basicAuthApikey) {
      const username = "apikey";
      const password = this.webdavOptions.basicAuthApikey;
      return "Basic " + btoa(username + ":" + password);
    }
    return undefined;
  }

  async davRequest(path: string, options: RequestInit) {
    await this.waitForWebDavInitialization();

    const authHeader = this.getAuthHeader();
    const { prefix = "" } = this.webdavOptions || {};
    const base = this.webdavOptions!.webdavUrl + prefix;

    const req = await fetch(base + path, {
      ...options,
      headers: new Headers({
        ...(options.headers || {}),
        ...(authHeader ? { Authorization: authHeader } : {}),
      }),
    });

    if (req.status === 404) {
      throw FileSystemError.FileNotFound();
    }

    if (!req.ok) {
      throw new Error("Failed to read directory");
    }
    return req;
  }

  async readDavDirectory(path = "/") {
    const req = await this.davRequest(path, {
      headers: {
        Depth: "1",
      },
      method: "PROPFIND",
      body: `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
  <prop>
    <getlastmodified xmlns="DAV:"/>
    <getcontentlength xmlns="DAV:"/>
    <resourcetype xmlns="DAV:"/>
  </prop>
</propfind>`,
    });

    const text = await req.text();
    const parser = new XMLParser();
    const obj = parser.parse(text);
    let list = obj["D:multistatus"]["D:response"];

    if (!Array.isArray(list)) {
      list = [list];
    }

    return list.map((item: any) => {
      const href = item["D:href"];
      let propstat = item["D:propstat"];

      if (!Array.isArray(propstat)) {
        propstat = [propstat];
      }

      const isDir = !!propstat.find((ps: any) => {
        return ps["D:prop"]?.["D:resourcetype"]?.["D:collection"] !== undefined;
      });

      let size = undefined;
      if (!isDir) {
        const sizeNode = propstat.find((ps: any) => {
          return ps["D:prop"]?.["D:getcontentlength"] !== undefined;
        });
        if (sizeNode) {
          size = sizeNode["D:prop"]["D:getcontentlength"];
        } else {
          size = 0;
        }
      }

      return {
        href: href,
        size: size,
        isDir: isDir,
      };
    }) as any[];
  }

  root = new Directory(Uri.parse("memfs:/"), "");

  async stat(uri: Uri): Promise<FileStat> {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      const data = await this.readDavDirectory(uri.path);
      if (data[0]) {
        return {
          type: !data[0]?.isDir ? FileType.File : FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: data[0]?.size || 0,
        };
      }
      throw FileSystemError.FileNotFound();
    } else {
      // IPC mode
      return this._lookup(uri, false);
    }
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      const list = await this.readDavDirectory(uri.path);
      const { prefix = "" } = this.webdavOptions || {};
      const filtered = list
        .filter((item) => !prefix || item.href !== prefix)
        .filter((item) => !prefix || item.href !== prefix + "/")
        .filter((item) => item.href !== prefix + uri.path)
        .filter((item) => item.href !== prefix + uri.path + "/");

      return filtered.map((item) => {
        let fullpath = item.href;
        if (fullpath.endsWith("/")) {
          fullpath = fullpath.slice(0, -1);
        }
        return [
          fullpath.split("/").pop(),
          !item.isDir ? FileType.File : FileType.Directory,
        ] as [string, FileType];
      });
    } else {
      // IPC mode
      const entry = this._lookup(uri, false);
      if (entry instanceof Directory) {
        const result: [string, FileType][] = [];
        for (const [name, child] of entry.entries) {
          result.push([name, child.type]);
        }
        return result;
      }

      // Handle special case for root when not yet seeded
      if (uri.path === "/" && this.readRoot === null) {
        return new Promise((resolve) => {
          this.readRoot = resolve;
        });
      }

      throw FileSystemError.FileNotADirectory(uri);
    }
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      const res = await this.davRequest(uri.path, {
        method: "GET",
        body: undefined,
      });
      const arrayBuffer = await res.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } else {
      // IPC mode
      const data = this._lookup(uri, false);
      if (data instanceof File) {
        return data.data ?? new Uint8Array();
      }
      throw FileSystemError.FileIsADirectory(uri);
    }
  }

  writeFile(
    uri: Uri,
    content: Uint8Array,
    options: {
      create: boolean;
      overwrite: boolean;
      readOnly?: boolean;
      suppressChannelUpdate?: boolean;
    }
  ): void {
    if (this._isWebDavInitialized) {
      // WebDAV mode - async operation
      this.writeFileWebDav(uri, content, options);
    } else {
      // IPC mode - sync operation
      this.writeFileIPC(uri, content, options);
    }
  }

  private async writeFileWebDav(
    uri: Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ) {
    await this.davRequest(uri.path, {
      method: "PUT",
      body: content as any,
    });
    this._fireSoon({ type: FileChangeType.Changed, uri });
  }

  private writeFileIPC(
    uri: Uri,
    content: Uint8Array,
    options: {
      create: boolean;
      overwrite: boolean;
      readOnly?: boolean;
      suppressChannelUpdate?: boolean;
    }
  ): void {
    const basename = this._basename(uri.path);
    const parent = this._lookupParentDirectory(uri);
    let entry = parent.entries.get(basename);
    if (entry instanceof Directory) {
      throw FileSystemError.FileIsADirectory(uri);
    }
    if (!entry && !options.create) {
      throw FileSystemError.FileNotFound(uri);
    }
    if (entry && options.create && !options.overwrite) {
      throw FileSystemError.FileExists(uri);
    }
    if (!entry) {
      entry = new File(uri, basename);
      parent.entries.set(basename, entry);
      this._fireSoon({ type: FileChangeType.Created, uri });
    }
    entry.mtime = Date.now();
    entry.size = content.byteLength;
    entry.data = content;

    if (options.readOnly) {
      entry.setReadOnly();
    }

    this._fireSoon({ type: FileChangeType.Changed, uri });

    // Note: IPC updates are handled by the extension context, not here
  }

  rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      this.renameWebDav(oldUri, newUri, options);
    } else {
      // IPC mode
      this.renameIPC(oldUri, newUri, options);
    }
  }

  private async renameWebDav(
    oldUri: Uri,
    newUri: Uri,
    options: { overwrite: boolean }
  ) {
    const { prefix = "" } = this.webdavOptions || {};
    await this.davRequest(oldUri.path, {
      method: "MOVE",
      headers: {
        Destination: prefix + newUri.path,
      },
    });
    this._fireSoon(
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri }
    );
  }

  private renameIPC(
    oldUri: Uri,
    newUri: Uri,
    options: { overwrite: boolean }
  ): void {
    if (!options.overwrite && this._lookup(newUri, true)) {
      throw FileSystemError.FileExists(newUri);
    }

    const entry = this._lookup(oldUri, false);
    const oldParent = this._lookupParentDirectory(oldUri);

    const newParent = this._lookupParentDirectory(newUri);
    const newName = this._basename(newUri.path);

    oldParent.entries.delete(entry.name);
    entry.name = newName;
    newParent.entries.set(newName, entry);

    this._fireSoon(
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri }
    );
  }

  delete(uri: Uri): void {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      this.deleteWebDav(uri);
    } else {
      // IPC mode
      this.deleteIPC(uri);
    }
  }

  private async deleteWebDav(uri: Uri) {
    await this.davRequest(uri.path, {
      method: "DELETE",
    });
    this._fireSoon({ type: FileChangeType.Deleted, uri });
  }

  private deleteIPC(uri: Uri): void {
    const dirname = uri.with({ path: this._dirname(uri.path) });
    const basename = this._basename(uri.path);
    const parent = this._lookupAsDirectory(dirname, false);
    if (!parent.entries.has(basename)) {
      throw FileSystemError.FileNotFound(uri);
    }
    parent.entries.delete(basename);
    parent.mtime = Date.now();
    parent.size -= 1;
    this._fireSoon(
      { type: FileChangeType.Changed, uri: dirname },
      { type: FileChangeType.Deleted, uri }
    );

    // Note: IPC delete updates are handled by the extension context, not here
  }

  createDirectory(uri: Uri): void {
    if (this._isWebDavInitialized) {
      // WebDAV mode
      this.createDirectoryWebDav(uri);
    } else {
      // IPC mode
      this.createDirectoryIPC(uri);
    }
  }

  private async createDirectoryWebDav(uri: Uri) {
    await this.davRequest(uri.path, {
      method: "MKCOL",
    });
    this._fireSoon({ type: FileChangeType.Created, uri });
  }

  private createDirectoryIPC(uri: Uri): void {
    const basename = this._basename(uri.path);
    const dirname = uri.with({ path: this._dirname(uri.path) });
    const parent = this._lookupAsDirectory(dirname, false);

    const entry = new Directory(uri, basename);
    parent.entries.set(entry.name, entry);
    parent.mtime = Date.now();
    parent.size += 1;
    this._fireSoon(
      { type: FileChangeType.Changed, uri: dirname },
      { type: FileChangeType.Created, uri }
    );
  }

  // --- lookup (IPC mode only)

  private _lookup(uri: Uri, silent: false): Entry;
  private _lookup(uri: Uri, silent: boolean): Entry | undefined;
  private _lookup(uri: Uri, silent: boolean): Entry | undefined {
    const parts = uri.path.split("/");
    let entry: Entry = this.root;
    for (const part of parts) {
      if (!part) {
        continue;
      }
      let child: Entry | undefined;
      if (entry instanceof Directory) {
        child = entry.entries.get(part);
      }
      if (!child) {
        if (!silent) {
          throw FileSystemError.FileNotFound(uri);
        } else {
          return undefined;
        }
      }
      entry = child;
    }
    return entry;
  }

  private _lookupAsDirectory(uri: Uri, silent: boolean): Directory {
    const entry = this._lookup(uri, silent);
    if (entry instanceof Directory) {
      return entry;
    }
    throw FileSystemError.FileNotADirectory(uri);
  }

  private _lookupAsFile(uri: Uri, silent: boolean): File {
    const entry = this._lookup(uri, silent);
    if (entry instanceof File) {
      return entry;
    }
    throw FileSystemError.FileIsADirectory(uri);
  }

  private _lookupParentDirectory(uri: Uri): Directory {
    const dirname = uri.with({ path: this._dirname(uri.path) });
    return this._lookupAsDirectory(dirname, false);
  }

  // --- manage file events

  private _emitter = new EventEmitter<FileChangeEvent[]>();
  private _bufferedEvents: FileChangeEvent[] = [];
  private _fireSoonHandle?: unknown;

  readonly onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

  watch(_resource: Uri): Disposable {
    // ignore, fires for all changes...
    return new Disposable(() => {});
  }

  private _fireSoon(...events: FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle as number);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }

  private _basename(path: string): string {
    path = this._rtrim(path, "/");
    if (!path) {
      return "";
    }

    return path.substr(path.lastIndexOf("/") + 1);
  }

  private _dirname(path: string): string {
    path = this._rtrim(path, "/");
    if (!path) {
      return "/";
    }

    return path.substr(0, path.lastIndexOf("/"));
  }

  private _rtrim(haystack: string, needle: string): string {
    if (!haystack || !needle) {
      return haystack;
    }

    const needleLen = needle.length,
      haystackLen = haystack.length;

    if (needleLen === 0 || haystackLen === 0) {
      return haystack;
    }

    let offset = haystackLen,
      idx = -1;

    while (true) {
      idx = haystack.lastIndexOf(needle, offset - 1);
      if (idx === -1 || idx + needleLen !== offset) {
        break;
      }
      if (idx === 0) {
        return "";
      }
      offset = idx;
    }

    return haystack.substring(0, offset);
  }

  private _getFiles(): Set<File> {
    const files = new Set<File>();

    this._doGetFiles(this.root, files);

    return files;
  }

  private _doGetFiles(dir: Directory, files: Set<File>): void {
    dir.entries.forEach((entry) => {
      if (entry instanceof File) {
        files.add(entry);
      } else {
        this._doGetFiles(entry, files);
      }
    });
  }

  private _convertSimple2RegExpPattern(pattern: string): string {
    return pattern
      .replace(/[\-\\\{\}\+\?\|\^\$\.\,\[\]\(\)\#\s]/g, "\\$&")
      .replace(/[\*]/g, ".*");
  }

  // --- search provider

  provideFileSearchResults(
    query: FileSearchQuery,
    _options: FileSearchOptions,
    _token: CancellationToken
  ): ProviderResult<Uri[]> {
    return this._findFiles(query.pattern, []);
  }

  private _findFiles(query: string | undefined, excludes: string[]): Uri[] {
    const files = this._getFiles();

    const result: Uri[] = [];

    const pattern = query
      ? new RegExp(this._convertSimple2RegExpPattern(query))
      : null;

    for (const file of files) {
      if (!pattern || pattern.exec(file.name)) {
        let include = true;
        for (const exclude of excludes) {
          const excludePattern = new RegExp(
            this._convertSimple2RegExpPattern(exclude)
          );
          if (excludePattern.exec(file.name)) {
            include = false;
            break;
          }
        }

        if (include) {
          result.push(file.uri);
        }
      }
    }

    return result;
  }

  private _textDecoder = new TextDecoder();

  async provideTextSearchResults(
    query: TextSearchQuery,
    options: TextSearchOptions,
    progress: Progress<TextSearchResult>,
    _token: CancellationToken
  ) {
    const results: TextSearchComplete = { limitHit: false };

    const files = this._findFiles(options.includes[0], options.excludes);
    if (files) {
      for (const file of files) {
        const content = this._textDecoder.decode(await this.readFile(file));

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const index = line.indexOf(query.pattern);
          if (index !== -1) {
            progress.report({
              uri: file,
              ranges: new Range(
                new Position(i, index),
                new Position(i, index + query.pattern.length)
              ),
              preview: {
                text: line,
                matches: new Range(
                  new Position(0, index),
                  new Position(0, index + query.pattern.length)
                ),
              },
            });
          }
        }
      }
    }

    return results;
  }
}

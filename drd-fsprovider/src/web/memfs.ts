/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
  window,
  workspace,
} from "vscode";

import { createDAVClient } from "tsdav";

export class File implements FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;

  constructor(public uri: Uri, name: string) {
    this.type = FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
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

const textEncoder = new TextEncoder();

export class MemFS implements FileSystemProvider, Disposable {
  static scheme = "memfs";

  private readonly disposable: Disposable;

  constructor(private wedavUrl: string, private apiKey: string) {
    //debugger;
    this.disposable = Disposable.from(
      workspace.registerFileSystemProvider(MemFS.scheme, this, {
        isCaseSensitive: true,
      })
    );
  }

  dispose() {
    this.disposable?.dispose();
  }

  async getDAVClient() {
    console.log("Creating DAV client");
    console.log("==================================================00");

    return createDAVClient({
      serverUrl: this.wedavUrl,
      credentials: {
        username: "apikey",
        password: this.apiKey,
      },
      authMethod: "Basic",
    });
  }

  async readDavDirectory(path = "/") {
    const client = await this.getDAVClient();
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "PROPFIND",
        headers: {
          Depth: "1",
        },
        body: "",
      },
    });
  }

  async writeDavFile(path = "/", data: Uint8Array) {
    const client = await this.getDAVClient();
    //debugger;
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "PUT",
        body: data,
      },
    });
  }

  async readDavFile(path = "/") {
    const client = await this.getDAVClient();
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "GET",
        body: undefined,
      },
    });
  }

  async moveDavFile(path = "/", newPath = "/") {
    const client = await this.getDAVClient();
    //debugger;
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "MOVE",
        headers: {
          Destination: newPath,
        },
        body: undefined,
      },
    });
  }

  async createDavDirectory(path = "/") {
    const client = await this.getDAVClient();
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "MKCOL",
        body: undefined,
      },
    });
  }

  async deleteDavFile(path = "/") {
    const client = await this.getDAVClient();
    return await client.davRequest({
      url: this.wedavUrl + path,
      convertIncoming: false,
      init: {
        method: "DELETE",
        body: undefined,
      },
    });
  }

  root = new Directory(Uri.parse("memfs:/"), "");

  // --- manage file metadata

  async stat(uri: Uri): Promise<FileStat> {
    const data = await this.readDavDirectory(uri.path);

    if (data?.[0]?.raw !== undefined && data[0].ok) {
      return {
        type:
          data.length === 1 && data[0]?.props?.getcontentlength !== undefined
            ? FileType.File
            : FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    }
    throw FileSystemError.FileNotFound();
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const list = await this.readDavDirectory(uri.path);

    const filtered = list
      .filter((item) => item.href !== uri.path)
      .filter((item) => item.href !== uri.path + "/")
      .filter((item) => item.ok)
      .map(
        (item) =>
          [
            item.href || "",
            item?.props?.getcontentlength !== undefined
              ? FileType.File
              : FileType.Directory,
          ] as [string, FileType]
      );
    console.log(filtered);
    return filtered;
  }

  // --- manage file contents

  async readFile(uri: Uri): Promise<Uint8Array> {
    const data = await this.readDavFile(uri.path);

    if (data?.[0]?.raw !== undefined && data[0].ok) {
      return textEncoder.encode(data[0].raw);
    }
    throw FileSystemError.FileNotFound();
  }

  async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ) {
    await this.writeDavFile(uri.path, content);
  }

  // --- manage files/folders

  async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }) {
    await this.moveDavFile(oldUri.path, newUri.path);
  }

  async delete(uri: Uri) {
    await this.deleteDavFile(uri.path);
  }

  async createDirectory(uri: Uri) {
    await this.createDavDirectory(uri.path);
  }

  onDidChangeFile() {
    return new EventEmitter<FileChangeEvent[]>();
  }

  watch(
    uri: Uri,
    options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    }
  ): Disposable {
    return new Disposable(() => {});
  }
}

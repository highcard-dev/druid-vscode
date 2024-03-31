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

import { XMLParser } from "fast-xml-parser";

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

  async davRequest(path: string, options: RequestInit) {
    const username = "apikey";
    const password = this.apiKey;

    const req = await fetch(this.wedavUrl + path, {
      ...options,
      headers: new Headers({
        ...(options.headers || {}),
        Authorization: "Basic " + btoa(username + ":" + password),
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
    //xmt to js object
    const obj = parser.parse(text);
    //console.log(obj);
    //debugger;
    let list = obj["D:multistatus"]["D:response"];

    if (!Array.isArray(list)) {
      list = [list];
    }

    //console.log(list);
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

  async moveDavFile(path = "/", newPath = "/") {
    //debugger;
    return await this.davRequest(path, {
      method: "MOVE",
      headers: {
        Destination: newPath,
      },
    });
  }

  root = new Directory(Uri.parse("memfs:/"), "");

  // --- manage file metadata

  async stat(uri: Uri): Promise<FileStat> {
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
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const list = await this.readDavDirectory(uri.path);

    const filtered = list
      .filter((item) => item.href !== uri.path)
      .filter((item) => item.href !== uri.path + "/")
      .map(
        (item) =>
          [item.href, !item.isDir ? FileType.File : FileType.Directory] as [
            string,
            FileType
          ]
      );
    return filtered;
  }

  // --- manage file contents

  async readFile(uri: Uri): Promise<Uint8Array> {
    const res = await this.davRequest(uri.path, {
      method: "GET",
      body: undefined,
    });

    const arrayBuffer = await res.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ) {
    await this.davRequest(uri.path, {
      method: "PUT",
      body: content,
    });
  }

  // --- manage files/folders

  async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }) {
    await this.davRequest(oldUri.path, {
      method: "MOVE",
      headers: {
        Destination: newUri.path,
      },
    });
  }

  async delete(uri: Uri) {
    await this.davRequest(uri.path, {
      method: "DELETE",
    });
  }

  async createDirectory(uri: Uri) {
    await this.davRequest(uri.path, {
      method: "MKCOL",
    });
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

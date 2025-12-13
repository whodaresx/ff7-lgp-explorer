// LGP Archive management class
// Created by mav, parts ported from Python source by Niema Moshiri
// https://github.com/niemasd/PyFF7

import {Parser} from 'binary-parser';

const LOOKUP_VALUE_MAX = 30;
const NUM_LOOKTAB_ENTRIES = LOOKUP_VALUE_MAX * LOOKUP_VALUE_MAX; // 900 entries
const HEADER_SIZE = 16;
const TOC_ENTRY_SIZE = 27;
const HASH_TABLE_SIZE = NUM_LOOKTAB_ENTRIES * 4; // 3600 bytes
const FILE_HEADER_SIZE = 24;
const PATH_ENTRY_SIZE = 130;
const DEFAULT_TOC_TYPE = 0x0E;
const DEFAULT_MAGIC = "SQUARESOFT";
const DEFAULT_TERMINATOR = "FINAL FANTASY7";

const lgpPathEntry = new Parser()
    .string('folderName', {
        length: 128,
        stripNull: true
    })
    .uint16le('tocIndex')

const lgpPathGroup = new Parser()
    .uint16le('numPaths')
    .array('paths', {
        type: lgpPathEntry,
        length: 'numPaths'
    })

const lgpLookupEntry = new Parser()
    .uint16le('tocIndex')
    .uint16le('fileCount')

const lgpToc = new Parser()
    .string('filename', {
        length: 20,
        stripNull: true
    })
    .uint32le('offset')
    .pointer('filesize', {
        type: 'uint32le',
        offset: function() {
            return (this.offset as number) + 20;
        }
    })
    .uint8('type')
    .uint16le('pathIndex')

const lgpParser = new Parser()
    .uint16le('null1')
    .string('magic', {
        length: 10,
        stripNull: true
    })
    .uint16le('numFiles')
    .uint16le('null2')
    .array('toc', {
        type: lgpToc,
        length: 'numFiles'
    })
    .array('lookupEntries', {
        type: lgpLookupEntry,
        length: NUM_LOOKTAB_ENTRIES
    })
    .uint16le('numPathGroups')
    .array('pathGroups', {
        type: lgpPathGroup,
        length: 'numPathGroups'
    })

declare global {
    interface String {
        charCode: () => number;
    }
}

interface TOCEntry {
    filename: string;
    offset: number;
    newOffset: number;
    filesize: number;
    type: number;
    pathIndex: number;
}

interface LookupEntry {
    tocIndex: number;
    fileCount: number;
}

interface PathEntry {
    folderName: string;
    tocIndex: number;
}

interface PathGroup {
    numPaths: number;
    paths: PathEntry[];
}

interface LGPArchive {
    null1: number;
    magic: string;
    numFiles: number;
    null2: number;
    toc: TOCEntry[];
    lookupEntries: LookupEntry[];
    numPathGroups: number;
    pathGroups: PathGroup[];
}

String.prototype.charCode = function(): number {
    return this.charCodeAt(0);
}

export class LGP {
    archive: LGPArchive;
    data: Uint8Array;
    modified: {[key: string]: Uint8Array} = {};

    constructor(data: ArrayBuffer) {
        this.data = new Uint8Array(data);
        this.archive = lgpParser.parse(this.data);
        if (this.archive.magic !== DEFAULT_MAGIC) {
            throw Error("Invalid LGP header: expected " + DEFAULT_MAGIC + ", got " + this.archive.magic);
        }
    }

    getCharLookupValue(char: string): number {
        if (char.length !== 1) throw Error("Invalid length for char lookup: " + char);
        if (char === '.') return -1;
        if (char === '_') return 10; // same as 'k'
        if (char === '-') return 11; // same as 'l'
        if (char >= '0' && char <= '9') return char.charCode() - '0'.charCode();
        if (char >= 'A' && char <= 'Z') return char.toLowerCase().charCode() - 'a'.charCode();
        if (char >= 'a' && char <= 'z') return char.charCode() - 'a'.charCode();
        throw Error("Invalid character in filename: " + char);
    }

    getFileStem(filename: string): string {
        const dotIndex = filename.lastIndexOf('.');
        return dotIndex === -1 ? filename : filename.substring(0, dotIndex);
    }

    computeHash(filename: string): number {
        const stem = this.getFileStem(filename);
        if (stem.length === 0) throw Error("Invalid filename: empty stem");
        const l1 = this.getCharLookupValue(stem[0]);
        let hash = l1 * LOOKUP_VALUE_MAX;
        if (stem.length > 1) {
            const l2 = this.getCharLookupValue(stem[1]);
            hash += l2 + 1;
        }
        return hash;
    }

    getDataOffset(): number {
        let size = HEADER_SIZE;
        size += this.archive.toc.length * TOC_ENTRY_SIZE;
        size += HASH_TABLE_SIZE;
        size += 2; // numPathGroups
        this.archive.pathGroups.forEach(group => {
            size += 2; // numPaths
            size += group.numPaths * PATH_ENTRY_SIZE;
        });
        return size;
    }    
    
    getSize(): number {
        let size = this.getDataOffset();
        this.archive.toc.forEach(file => {
            size += FILE_HEADER_SIZE;
            size += file.filesize;
        });
        size += DEFAULT_TERMINATOR.length;
        return size;
    }

    buildLookupTable(): LookupEntry[] {
        const fileCount = new Array(NUM_LOOKTAB_ENTRIES).fill(0);
        const tocIndex = new Array(NUM_LOOKTAB_ENTRIES).fill(0);
        this.archive.toc.forEach((entry, i: number) => {
            const lookupIndex = this.computeHash(entry.filename);
            fileCount[lookupIndex]++;
            if (tocIndex[lookupIndex] === 0) {
                tocIndex[lookupIndex] = i + 1; // 1-indexed
            }
        });
        return fileCount.map((count, index) => ({tocIndex: tocIndex[index], fileCount: count}));
    }

    getFile(name: string): Uint8Array | null {
        const entry = this.archive.toc.find(item => item.filename === name);
        if (!entry) return null;
        if (this.modified[name]) return this.modified[name];

        const out = new Uint8Array(entry.filesize);
        const offset = entry.offset + FILE_HEADER_SIZE;
        out.set(this.data.slice(offset, offset + entry.filesize));
        return out;
    }

    setFile(name: string, data: Uint8Array): boolean {
        const entry = this.archive.toc.find(item => item.filename === name);
        if (!entry) return false; 
        entry.filesize = data.length; 
        this.modified[name] = data;
        return true;
    }

    insertFile(name: string, data: Uint8Array): boolean {
        // Truncate filename to max 19 chars (20 bytes with null terminator)
        const filename = name.slice(0, 19);
        
        // Check if file already exists
        if (this.archive.toc.find(item => item.filename === filename)) {
            return false;
        }
        
        const newEntry: TOCEntry = {
            filename,
            offset: 0,
            newOffset: 0,
            filesize: data.length,
            type: DEFAULT_TOC_TYPE,
            pathIndex: 0,
        };
        
        this.archive.toc.push(newEntry);
        this.archive.numFiles = this.archive.toc.length;
        this.modified[filename] = data;
        return true;
    }

    removeFile(name: string): boolean {
        const index = this.archive.toc.findIndex(item => item.filename === name);
        if (index === -1) return false;
        
        // Remove from TOC
        this.archive.toc.splice(index, 1);
        this.archive.numFiles = this.archive.toc.length;
        
        // Remove from modified if present
        delete this.modified[name];
        
        return true;
    }

    writeString(view: DataView, pos: number, str: string, length: number): void {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const arr = new Uint8Array(view.buffer, pos, length);
        arr.fill(0);
        arr.set(bytes.slice(0, length));
    }

    writeArchive(): ArrayBuffer {
        let currentDataOffset = this.getDataOffset();

        this.archive.toc.forEach(entry => {
            entry.newOffset = currentDataOffset;
            currentDataOffset += FILE_HEADER_SIZE + entry.filesize;
        });

        const totalSize = currentDataOffset + DEFAULT_TERMINATOR.length;
        const out = new ArrayBuffer(totalSize);
        const view = new DataView(out);
        let pos = 0;

        // Write header (16 bytes)
        view.setUint16(pos, 0, true);
        pos += 2;
        this.writeString(view, pos, DEFAULT_MAGIC, 10);
        pos += 10;
        view.setUint16(pos, this.archive.toc.length, true);
        pos += 2;
        view.setUint16(pos, 0, true);
        pos += 2;

        // Write TOC entries (27 bytes each)
        this.archive.toc.forEach(entry => {
            this.writeString(view, pos, entry.filename, 20);
            pos += 20;
            view.setUint32(pos, entry.newOffset, true);
            pos += 4;
            view.setUint8(pos, DEFAULT_TOC_TYPE);
            pos += 1;
            view.setUint16(pos, entry.pathIndex, true);
            pos += 2;
        });

        // Write hash table (3600 bytes)
        const lookupTable = this.buildLookupTable();
        lookupTable.forEach(({ tocIndex, fileCount }) => {
            view.setUint16(pos, tocIndex, true);
            pos += 2;
            view.setUint16(pos, fileCount, true);
            pos += 2;
        });

        // Write path table
        view.setUint16(pos, this.archive.numPathGroups, true);
        pos += 2;
        this.archive.pathGroups.forEach(group => {
            view.setUint16(pos, group.numPaths, true);
            pos += 2;
            group.paths.forEach(path => {
                this.writeString(view, pos, path.folderName, 128);
                pos += 128;
                view.setUint16(pos, path.tocIndex, true);
                pos += 2;
            });
        });

        // Write file data blocks
        this.archive.toc.forEach(entry => {
            let filePos = entry.newOffset;
            const data = this.getFile(entry.filename);
            if (!data) throw Error("Data not found for file: " + entry.filename);

            this.writeString(view, filePos, entry.filename, 20);
            filePos += 20;
            view.setUint32(filePos, entry.filesize, true);
            filePos += 4;
            new Uint8Array(out, filePos, entry.filesize).set(data);
        });

        // Write terminator
        this.writeString(view, currentDataOffset, DEFAULT_TERMINATOR, DEFAULT_TERMINATOR.length);

        return out;
    }
}
# LGP File Format Specification

LGP (Large Game Package) is an archive format used by Final Fantasy VII to store game assets. This document describes the binary format based on reverse-engineering the ulgp implementation.

## Overview

The LGP format consists of the following sections in order:

1. **Header** - Archive metadata and file count
2. **Table of Contents (TOC)** - File entries with names and offsets
3. **Hash Table** - Lookup table for fast file access
4. **Path Table** - Optional directory paths for files
5. **File Data** - Actual file contents with individual headers
6. **Footer** - "FINAL FANTASY7" terminator string

All multi-byte integers are stored in **little-endian** format.

---

## 1. Header (16 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 2    | uint16     | Reserved (always 0)                      |
| 0x02   | 10   | char[10]   | Magic string: `SQUARESOFT`               |
| 0x0C   | 2    | uint16     | Number of files in archive               |
| 0x0E   | 2    | uint16     | Reserved (always 0)                      |

**Total: 16 bytes**

### Validation
- The magic string at offset 0x02 must exactly match `SQUARESOFT` (ASCII, no null terminator within the 10 bytes)

---

## 2. Table of Contents (TOC)

Immediately follows the header. Contains `file_count` entries, each 27 bytes.

### TOC Entry (27 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 20   | char[20]   | Filename (null-padded, no path)          |
| 0x14   | 4    | uint32     | Absolute file offset in archive          |
| 0x18   | 1    | uint8      | File type (always 0x0E / 14)             |
| 0x19   | 2    | uint16     | Path index (0 = no path, 1+ = path table index) |

**Total per entry: 27 bytes**

### Notes
- Filenames are stored without directory paths
- Filenames are null-terminated within the 20-byte field
- The `offset` points to the start of the File Header for this file
- The `path` field references the Path Table (1-indexed); 0 means the file is in the root

---

## 3. Hash Table (3600 bytes)

Immediately follows the TOC. Fixed size of 900 entries (30 x 30 grid).

### Hash Table Entry (4 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 2    | uint16     | Index into TOC (1-indexed, 0 = empty)    |
| 0x02   | 2    | uint16     | Count of consecutive entries             |

**Total: 900 entries x 4 bytes = 3600 bytes**

### Hash Function

The hash is computed from the filename (without path) using the first two characters of the file stem (filename without extension):

```
hash_value = hash(first_char) * 30 + hash(second_char) + 1
```

If the filename has only one character in its stem, only the first character is used:
```
hash_value = hash(first_char) * 30
```

### Character Hash Values

| Character   | Hash Value |
|-------------|------------|
| a-z (A-Z)   | 0-25 (case-insensitive) |
| 0-9         | 0-9        |
| _ (underscore) | 10 (same as 'k') |
| - (hyphen)  | 11 (same as 'l') |

### Lookup Algorithm

1. Compute hash from filename
2. Read `HashTable[hash]`
3. If `index` is 0, file not found
4. Search TOC entries from `index-1` for `count` entries
5. Match by filename

---

## 4. Path Table

Immediately follows the Hash Table. Variable size.

### Path Table Header (2 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 2    | uint16     | Number of path groups                    |

### Path Group

Each path group contains paths for files that share the same filename but are in different directories.

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 2    | uint16     | Number of paths in this group            |
| 0x02   | var  | Path[]     | Array of Path entries                    |

### Path Entry (130 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 128  | char[128]  | Directory path (null-padded, no trailing slash) |
| 0x80   | 2    | uint16     | TOC index this path belongs to           |

**Total per Path entry: 130 bytes**

### Notes
- Path index in TOC entries is 1-indexed into path groups
- Multiple files with the same name but different paths share a path group
- Empty path string means root directory

---

## 5. File Data

File data blocks follow the Path Table. Each file has a header followed by raw data.

### File Header (24 bytes)

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 20   | char[20]   | Filename (same as in TOC)                |
| 0x14   | 4    | uint32     | File size in bytes                       |

**Total: 24 bytes**

### File Content

Immediately follows the File Header. Size is specified in the header.

| Offset | Size       | Type       | Description                              |
|--------|------------|------------|------------------------------------------|
| 0x00   | file_size  | byte[]     | Raw file data                            |

---

## 6. Footer

The archive ends with a terminator string:

| Offset | Size | Type       | Description                              |
|--------|------|------------|------------------------------------------|
| 0x00   | 14   | char[14]   | `FINAL FANTASY7` (no null terminator)    |

---

## Complete File Layout

```
+------------------+
|     Header       |  16 bytes
+------------------+
|       TOC        |  27 bytes x file_count
+------------------+
|   Hash Table     |  3600 bytes (fixed)
+------------------+
|   Path Table     |  variable
+------------------+
|   File Data      |  variable (file headers + contents)
|      ...         |
+------------------+
|     Footer       |  14 bytes ("FINAL FANTASY7")
+------------------+
```

---

## Reading Algorithm

1. **Read Header**
   - Validate magic string "SQUARESOFT"
   - Extract file count

2. **Read TOC**
   - Read `file_count` entries of 27 bytes each
   - Store filename, offset, type, and path index

3. **Skip Hash Table**
   - Skip 3600 bytes (or read for validation/fast lookup)

4. **Read Path Table**
   - Read path group count
   - For each group, read path count and path entries

5. **Resolve Full Paths**
   - For each TOC entry with path index > 0:
     - Look up path group at `path_index - 1`
     - Find path entry matching TOC index
     - Prepend path to filename

6. **Read File Data (on demand)**
   - Seek to TOC entry's offset
   - Read 24-byte file header
   - Read `file_size` bytes of content

---

## Writing Algorithm

1. **Build Metadata**
   - Compute hash for each file
   - Group files by hash bucket
   - Identify files needing path entries (same name, different paths)

2. **Write Header**
   - Write placeholder values (will update TOC offsets later)

3. **Write TOC**
   - Write entries with placeholder offsets

4. **Write Hash Table**
   - Populate based on file groupings

5. **Write Path Table**
   - Group paths by filename collisions

6. **Write File Data**
   - For each file, write header and content
   - Record actual offset

7. **Update TOC**
   - Seek back to TOC section
   - Update offsets with actual values

8. **Write Footer**
   - Append "FINAL FANTASY7"

---

## Size Limits

- Maximum files: 65,535 (uint16 in header)
- Maximum file size: 4 GB (uint32 in file header)
- Maximum archive size: 4 GB (uint32 offsets in TOC)
- Maximum filename length: 19 characters (20 bytes with null)
- Maximum path length: 127 characters (128 bytes with null)

---

## Data Types Reference

| Type      | Size    | Description                    |
|-----------|---------|--------------------------------|
| uint8     | 1 byte  | Unsigned 8-bit integer         |
| uint16    | 2 bytes | Unsigned 16-bit little-endian  |
| uint32    | 4 bytes | Unsigned 32-bit little-endian  |
| char[N]   | N bytes | ASCII string, null-padded      |

---

## Example: Calculating File Position

To find file "test.dat":

1. Compute hash: `hash('t') * 30 + hash('e') + 1 = 19 * 30 + 4 + 1 = 575`
2. Read `HashTable[575]`: `{index: 42, count: 3}`
3. Search TOC entries 41, 42, 43 (0-indexed: index-1)
4. Find entry where `name == "test.dat"`
5. Seek to entry's `offset`
6. Read 24-byte file header
7. Read `file_size` bytes

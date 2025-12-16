# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FF7 LGP Explorer is a web-based tool for viewing and editing Final Fantasy 7 LGP archive files. LGP (Large Game Package) is a proprietary archive format used by FF7 to store game assets.

## Commands

- `pnpm dev` - Start development server (Vite)
- `pnpm build` - Build for production
- `pnpm lint` - Run ESLint
- `pnpm preview` - Preview production build

## Architecture

### Core Modules

**`src/lgp.ts`** - LGP archive parser and writer
- Parses binary LGP files using `binary-parser`
- Handles TOC (Table of Contents), hash lookup tables, and path groups
- Supports reading, modifying, inserting, and removing files from archives
- Writes modified archives back to valid LGP format

**`src/texfile.ts`** - TEX texture file parser
- Parses FF7's proprietary TEX texture format
- Handles both palette-indexed and direct color modes
- Extracts RGBA pixel data for preview rendering

### React Components

**`src/App.jsx`** - Main application state and orchestration
- Manages archive state, file selection, and navigation
- Handles file operations (open, save, extract, replace, add, remove)
- Implements keyboard navigation and drag & drop

**`src/components/`**
- `FileList.jsx` - Virtualized file list using @tanstack/react-virtual
- `QuickLook.jsx` - File preview modal (supports TEX images, hex view)
- `Toolbar.jsx` - Action buttons and search
- `StatusBar.jsx` - Status messages and file counts
- `HexViewer.jsx` - Hex dump display for binary files
- `TexPreview.jsx` - TEX texture rendering to canvas

### Utilities

**`src/utils/fileTypes.ts`** - File type detection
- Maps extensions and filename patterns to human-readable types
- Special handling for 4-letter battle model naming conventions

## LGP Format Notes

- Header: 16 bytes with "SQUARESOFT" magic string
- TOC entries: 27 bytes each (filename, offset, type, path index)
- Hash table: 900 entries for filename lookup optimization
- Path groups: Optional folder structure support
- File data: 24-byte header per file + raw data
- Terminator: "FINAL FANTASY7" string

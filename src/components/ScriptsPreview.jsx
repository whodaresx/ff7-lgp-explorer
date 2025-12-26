import { useMemo, useState } from 'react';
import { findDialogReferences } from '../fieldfile.ts';
import { decodeText } from '../fftext.ts';
import './ScriptsPreview.css';

/**
 * Decode FF7 text bytes to string using the existing fftext decoder
 */
function decodeDialogText(data) {
    if (!data || data.length === 0) {
        return '(empty)';
    }
    // Skip if only contains the terminator
    if (data.length === 1 && data[0] === 0xFF) {
        return '(empty)';
    }
    try {
        const utf8Bytes = decodeText(data);
        const decoded = new TextDecoder().decode(utf8Bytes);
        return decoded || '(empty)';
    } catch (e) {
        // Fallback: show hex if decoding fails
        return '[Decode error: ' + Array.from(data.slice(0, 16))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(' ') + (data.length > 16 ? '...' : '') + ']';
    }
}

// Script slot names from FF7 documentation
const SCRIPT_SLOT_NAMES = [
    'Init', 'Main', 'Script 1', 'Script 2',
    'Script 3', 'Script 4', 'Script 5', 'Script 6',
    'Script 7', 'Script 8', 'Script 9', 'Script 10',
    'Script 11', 'Script 12', 'Script 13', 'Script 14',
    'Script 15', 'Script 16', 'Script 17', 'Script 18',
    'Script 19', 'Script 20', 'Script 21', 'Script 22',
    'Script 23', 'Script 24', 'Script 25', 'Script 26',
    'Script 27', 'Script 28', 'Script 29', 'Script 30',
    'Script 31',
];

/**
 * Find the byte offset after the first RET instruction starting from a given position
 * Returns -1 if no RET found or if RET is at end of data
 */
function findOffsetAfterFirstRET(scriptData, startOffset) {
    let pos = startOffset;
    while (pos < scriptData.length) {
        const opcode = scriptData[pos];
        const length = OPCODE_LENGTHS[opcode] ?? 1;

        if (opcode === 0x00) { // RET
            // Return position after the RET
            const afterRet = pos + length;
            if (afterRet < scriptData.length) {
                return afterRet;
            }
            return -1; // RET is at end, nothing after
        }

        pos += length;
    }
    return -1; // No RET found
}

/**
 * Determine which scripts are "active" (have actual code)
 *
 * FF7 script structure:
 * - scripts[0] contains BOTH Init AND Main, separated by a RET opcode
 *   - Init = code from scripts[0] up to first RET
 *   - Main = code after the first RET in scripts[0]
 * - scripts[1] = Script 1
 * - scripts[2] = Script 2
 * - etc.
 *
 * Display slots (33 total):
 * - Slot 0 (Init) → scripts[0], up to first RET
 * - Slot 1 (Main) → scripts[0], after first RET
 * - Slot 2 (Script 1) → scripts[1]
 * - Slot N+1 (Script N) → scripts[N] for N >= 1
 */
function getActiveScripts(entity, scriptSection) {
    const { scriptDataOffset, scriptData } = scriptSection;

    // We return 33 active flags for 33 display slots
    const result = [];

    // Slot 0: Init (scripts[0] up to first RET)
    const initOffset = entity.scripts[0];
    const initRelOffset = initOffset - scriptDataOffset;
    const initInBounds = initRelOffset >= 0 && initRelOffset < scriptData.length;
    const initFirstOpcode = initInBounds ? scriptData[initRelOffset] : 0x00;
    const initActive = initInBounds && initFirstOpcode !== 0x00;
    result.push(initActive);

    // Slot 1: Main (scripts[0] after first RET)
    let mainActive = false;
    if (initActive) {
        const afterFirstRet = findOffsetAfterFirstRET(scriptData, initRelOffset);
        if (afterFirstRet !== -1 && afterFirstRet < scriptData.length) {
            const mainFirstOpcode = scriptData[afterFirstRet];
            mainActive = mainFirstOpcode !== 0x00;
        }
    }
    result.push(mainActive);

    // Build offset -> first slot map for scripts[1] onwards
    // Note: slots 2-32 map to scripts[1-31]
    const offsetToFirstSlot = new Map();
    for (let i = 1; i < entity.scripts.length; i++) {
        const offset = entity.scripts[i];
        if (!offsetToFirstSlot.has(offset)) {
            offsetToFirstSlot.set(offset, i);
        }
    }

    // Slots 2-32: Script 1 through Script 31 (scripts[1] through scripts[31])
    for (let i = 1; i < entity.scripts.length; i++) {
        const absoluteOffset = entity.scripts[i];
        const relOffset = absoluteOffset - scriptDataOffset;

        // Bounds check
        if (relOffset < 0 || relOffset >= scriptData.length) {
            result.push(false);
            continue;
        }

        const firstOpcode = scriptData[relOffset];

        // If first opcode is RET, script is empty
        if (firstOpcode === 0x00) {
            result.push(false);
            continue;
        }

        // If multiple scripts share this offset, only the first one is active
        const firstSlotWithThisOffset = offsetToFirstSlot.get(absoluteOffset);
        if (firstSlotWithThisOffset !== i) {
            result.push(false);
            continue;
        }

        result.push(true);
    }

    return result;
}

// FF7 opcode lengths (index = opcode, value = total instruction length including opcode)
const OPCODE_LENGTHS = [
    /* 00 RET      */ 1,  /* 01 REQ      */ 3,  /* 02 REQSW    */ 3,  /* 03 REQEW    */ 3,
    /* 04 PREQ     */ 3,  /* 05 PRQSW    */ 3,  /* 06 PRQEW    */ 3,  /* 07 RETTO    */ 2,
    /* 08 JOIN     */ 2,  /* 09 SPLIT    */ 15, /* 0a SPTYE    */ 6,  /* 0b GTPYE    */ 6,
    /* 0c          */ 1,  /* 0d          */ 1,  /* 0e DSKCG    */ 2,  /* 0f SPECIAL  */ 2,
    /* 10 JMPF     */ 2,  /* 11 JMPFL    */ 3,  /* 12 JMPB     */ 2,  /* 13 JMPBL    */ 3,
    /* 14 IFUB     */ 6,  /* 15 IFUBL    */ 7,  /* 16 IFSW     */ 8,  /* 17 IFSWL    */ 9,
    /* 18 IFUW     */ 8,  /* 19 IFUWL    */ 9,  /* 1a          */ 10, /* 1b          */ 3,
    /* 1c          */ 6,  /* 1d          */ 1,  /* 1e          */ 1,  /* 1f          */ 1,
    /* 20 MINIGAME */ 11, /* 21 TUTOR    */ 2,  /* 22 BTMD2    */ 5,  /* 23 BTRLD    */ 3,
    /* 24 WAIT     */ 3,  /* 25 NFADE    */ 9,  /* 26 BLINK    */ 2,  /* 27 BGMOVIE  */ 2,
    /* 28 KAWAI    */ 3,  /* 29 KAWIW    */ 1,  /* 2a PMOVA    */ 2,  /* 2b SLIP     */ 2,
    /* 2c BGPDH    */ 5,  /* 2d BGSCR    */ 7,  /* 2e WCLS     */ 2,  /* 2f WSIZW    */ 10,
    /* 30 IFKEY    */ 4,  /* 31 IFKEYON  */ 4,  /* 32 IFKEYOFF */ 4,  /* 33 UC       */ 2,
    /* 34 PDIRA    */ 2,  /* 35 PTURA    */ 4,  /* 36 WSPCL    */ 5,  /* 37 WNUMB    */ 8,
    /* 38 STTIM    */ 6,  /* 39 GOLDu    */ 6,  /* 3a GOLDd    */ 6,  /* 3b CHGLD    */ 4,
    /* 3c HMPMAX1  */ 1,  /* 3d HMPMAX2  */ 1,  /* 3e MHMMX    */ 1,  /* 3f HMPMAX3  */ 1,
    /* 40 MESSAGE  */ 3,  /* 41 MPARA    */ 5,  /* 42 MPRA2    */ 6,  /* 43 MPNAM    */ 2,
    /* 44          */ 1,  /* 45 MPu      */ 5,  /* 46          */ 1,  /* 47 MPd      */ 5,
    /* 48 ASK      */ 7,  /* 49 MENU     */ 4,  /* 4a MENU2    */ 2,  /* 4b BTLTB    */ 2,
    /* 4c          */ 1,  /* 4d HPu      */ 5,  /* 4e          */ 1,  /* 4f HPd      */ 5,
    /* 50 WINDOW   */ 10, /* 51 WMOVE    */ 6,  /* 52 WMODE    */ 4,  /* 53 WREST    */ 2,
    /* 54 WCLSE    */ 2,  /* 55 WROW     */ 3,  /* 56 GWCOL    */ 7,  /* 57 SWCOL    */ 7,
    /* 58 STITM    */ 5,  /* 59 DLITM    */ 5,  /* 5a CKITM    */ 5,  /* 5b SMTRA    */ 7,
    /* 5c DMTRA    */ 8,  /* 5d CMTRA    */ 10, /* 5e SHAKE    */ 8,  /* 5f NOP      */ 1,
    /* 60 MAPJUMP  */ 10, /* 61 SCRLO    */ 2,  /* 62 SCRLC    */ 5,  /* 63 SCRLA    */ 6,
    /* 64 SCR2D    */ 6,  /* 65 SCRCC    */ 1,  /* 66 SCR2DC   */ 9,  /* 67 SCRLW    */ 1,
    /* 68 SCR2DL   */ 9,  /* 69 MPDSP    */ 2,  /* 6a VWOFT    */ 7,  /* 6b FADE     */ 9,
    /* 6c FADEW    */ 1,  /* 6d IDLCK    */ 4,  /* 6e LSTMP    */ 3,  /* 6f SCRLP    */ 6,
    /* 70 BATTLE   */ 4,  /* 71 BTLON    */ 2,  /* 72 BTLMD    */ 3,  /* 73 PGTDR    */ 4,
    /* 74 GETPC    */ 4,  /* 75 PXYZI    */ 8,  /* 76 PLUS!    */ 4,  /* 77 PLUS2!   */ 5,
    /* 78 MINUS!   */ 4,  /* 79 MINUS2!  */ 5,  /* 7a INC!     */ 3,  /* 7b INC2!    */ 3,
    /* 7c DEC!     */ 3,  /* 7d DEC2!    */ 3,  /* 7e TLKON    */ 2,  /* 7f RDMSD    */ 3,
    /* 80 SETBYTE  */ 4,  /* 81 SETWORD  */ 5,  /* 82 BITON    */ 4,  /* 83 BITOFF   */ 4,
    /* 84 BITXOR   */ 4,  /* 85 PLUS     */ 4,  /* 86 PLUS2    */ 5,  /* 87 MINUS    */ 4,
    /* 88 MINUS2   */ 5,  /* 89 MUL      */ 4,  /* 8a MUL2     */ 5,  /* 8b DIV      */ 4,
    /* 8c DIV2     */ 5,  /* 8d MOD      */ 4,  /* 8e MOD2     */ 5,  /* 8f AND      */ 4,
    /* 90 AND2     */ 5,  /* 91 OR       */ 4,  /* 92 OR2      */ 5,  /* 93 XOR      */ 4,
    /* 94 XOR2     */ 5,  /* 95 INC      */ 3,  /* 96 INC2     */ 3,  /* 97 DEC      */ 3,
    /* 98 DEC2     */ 3,  /* 99 RANDOM   */ 3,  /* 9a LBYTE    */ 4,  /* 9b HBYTE    */ 5,
    /* 9c 2BYTE    */ 6,  /* 9d SETX     */ 7,  /* 9e GETX     */ 7,  /* 9f SEARCHX  */ 11,
    /* a0 PC       */ 2,  /* a1 CHAR     */ 2,  /* a2 DFANM    */ 3,  /* a3 ANIME1   */ 3,
    /* a4 VISI     */ 2,  /* a5 XYZI     */ 11, /* a6 XYI      */ 9,  /* a7 XYZ      */ 9,
    /* a8 MOVE     */ 6,  /* a9 CMOVE    */ 6,  /* aa MOVA     */ 2,  /* ab TURA     */ 4,
    /* ac ANIMW    */ 1,  /* ad FMOVE    */ 6,  /* ae ANIME2   */ 3,  /* af ANIM!1   */ 3,
    /* b0 CANIM1   */ 5,  /* b1 CANM!1   */ 5,  /* b2 MSPED    */ 4,  /* b3 DIR      */ 3,
    /* b4 TURNGEN  */ 6,  /* b5 TURN     */ 6,  /* b6 DIRA     */ 2,  /* b7 GETDIR   */ 4,
    /* b8 GETAXY   */ 5,  /* b9 GETAI    */ 4,  /* ba ANIM!2   */ 3,  /* bb CANIM2   */ 5,
    /* bc CANM!2   */ 5,  /* bd ASPED    */ 4,  /* be          */ 1,  /* bf CC       */ 2,
    /* c0 JUMP     */ 11, /* c1 AXYZI    */ 8,  /* c2 LADER    */ 15, /* c3 OFST     */ 12,
    /* c4 OFSTW    */ 1,  /* c5 TALKR    */ 3,  /* c6 SLIDR    */ 3,  /* c7 SOLID    */ 2,
    /* c8 PRTYP    */ 2,  /* c9 PRTYM    */ 2,  /* ca PRTYE    */ 4,  /* cb IFPRTYQ  */ 3,
    /* cc IFMEMBQ  */ 3,  /* cd MMBud    */ 3,  /* ce MMBLK    */ 2,  /* cf MMBUK    */ 2,
    /* d0 LINE     */ 13, /* d1 LINON    */ 2,  /* d2 MPJPO    */ 2,  /* d3 SLINE    */ 16,
    /* d4 SIN      */ 10, /* d5 COS      */ 10, /* d6 TLKR2    */ 4,  /* d7 SLDR2    */ 4,
    /* d8 PMJMP    */ 3,  /* d9 PMJMP2   */ 1,  /* da AKAO2    */ 15, /* db FCFIX    */ 2,
    /* dc CCANM    */ 4,  /* dd ANIMB    */ 1,  /* de TURNW    */ 1,  /* df MPPAL    */ 11,
    /* e0 BGON     */ 4,  /* e1 BGOFF    */ 4,  /* e2 BGROL    */ 3,  /* e3 BGROL2   */ 3,
    /* e4 BGCLR    */ 3,  /* e5 STPAL    */ 5,  /* e6 LDPAL    */ 5,  /* e7 CPPAL    */ 5,
    /* e8 RTPAL    */ 7,  /* e9 ADPAL    */ 10, /* ea MPPAL2   */ 10, /* eb STPLS    */ 5,
    /* ec LDPLS    */ 5,  /* ed CPPAL2   */ 8,  /* ee RTPAL2   */ 8,  /* ef ADPAL2   */ 11,
    /* f0 MUSIC    */ 2,  /* f1 SOUND    */ 5,  /* f2 AKAO     */ 14, /* f3 MUSVT    */ 2,
    /* f4 MUSVM    */ 2,  /* f5 MULCK    */ 2,  /* f6 BMUSC    */ 2,  /* f7 CHMPH    */ 4,
    /* f8 PMVIE    */ 2,  /* f9 MOVIE    */ 1,  /* fa MVIEF    */ 3,  /* fb MVCAM    */ 2,
    /* fc FMUSC    */ 2,  /* fd CMUSC    */ 8,  /* fe CHMST    */ 3,  /* ff GAMEOVER */ 1,
];

/**
 * Get the actual script offset for a display slot index
 * Display slots 0-1 (Init/Main) both use entity.scripts[0]
 * Display slots 2-32 use entity.scripts[1-31]
 */
function getScriptOffsetForSlot(entity, displaySlot) {
    if (displaySlot <= 1) {
        return entity.scripts[0];
    }
    return entity.scripts[displaySlot - 1];
}

/**
 * Get script size estimate for display slots
 * Returns array of 33 sizes for 33 display slots
 */
function getScriptSizes(entity, scriptSection) {
    const { scriptDataOffset, scriptData } = scriptSection;
    const sizes = [];

    // Slot 0 (Init): size is from scripts[0] to first RET
    const initOffset = entity.scripts[0];
    const initRelOffset = initOffset - scriptDataOffset;
    let initSize = 0;
    let mainStart = -1;

    if (initRelOffset >= 0 && initRelOffset < scriptData.length) {
        // Find first RET to determine Init size and Main start
        let pos = initRelOffset;
        while (pos < scriptData.length) {
            const opcode = scriptData[pos];
            const length = OPCODE_LENGTHS[opcode] ?? 1;
            if (opcode === 0x00) { // RET
                initSize = pos - initRelOffset + length;
                mainStart = pos + length;
                break;
            }
            pos += length;
        }
        if (initSize === 0) {
            initSize = scriptData.length - initRelOffset;
        }
    }
    sizes.push(initSize);

    // Slot 1 (Main): size is from after first RET to second RET
    let mainSize = 0;
    if (mainStart !== -1 && mainStart < scriptData.length) {
        let pos = mainStart;
        while (pos < scriptData.length) {
            const opcode = scriptData[pos];
            const length = OPCODE_LENGTHS[opcode] ?? 1;
            if (opcode === 0x00) { // RET
                mainSize = pos - mainStart + length;
                break;
            }
            pos += length;
        }
        if (mainSize === 0) {
            mainSize = scriptData.length - mainStart;
        }
    }
    sizes.push(mainSize);

    // Slots 2-32: Script 1 through Script 31
    const sortedOffsets = [...entity.scripts.slice(1)]
        .map((offset, idx) => ({ offset, idx: idx + 1 }))
        .sort((a, b) => a.offset - b.offset);

    for (let i = 1; i < entity.scripts.length; i++) {
        const offset = entity.scripts[i];
        const relOffset = offset - scriptDataOffset;

        if (relOffset < 0 || relOffset >= scriptData.length) {
            sizes.push(0);
            continue;
        }

        // Find next different offset
        const sortedIdx = sortedOffsets.findIndex(s => s.idx === i);
        let nextOffset = scriptDataOffset + scriptData.length;
        for (let j = sortedIdx + 1; j < sortedOffsets.length; j++) {
            if (sortedOffsets[j].offset > offset) {
                nextOffset = sortedOffsets[j].offset;
                break;
            }
        }

        sizes.push(nextOffset - offset);
    }

    return sizes;
}

function EntityPanel({ entity, entityIndex, scriptSection, dialogRefs, isExpanded, onToggle }) {
    // activeScripts returns 33 flags for 33 display slots
    const activeScripts = useMemo(
        () => getActiveScripts(entity, scriptSection),
        [entity, scriptSection]
    );

    // scriptSizes returns 33 sizes for 33 display slots
    const scriptSizes = useMemo(
        () => getScriptSizes(entity, scriptSection),
        [entity, scriptSection]
    );

    // Count active scripts (out of 33 display slots)
    const activeCount = activeScripts.filter(Boolean).length;

    // Get dialogs referenced by this entity
    const entityDialogRefs = dialogRefs.filter(r => r.entityIndex === entityIndex);

    return (
        <div className={`scripts-entity ${isExpanded ? 'expanded' : ''}`}>
            <div className="scripts-entity-header" onClick={onToggle}>
                <span className="scripts-entity-arrow">{isExpanded ? '▼' : '▶'}</span>
                <span className="scripts-entity-name">{entity.name || `Entity ${entityIndex}`}</span>
                <span className="scripts-entity-stats">
                    {activeCount}/33 scripts
                    {entityDialogRefs.length > 0 && ` • ${entityDialogRefs.length} dialogs`}
                </span>
            </div>

            {isExpanded && (
                <div className="scripts-entity-content">
                    <div className="scripts-slot-grid">
                        {SCRIPT_SLOT_NAMES.map((slotName, displaySlot) => {
                            const isActive = activeScripts[displaySlot];
                            const size = scriptSizes[displaySlot];
                            const offset = getScriptOffsetForSlot(entity, displaySlot);
                            // Dialog refs use the raw script index, need to map from display slot
                            // Display slot 0,1 -> script index 0; Display slot N (N>=2) -> script index N-1
                            const scriptIndex = displaySlot <= 1 ? 0 : displaySlot - 1;
                            const refs = entityDialogRefs.filter(r => r.scriptIndex === scriptIndex);

                            return (
                                <div
                                    key={displaySlot}
                                    className={`scripts-slot ${isActive ? 'active' : 'empty'}`}
                                    title={`${slotName}\nOffset: 0x${offset.toString(16).toUpperCase()}\nSize: ~${size} bytes${refs.length > 0 ? `\nDialogs: ${refs.map(r => r.dialogId).join(', ')}` : ''}`}
                                >
                                    <span className="scripts-slot-idx">{displaySlot}</span>
                                    <span className="scripts-slot-name">{slotName}</span>
                                    {refs.length > 0 && (
                                        <span className="scripts-slot-dialogs">
                                            💬{refs.length}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function DialogPanel({ dialog, dialogRefs }) {
    const decodedText = useMemo(
        () => decodeDialogText(dialog.text),
        [dialog.text]
    );

    // Find which scripts reference this dialog
    const refs = dialogRefs.filter(r => r.dialogId === dialog.index);

    return (
        <div className="scripts-dialog">
            <div className="scripts-dialog-header">
                <span className="scripts-dialog-id">#{dialog.index}</span>
                {refs.length > 0 && (
                    <span className="scripts-dialog-refs">
                        {refs.map((r, i) => (
                            <span key={i} className="scripts-dialog-ref" title={`Script ${r.scriptIndex}`}>
                                {r.entityName}:{r.scriptIndex}
                            </span>
                        ))}
                    </span>
                )}
                <span className="scripts-dialog-size">{dialog.text.length} bytes</span>
            </div>
            <div className="scripts-dialog-text">
                {decodedText.split('\n').map((line, i) => (
                    <div key={i} className="scripts-dialog-line">{line || '\u00A0'}</div>
                ))}
            </div>
        </div>
    );
}

export function ScriptsPreview({ scriptSection }) {
    const [expandedEntities, setExpandedEntities] = useState(new Set([0]));
    const [dialogFilter, setDialogFilter] = useState('');

    // Find all dialog references in scripts (using proper opcode parsing)
    const dialogRefs = useMemo(
        () => findDialogReferences(scriptSection),
        [scriptSection]
    );

    // Filter dialogs
    const filteredDialogs = useMemo(() => {
        if (!dialogFilter) return scriptSection.dialogs;
        const lower = dialogFilter.toLowerCase();
        return scriptSection.dialogs.filter(d => {
            const text = decodeDialogText(d.text).toLowerCase();
            return text.includes(lower) || d.index.toString().includes(lower);
        });
    }, [scriptSection.dialogs, dialogFilter]);

    const toggleEntity = (idx) => {
        setExpandedEntities(prev => {
            const next = new Set(prev);
            if (next.has(idx)) {
                next.delete(idx);
            } else {
                next.add(idx);
            }
            return next;
        });
    };

    const { header, entities, dialogs, akaoOffsets } = scriptSection;

    return (
        <div className="scripts-preview">
            {/* Metadata header - single row */}
            <div className="scripts-metadata">
                <span className="scripts-meta-label">Field:</span>
                <span className="scripts-meta-value">{header.name || '(unnamed)'}</span>
                <span className="scripts-meta-label">Creator:</span>
                <span className="scripts-meta-value">{header.creator || '(none)'}</span>
                <span className="scripts-meta-label">Entities:</span>
                <span className="scripts-meta-value">{header.entityCount}</span>
                <span className="scripts-meta-label">Models:</span>
                <span className="scripts-meta-value">{header.modelCount}</span>
                <span className="scripts-meta-label">Scale:</span>
                <span className="scripts-meta-value">{header.scale}</span>
                <span className="scripts-meta-label">Dialogs:</span>
                <span className="scripts-meta-value">{dialogs.length}</span>
                {akaoOffsets.length > 0 && (
                    <>
                        <span className="scripts-meta-label">Akao:</span>
                        <span className="scripts-meta-value">{akaoOffsets.length}</span>
                    </>
                )}
            </div>

            {/* Main content area - split view */}
            <div className="scripts-content">
                {/* Left: Entities */}
                <div className="scripts-entities-panel">
                    <div className="scripts-panel-header">
                        <span>Entities ({entities.length})</span>
                        <button
                            className="scripts-expand-all"
                            onClick={() => setExpandedEntities(new Set(entities.map((_, i) => i)))}
                            title="Expand all"
                        >
                            ⊞
                        </button>
                        <button
                            className="scripts-collapse-all"
                            onClick={() => setExpandedEntities(new Set())}
                            title="Collapse all"
                        >
                            ⊟
                        </button>
                    </div>
                    <div className="scripts-entities-list">
                        {entities.map((entity, idx) => (
                            <EntityPanel
                                key={idx}
                                entity={entity}
                                entityIndex={idx}
                                scriptSection={scriptSection}
                                dialogRefs={dialogRefs}
                                isExpanded={expandedEntities.has(idx)}
                                onToggle={() => toggleEntity(idx)}
                            />
                        ))}
                    </div>
                </div>

                {/* Right: Dialogs */}
                <div className="scripts-dialogs-panel">
                    <div className="scripts-panel-header">
                        <span>Dialogs ({filteredDialogs.length}{dialogFilter && ` / ${dialogs.length}`})</span>
                        <input
                            type="text"
                            className="scripts-dialog-filter"
                            placeholder="Filter..."
                            value={dialogFilter}
                            onChange={(e) => setDialogFilter(e.target.value)}
                        />
                    </div>
                    <div className="scripts-dialogs-list">
                        {filteredDialogs.length === 0 ? (
                            <div className="scripts-empty">
                                {dialogs.length === 0 ? 'No dialogs in this field' : 'No matching dialogs'}
                            </div>
                        ) : (
                            filteredDialogs.map((dialog) => (
                                <DialogPanel
                                    key={dialog.index}
                                    dialog={dialog}
                                    dialogRefs={dialogRefs}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

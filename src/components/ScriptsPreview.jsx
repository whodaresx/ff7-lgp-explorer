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
    'Init', 'Main', 'Script 2', 'Script 3',
    'Script 4', 'Script 5', 'Script 6', 'Script 7',
    'Script 8', 'Script 9', 'Script 10', 'Script 11',
    'Script 12', 'Script 13', 'Script 14', 'Script 15',
    'Script 16', 'Script 17', 'Script 18', 'Script 19',
    'Script 20', 'Script 21', 'Script 22', 'Script 23',
    'Script 24', 'Script 25', 'Script 26', 'Script 27',
    'Script 28', 'Script 29', 'Script 30', 'Script 31',
];

/**
 * Determine which scripts are "active" (point to actual code vs empty RET)
 * Two scripts pointing to the same offset are considered empty
 */
function getActiveScripts(entity, scriptDataOffset) {
    const offsets = entity.scripts;
    const offsetCounts = {};

    // Count how many scripts point to each offset
    for (const offset of offsets) {
        offsetCounts[offset] = (offsetCounts[offset] || 0) + 1;
    }

    // A script is active if:
    // 1. It's the only one pointing to that offset OR
    // 2. It points to a unique offset within a reasonable range
    // In practice, empty scripts often share the same RET instruction
    return offsets.map((offset, idx) => {
        // First script (Init) at offset 0 relative to scriptData is usually active
        if (idx === 0 && offset === scriptDataOffset) return true;
        // Scripts sharing an offset are likely empty (pointing to shared RET)
        return offsetCounts[offset] === 1;
    });
}

/**
 * Get script size estimate by looking at next script's offset
 */
function getScriptSizes(entity, scriptDataOffset, scriptDataEnd) {
    const sizes = [];
    const sortedOffsets = [...entity.scripts]
        .map((offset, idx) => ({ offset, idx }))
        .sort((a, b) => a.offset - b.offset);

    for (let i = 0; i < sortedOffsets.length; i++) {
        const { offset, idx } = sortedOffsets[i];
        let size = 0;

        // Find next different offset
        let nextOffset = scriptDataEnd;
        for (let j = i + 1; j < sortedOffsets.length; j++) {
            if (sortedOffsets[j].offset > offset) {
                nextOffset = sortedOffsets[j].offset;
                break;
            }
        }

        size = nextOffset - offset;
        sizes[idx] = size;
    }

    return sizes;
}

function EntityPanel({ entity, entityIndex, scriptSection, dialogRefs, isExpanded, onToggle }) {
    const { scriptDataOffset } = scriptSection;
    const scriptDataEnd = scriptDataOffset + scriptSection.scriptData.length;

    const activeScripts = useMemo(
        () => getActiveScripts(entity, scriptDataOffset),
        [entity, scriptDataOffset]
    );

    const scriptSizes = useMemo(
        () => getScriptSizes(entity, scriptDataOffset, scriptDataEnd),
        [entity, scriptDataOffset, scriptDataEnd]
    );

    // Count active scripts
    const activeCount = activeScripts.filter(Boolean).length;

    // Get dialogs referenced by this entity
    const entityDialogRefs = dialogRefs.filter(r => r.entityIndex === entityIndex);

    return (
        <div className={`scripts-entity ${isExpanded ? 'expanded' : ''}`}>
            <div className="scripts-entity-header" onClick={onToggle}>
                <span className="scripts-entity-arrow">{isExpanded ? '▼' : '▶'}</span>
                <span className="scripts-entity-name">{entity.name || `Entity ${entityIndex}`}</span>
                <span className="scripts-entity-stats">
                    {activeCount}/32 scripts
                    {entityDialogRefs.length > 0 && ` • ${entityDialogRefs.length} dialogs`}
                </span>
            </div>

            {isExpanded && (
                <div className="scripts-entity-content">
                    <div className="scripts-slot-grid">
                        {entity.scripts.map((offset, idx) => {
                            const isActive = activeScripts[idx];
                            const size = scriptSizes[idx];
                            const refs = entityDialogRefs.filter(r => r.scriptIndex === idx);

                            return (
                                <div
                                    key={idx}
                                    className={`scripts-slot ${isActive ? 'active' : 'empty'}`}
                                    title={`${SCRIPT_SLOT_NAMES[idx]}\nOffset: 0x${offset.toString(16).toUpperCase()}\nSize: ~${size} bytes${refs.length > 0 ? `\nDialogs: ${refs.map(r => r.dialogId).join(', ')}` : ''}`}
                                >
                                    <span className="scripts-slot-idx">{idx}</span>
                                    <span className="scripts-slot-name">{SCRIPT_SLOT_NAMES[idx]}</span>
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

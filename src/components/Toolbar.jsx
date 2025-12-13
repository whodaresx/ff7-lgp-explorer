import { forwardRef } from 'react';
import './Toolbar.css';

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const icons = {
  open: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  save: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8",
  extract: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  replace: "M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3",
  add: "M12 5v14M5 12h14",
  remove: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
  search: "M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5zM16 16l4.5 4.5",
};

export const Toolbar = forwardRef(function Toolbar({ 
  onOpen, 
  onSave, 
  onExtract, 
  onReplace, 
  onAdd,
  onRemove,
  hasArchive,
  hasSelection,
  searchQuery,
  onSearchChange
}, ref) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button onClick={onOpen}>
          <Icon d={icons.open} /> Open LGP
        </button>
        <button onClick={onSave} disabled={!hasArchive}>
          <Icon d={icons.save} /> Save LGP
        </button>
      </div>
      
      <div className="toolbar-separator" />
      
      <div className="toolbar-group">
        <button onClick={onExtract} disabled={!hasSelection}>
          <Icon d={icons.extract} /> Extract
        </button>
        <button onClick={onReplace} disabled={!hasSelection}>
          <Icon d={icons.replace} /> Replace
        </button>
        <button onClick={onAdd} disabled={!hasArchive}>
          <Icon d={icons.add} /> Add
        </button>
        <button onClick={onRemove} disabled={!hasSelection}>
          <Icon d={icons.remove} /> Remove
        </button>
      </div>
      
      <div className="toolbar-separator" />
      
      <div className="toolbar-search">
        <span className="search-icon">
          <Icon d={icons.search} size={14} />
        </span>
        <input
          ref={ref}
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onSearchChange('')}
          disabled={!hasArchive}
        />
        {searchQuery && (
          <button 
            className="search-clear" 
            onClick={() => onSearchChange('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      
      <div className="toolbar-title">
        LGP Explorer
      </div>
    </div>
  );
});
